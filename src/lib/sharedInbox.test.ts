import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense, Group } from '../types';
import { applyChange, applyCloudChange, type GroupChange } from './outbox';
import { fingerprint } from './audit';
import { cloudGroup, normalizeGroup } from './firebase';
import { createBackup, planRestore, readBackup } from './backup';
import { projectSharedExpenses, possibleBankMatches } from './sharedExpenses';
import { excludedOnTargetChange, legacySharedExpense, possiblePersonalMatches, projectSharedDrafts, sharedDraftExpense, sharedReviewChanges, validSyncDate } from './sharedInbox';

const expense: Expense = { id: 'e1', desc: '晚餐', amount: 2000, date: '2026-10-29', payer: 'A', participants: ['A','B'], splitMode: 'equal', category: 'food', createdAt: 1 };
const source: Group = { code: '123456', name: '生活分帳', members: ['A','B'], expenses: [expense], transfers: [], createdAt: 1 };
const target: Group = { kind: 'personal', code: '654321', name: '日常', members: ['我'], expenses: [], transfers: [], createdAt: 1,
  security: { version: 1, ownerUid: 'owner', users: { owner: { name: '我', nameKey: '我', role: 'owner' } }, names: { 我: 'owner' } } };
let sequence = 0;
const meta = () => ({ id: 'review_' + ++sequence, actor: '我', actorUid: 'owner', at: 10 + sequence });
const apply = (group: Group, changes: GroupChange[]) => changes.reduce((current, change) => applyChange(current, { ...change, meta: meta() }), group);
const projected = () => projectSharedDrafts(source, '我', 'A', '2026-10-29');
const form = (draft: Expense) => ({ desc: '自己的說明', amount: String(draft.amount), date: draft.date, category: 'shopping' as const, payer: '我', participants: ['我'], splitMode: 'equal' as const, customShares: {} });
async function pending() { return apply(target, sharedReviewChanges(target, source.code, await projected())); }
function confirmation(group: Group): GroupChange {
  const draft = group.sharedInbox![0];
  return { type: 'sharedDraft.confirm', id: draft.id, expense: sharedDraftExpense(draft, form(draft), 5), expectedExpense: fingerprint(group.expenses.find(record => record.id === draft.id)), meta: { ...meta(), expected: fingerprint(draft) } };
}

