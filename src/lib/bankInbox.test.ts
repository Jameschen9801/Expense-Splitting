import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankDraft, Group } from '../types';
import { applyChange, applyCloudChange, type GroupChange } from './outbox';
import { bankDraftExpense } from './bankInbox';
import { fingerprint, RecordConflictError } from './audit';
import { cloudGroup, normalizeGroup } from './firebase';
import { summarizeExpenses } from './categories';
import { createBackup, readBackup, planRestore, groupCsv } from './backup';
import { createSyncEngine } from './sync';

const group: Group = { kind: 'personal', code: '123456', name: '日常', members: ['我'], expenses: [], transfers: [], createdAt: 1,
  security: { version: 1, ownerUid: 'owner', users: { owner: { name: '我', nameKey: '我', role: 'owner' } }, names: { 我: 'owner' } } };
const draft: BankDraft = { id: 'ebank_inbox', bank: 'Richart', last4: '0123', desc: '銀行消費（待補說明）', amount: 85, date: '2026-10-27', category: 'other', payer: '我', participants: ['我'], splitMode: 'equal', shares: [], createdAt: 2 };
const capture: GroupChange = { type: 'bankDraft.put', draft, meta: { id: 'capture', actor: '我', actorUid: 'owner', at: 3, expected: null } };
const captured = () => applyCloudChange(group, capture);
const form = { desc: '早餐', amount: '85', date: draft.date, payer: '我', participants: ['我'], splitMode: 'equal' as const, customShares: {}, category: 'food' as const };
const confirmation = (current: Group, id = 'confirm'): GroupChange => ({ type: 'bankDraft.confirm', id: draft.id, expense: bankDraftExpense(current.bankInbox![0], form), meta: { id, actor: '我', actorUid: 'owner', at: 4, expected: fingerprint(current.bankInbox![0]) } });
const memory = () => {
  const entries = new Map<string,string>();
  return { get length(){return entries.size;}, key:(index:number)=>[...entries.keys()][index]||null, getItem:(key:string)=>entries.get(key)??null, setItem:(key:string,value:string)=>{entries.set(key,value);}, removeItem:(key:string)=>{entries.delete(key);} };
};

test('通知只放待確認，支出統計、CSV 與正式明細都保持空白', () => {
  const next = captured();
  assert.equal(next.bankInbox?.length, 1);
  assert.equal(next.expenses.length, 0);
  assert.equal(summarizeExpenses(next.expenses,'我').total,0);
  assert.equal(groupCsv(next).includes(draft.id),false);
  const roundTrip = normalizeGroup(cloudGroup(next));
  assert.equal(roundTrip.bankInbox?.length,1);
  assert.deepEqual(roundTrip.bankReceiptIds,[draft.id]);
  assert.equal(roundTrip.expenses.length,0);
});
test('說明與分類必須明確填寫，金額日期仍經過驗證', () => {
  assert.throws(()=>bankDraftExpense(draft,{...form,desc:''}),/說明/);
  assert.throws(()=>bankDraftExpense(draft,{...form,desc:draft.desc}),/說明/);
  assert.throws(()=>bankDraftExpense(draft,{...form,category:undefined}),/分類/);
  assert.throws(()=>bankDraftExpense(draft,{...form,amount:'-1'}),/金額/);
  assert.throws(()=>bankDraftExpense(draft,{...form,date:'2026-02-30'}),/日期/);
  const expense = bankDraftExpense(draft,{...form,category:'other'});
  assert.equal(expense.category,'other');
  assert.equal('bank' in expense,false);
  assert.equal('last4' in expense,false);
});
test('確認一次就原子移出待確認並新增一筆帳目，重試及另一裝置不會覆蓋', () => {
  const before = captured(), change = confirmation(before);
  const next = applyCloudChange(before,change);
  assert.equal(next.bankInbox?.length,0);
  assert.equal(next.expenses.length,1);
  assert.equal(summarizeExpenses(next.expenses,'我').total,85);
  const raw = cloudGroup(next,cloudGroup(before)) as any;
  assert.equal(raw.bankInbox[draft.id]._deleted,true);
  assert.equal(raw.expenses[draft.id].desc,'早餐');
  assert.equal(Object.hasOwn(raw,'bankReceiptIds'),false);
  const cloud = normalizeGroup(raw);
  assert.equal(cloud.bankInbox?.length,0);
  assert.deepEqual(applyCloudChange(cloud,change),cloud);
  const other = {...confirmation(before,'other'),expense:{...bankDraftExpense(draft,form),desc:'另一個畫面'}} as GroupChange;
  assert.equal(applyCloudChange(cloud,other).expenses[0].desc,'早餐');
});
test('忽略及已確認的通知長期去重，舊備份與延遲操作不會重新新增', () => {
  const before = captured();
  const ignored = applyCloudChange(before,{type:'bankDraft.remove',id:draft.id,meta:{id:'ignore',actor:'我',at:4,expected:fingerprint(before.bankInbox![0])}});
  const cloud = normalizeGroup(cloudGroup(ignored,cloudGroup(before)));
  cloud.history = {};
  assert.equal(applyCloudChange(cloud,{...capture,meta:{...capture.meta!,id:'replay'}}).bankInbox?.length,0);
  assert.equal(applyChange(cloud,confirmation(before)).expenses.length,0);
  assert.throws(()=>applyCloudChange(cloud,confirmation(before)),RecordConflictError);
  assert.throws(()=>applyChange({...group,kind:'shared'},capture));
});
test('JSON 備份保留通知待確認與佇列，還原不會誤作正式支出或復活已忽略項目', () => {
  const source=memory();source.setItem('warikan_group_123456',JSON.stringify(captured()));source.setItem('warikan_my_groups',JSON.stringify([{code:group.code,name:group.name,myName:'我',kind:'personal'}]));
  const backup=readBackup(JSON.stringify(createBackup(source))), fresh=planRestore(memory(),backup);
  assert.equal(fresh.records,0);assert.equal(fresh.drafts,1);
  const queue=JSON.parse(fresh.entries.warikan_outbox_v1);
  assert.equal(queue.length,1);assert.equal(queue[0].change.type,'bankDraft.put');
  const ignored=applyChange(captured(),{type:'bankDraft.remove',id:draft.id});
  const target=memory();target.setItem('warikan_group_123456',JSON.stringify(ignored));
  const restored=planRestore(target,backup);
  assert.equal(restored.drafts,0);assert.equal(restored.pending,0);
  assert.equal(JSON.parse(restored.entries.warikan_group_123456).bankInbox.length,0);
});
test('離線先收通知再確認，重新連線與遺失確認回覆都只產生一筆正式帳目', async () => {
  const store=memory();let server=group;let loseAck=true;
  const engine=createSyncEngine({getStorage:()=>store,saveGroup:()=>{},send:async(_code,change)=>{
    server=normalizeGroup(cloudGroup(applyCloudChange(server,change),cloudGroup(server)));
    if(change.type==='bankDraft.confirm'&&loseAck){loseAck=false;throw new Error('lost acknowledgement');}
    return server;
  }});
  engine.enqueue(group.code,capture);
  assert.equal(engine.merge(group).expenses.length,0);
  engine.enqueue(group.code,confirmation(engine.merge(group)));
  engine.setConnected(true);assert.equal(await engine.flush(group.code),false);
  assert.equal(server.expenses.length,1);assert.equal(server.bankInbox?.length,0);
  assert.equal(await engine.flush(group.code),true);
  assert.equal(server.expenses.length,1);assert.equal(engine.getStatus(group.code).pending,0);
});
