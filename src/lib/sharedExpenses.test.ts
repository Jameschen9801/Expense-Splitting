import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankDraft, Expense, Group } from '../types';
import { memberExpenseAmount, possibleBankMatches, possibleSharedMatches, projectSharedExpenses, sharedExpenseChanges, sharedExpenseId } from './sharedExpenses';
import { applyChange, applyCloudChange, overlayPending } from './outbox';
import { cloudGroup, normalizeGroup } from './firebase';
import { fingerprint } from './audit';
import { createBackup, readBackup } from './backup';

const expense: Expense = { id: 'e1', desc: '晚餐', amount: 2000, payer: 'A', participants: ['A','B'], splitMode: 'equal', date: '2026-10-28', createdAt: 1, category: 'food' };
const source: Group = { code: '123456', name: '生活分帳', members: ['A','B'], expenses: [expense], transfers: [], createdAt: 1 };
const target: Group = { kind: 'personal', code: '654321', name: '日常', members: ['我'], expenses: [], transfers: [], createdAt: 1,
  security: { version: 1, ownerUid: 'owner', users: { owner: { name: '我', nameKey: '我', role: 'owner' } }, names: { 我: 'owner' } } };
const meta = (id: string) => ({ id, actor: '我', actorUid: 'owner', at: 2 });
const draft: BankDraft = { ...expense, id: 'ebank_notice', desc: '銀行消費（待補說明）', payer: '我', participants: ['我'], category: 'other', bank: 'Richart', last4: '0123' };