test('同步起始日嚴格驗證，包含當日及之後的帳，排除舊帳與零元分攤', async () => {
  assert.equal(validSyncDate('2026-02-30'),false); assert.equal(validSyncDate('2024-02-29'),true);
  const rows = await projectSharedDrafts({ ...source, expenses: [{ ...expense,id:'old',date:'2026-10-28' },expense,{ ...expense,id:'future',date:'2026-11-01' },{ ...expense,id:'other',participants:['B'] }] },'我','A','2026-10-29');
  assert.equal(rows.length,2); assert.deepEqual(rows.map(row=>row.date),['2026-10-29','2026-11-01']);
  assert.ok(rows.every(row=>row.amount===1000)); await assert.rejects(()=>projectSharedDrafts(source,'我','A','invalid'));
});
test('分攤先入待確認，不計入正式支出；重複核對不重複新增', async () => {
  const group=await pending(); assert.equal(group.expenses.length,0);assert.equal(group.sharedInbox?.length,1);
  assert.deepEqual(sharedReviewChanges(group,source.code,await projected()),[]);
  const raw=cloudGroup(group);assert.equal(normalizeGroup(raw).sharedInbox?.length,1);
});
test('確認後入帳、保留自訂說明分類，重送及刪除後重送都不復活', async () => {
  const before=await pending(),change=confirmation(before),group=applyCloudChange(before,change);
  assert.equal(group.expenses.length,1);assert.equal(group.sharedInbox?.length,0);assert.equal(group.expenses[0].desc,'自己的說明');assert.equal(group.expenses[0].category,'shopping');
  assert.deepEqual(sharedReviewChanges(group,source.code,await projected()),[]);
  assert.equal(applyCloudChange({...group,history:{}},change).expenses.length,1);
  const deleted=applyChange(group,{type:'expense.remove',id:group.expenses[0].id,meta:meta()});
  assert.equal(Object.values(deleted.history!).at(0)?.action,'sharedExpense.remove');
  assert.deepEqual(sharedReviewChanges(deleted,source.code,await projected()),[]);
  assert.equal(applyCloudChange({...deleted,history:{}},change).expenses.length,0);
});
test('忽略只移出待確認，來源再次更新也不重新送入', async () => {
  const before=await pending(),draft=before.sharedInbox![0];
  const group=applyChange(before,{type:'sharedDraft.remove',id:draft.id,meta:meta()});
  assert.equal(group.sharedHandled?.[draft.id].status,'ignored');assert.equal(group.expenses.length,0);
  assert.deepEqual(sharedReviewChanges(group,source.code,await projectSharedDrafts({...source,expenses:[{...expense,amount:2400}]},'我','A','2026-10-29')),[]);
});
test('來源改金額後再待確認，確認前保留原紀錄，確認後更新同筆', async () => {
  const before=await pending(),confirmed=applyCloudChange(before,confirmation(before));
  const changed=await projectSharedDrafts({...source,expenses:[{...expense,amount:2400,desc:'原分帳更新'}]},'我','A','2026-10-29');
  const waiting=apply(confirmed,sharedReviewChanges(confirmed,source.code,changed));
  assert.equal(waiting.expenses[0].amount,1000);assert.equal(waiting.sharedInbox?.[0].amount,1200);
  assert.equal(waiting.sharedInbox?.[0].desc,'自己的說明');assert.equal(waiting.sharedInbox?.[0].category,'shopping');
  const updated=applyCloudChange(waiting,confirmation(waiting));assert.equal(updated.expenses.length,1);assert.equal(updated.expenses[0].amount,1200);
  assert.deepEqual(sharedReviewChanges(updated,source.code,changed),[]);
});
test('過期確認與並行修改被拒絕，不能覆蓋新版分攤或個人內容', async () => {
  const before=await pending(),change=confirmation(before);
  const changed=apply(before,sharedReviewChanges(before,source.code,await projectSharedDrafts({...source,expenses:[{...expense,amount:2400}]},'我','A','2026-10-29')));
  assert.throws(()=>applyCloudChange(changed,change),/其他裝置/);
  const confirmed=applyCloudChange(before,change),proposed=apply(confirmed,sharedReviewChanges(confirmed,source.code,await projectSharedDrafts({...source,expenses:[{...expense,amount:2400}]},'我','A','2026-10-29')));
  const accept=confirmation(proposed),edited={...proposed,expenses:proposed.expenses.map(record=>({...record,desc:'另一裝置修改'}))};
  assert.throws(()=>applyCloudChange(edited,accept),/其他裝置/);
});
test('整理只移除舊版自動副本，歷史不回填，當日起改送待確認', async () => {
  const old={...expense,id:'old',date:'2026-10-28'},copies=await projectSharedExpenses({...source,expenses:[old,expense]},'我','A');
  const manual={...copies[0],id:'ercpt_manual',sharedSource:undefined,importSource:{system:'ReceiptBox' as const,category:'食物'}};
  const group={...target,expenses:[...copies,manual]};
  const next=apply(group,sharedReviewChanges(group,source.code,await projected(),{cleanupLegacy:true}));
  assert.deepEqual(next.expenses.map(record=>record.id),[manual.id]);assert.equal(next.sharedInbox?.length,1);assert.equal(next.sharedInbox?.[0].date,'2026-10-29');
  assert.equal(legacySharedExpense(manual),false);assert.deepEqual(sharedReviewChanges(next,source.code,await projected(),{cleanupLegacy:true}),[]);
});
test('未選整理時保留舊副本，且不再另建同來源的待確認', async () => {
  const copies=await projectSharedExpenses(source,'我','A'),group={...target,expenses:copies};
  assert.deepEqual(sharedReviewChanges(group,source.code,await projected(),{cleanupLegacy:false}),[]);
});
test('更換目標保留已確認歷史、排除已處理來源，只搬未確認的新分攤', async () => {
  const waiting=await pending(),confirmed=applyCloudChange(waiting,confirmation(waiting));
  const link={targetCode:target.code,memberName:'A',enabled:true,mode:'review' as const,since:'2026-10-29'};
  const excluded=excludedOnTargetChange(link,confirmed),other={...target,code:'654322',expenses:[]};
  assert.deepEqual(sharedReviewChanges(other,source.code,await projected(),{excludedIds:excluded}),[]);
  assert.deepEqual(excludedOnTargetChange(link,waiting),{});
  const cleared=apply(waiting,sharedReviewChanges(waiting,source.code,[]));assert.equal(cleared.sharedInbox?.length,0);assert.equal(confirmed.expenses.length,1);
  assert.equal(apply(other,sharedReviewChanges(other,source.code,await projected())).sharedInbox?.length,1);
});
test('銀行已先記全額時可原子改成我的分攤，沒有第二筆全額支出', async () => {
  const waiting=await pending(),bank={...expense,id:'ebank_charge',payer:'我',participants:['我']},group={...waiting,expenses:[bank],bankReceiptIds:[bank.id]};
  assert.equal(possibleBankMatches(group.sharedInbox![0],group).length,1);
  const change={...confirmation(group),bankExpenseId:bank.id,expectedBank:fingerprint(bank)} as GroupChange;
  const linked=applyCloudChange(group,change);assert.equal(linked.expenses.length,1);assert.equal(linked.expenses[0].amount,1000);assert.equal(linked.bankLinks?.[bank.id],linked.expenses[0].id);
  const raw=cloudGroup(linked,cloudGroup(group)) as any;assert.equal(raw.expenses[bank.id]._deleted,true);
  assert.equal(applyCloudChange({...linked,history:{}},change).expenses.length,1);
});
test('同日同額的手動支出只能提示，不會自動刪除或合併', async () => {
  const group=await pending(),draft=group.sharedInbox![0],manual={...draft,id:'manual',sharedSource:undefined};
  const withManual={...group,expenses:[manual]};assert.equal(possiblePersonalMatches(draft,withManual).length,1);
  assert.equal(withManual.expenses.length,1);assert.equal(withManual.expenses[0].id,'manual');
});
test('備份還原包含待確認與忽略標記，已忽略的來源不復活', async () => {
  const group=await pending(),entries=new Map([['warikan_group_654321',JSON.stringify(group)]]);
  const store={get length(){return entries.size;},key:(i:number)=>[...entries.keys()][i],getItem:(key:string)=>entries.get(key)||null,setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}};
  const backup=readBackup(JSON.stringify(createBackup(store))),empty={...store,getItem:()=>null,length:0,key:()=>null};
  const restored=planRestore(empty,backup);assert.equal(restored.drafts,1);assert.equal(restored.records,0);
  const ignored=applyChange(group,{type:'sharedDraft.remove',id:group.sharedInbox![0].id,meta:meta()});entries.set('warikan_group_654321',JSON.stringify(ignored));
  const merged=planRestore(store,backup);assert.equal(JSON.parse(merged.entries.warikan_group_654321).sharedInbox.length,0);
  assert.equal(merged.pending,0);
});