test('自己的負擔與誰先付款無關，平均分攤保留尾數、自訂零元不計入', () => {
  assert.equal(memberExpenseAmount(expense, 'A'),1000);
  assert.equal(memberExpenseAmount({ ...expense,payer:'B' },'A'),1000);
  assert.equal(memberExpenseAmount({ ...expense,amount:100.01 },'A'),50.01);
  assert.equal(memberExpenseAmount({ ...expense,amount:100.01 },'B'),50);
  assert.equal(memberExpenseAmount({ ...expense,participants:['B'] },'A'),0);
  assert.equal(memberExpenseAmount({ ...expense,splitMode:'custom',shares:[{name:'A',amount:0},{name:'B',amount:2000}] },'A'),0);
  assert.equal(memberExpenseAmount({ ...expense,splitMode:'percent',shares:[{name:'A',amount:600},{name:'B',amount:1400}] },'A'),600);
});
test('來源身分決定固定編號，多次同步不重複，其他帳本相同記錄 ID 不相撞', async () => {
  const [copy] = await projectSharedExpenses(source,'我','A');
  assert.equal(copy.amount,1000); assert.deepEqual(copy.participants,['我']); assert.equal(copy.sharedSource?.totalAmount,2000);
  assert.equal(copy.id,await sharedExpenseId(source.code,expense.id));
  assert.notEqual(copy.id,await sharedExpenseId('222222',expense.id));
  const once = sharedExpenseChanges(target,source.code,[copy]).reduce((group,change) => applyChange(group,{...change,meta:meta('once')}),target);
  assert.deepEqual(sharedExpenseChanges(once,source.code,[copy]),[]);
  assert.deepEqual(await projectSharedExpenses({...source,expenses:[{...expense,participants:['B']}]},'我','A'),[]);
});
test('來源修改與取消分攤連動，手動支出及其他共用帳本的同步記錄保留', async () => {
  const [copy] = await projectSharedExpenses(source,'我','A');
  const manual = {...expense,id:'manual',payer:'我',participants:['我']};
  const [other] = await projectSharedExpenses({...source,code:'222222'},'我','A');
  let group = {...target,expenses:[copy,manual,other]};
  const projected = await projectSharedExpenses({...source,name:'新名稱',expenses:[{...expense,amount:2400,desc:'晚餐更新',category:'social'}]},'我','A');
  group = sharedExpenseChanges(group,source.code,projected).reduce((next,change) => applyChange(next,{...change,meta:meta('update')}),group);
  assert.equal(group.expenses.find(row=>row.id===copy.id)?.amount,1200);
  assert.equal(group.expenses.find(row=>row.id===copy.id)?.sharedSource?.groupName,'新名稱');
  const previous = cloudGroup(group);
  const removed = sharedExpenseChanges(group,source.code,[]).reduce((next,change)=>applyChange(next,{...change,meta:meta('remove')}),group);
  assert.deepEqual(removed.expenses.map(row=>row.id).sort(),['manual',other.id].sort());
  assert.equal((cloudGroup(removed,previous) as any).expenses[copy.id]._deleted,true);
});
test('銀行以刷卡全額比對分帳，付款者不同或日期不同不建議合併', async () => {
  const [copy] = await projectSharedExpenses(source,'我','A');
  assert.equal(possibleSharedMatches(draft,[copy]).length,1);
  assert.equal(possibleSharedMatches({...draft,amount:1000},[copy]).length,0);
  assert.equal(possibleSharedMatches({...draft,date:'2026-10-27'},[copy]).length,0);
  const [paidByB] = await projectSharedExpenses({...source,expenses:[{...expense,payer:'B'}]},'我','A');
  assert.equal(possibleSharedMatches(draft,[paidByB]).length,0);
});
test('通知連結只保留分攤，重試及刪除來源後重試不會重新入帳', async () => {
  const [copy] = await projectSharedExpenses(source,'我','A');
  const group = {...target,expenses:[copy],bankInbox:[draft],bankReceiptIds:[draft.id]};
  const change = {type:'bankDraft.link' as const,id:draft.id,expenseId:copy.id,meta:{...meta('link'),expected:fingerprint(draft)}};
  const linked = applyCloudChange(group,change);
  assert.equal(linked.bankInbox?.length,0); assert.equal(linked.expenses.length,1); assert.equal(linked.expenses[0].amount,1000);
  assert.equal(linked.bankLinks?.[draft.id],copy.id);
  const raw = cloudGroup(linked,cloudGroup(group)) as any;
  assert.equal(raw.bankInbox[draft.id]._deleted,true);
  assert.equal(raw.bankInbox[draft.id]._lastAudit.action,'bankDraft.link');
  assert.equal(applyCloudChange({...linked,history:{}},change).expenses.length,1);
  assert.equal(applyCloudChange({...linked,expenses:[],history:{}},change).expenses.length,0);
  assert.equal(overlayPending(normalizeGroup(raw),[{id:'retry',groupCode:target.code,change}]).expenses.length,1);
  assert.throws(()=>applyCloudChange(group,{...change,expenseId:'missing'}));
  assert.equal(applyChange(group,{...change,expenseId:'missing'}),group);
  const stale={...group,expenses:[]};
  assert.equal(overlayPending(stale,[{id:'stale',groupCode:target.code,change}]).bankInbox?.length,1);
  assert.throws(()=>applyCloudChange(stale,change));
});
test('先入帳的銀行全額可明確合併，保留通知去重標記、刪除墓碑與備份', async () => {
  const [copy] = await projectSharedExpenses(source,'我','A');
  const {bank,last4,...bankExpense} = draft;
  const group = {...target,expenses:[copy,bankExpense],bankReceiptIds:[draft.id]};
  assert.equal(possibleBankMatches(copy,group).length,1);
  const change = {type:'expense.linkBank' as const,id:draft.id,expenseId:copy.id,meta:{...meta('merge'),expected:fingerprint(bankExpense)}};
  const linked = applyCloudChange(group,change);
  assert.equal(linked.expenses.length,1); assert.equal(linked.expenses[0].amount,1000);
  assert.equal((cloudGroup(linked,cloudGroup(group)) as any).expenses[draft.id]._deleted,true);
  const entries = new Map([['warikan_group_654321',JSON.stringify(linked)]]);
  const store = {get length(){return entries.size;},key:(i:number)=>[...entries.keys()][i],getItem:(key:string)=>entries.get(key)||null,
    setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}};
  const backup = readBackup(JSON.stringify(createBackup(store)));
  assert.equal(JSON.parse(backup.entries.warikan_group_654321).bankLinks[draft.id],copy.id);
  assert.deepEqual(possibleBankMatches(copy,linked),[]);
});
