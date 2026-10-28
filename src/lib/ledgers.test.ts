import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Expense, Group } from '../types';
import { expenseFormForLedger, isPersonalLedger, ledgerKind } from './ledgers';
import { applyChange, overlayPending } from './outbox';
import { createBackup, planRestore, readBackup } from './backup';
import { RecordsList } from '../components/RecordsList';
import { Statistics } from '../components/Statistics';

const personal: Group = { kind:'personal',code:'654321',name:'日常記帳',createdAt:1,members:['我'],expenses:[],transfers:[],security:{version:1,ownerUid:'owner',users:{owner:{name:'我',nameKey:'我',role:'owner'}},names:{我:'owner'}} };
const expense: Expense = {id:'e1',desc:'午餐',amount:100.01,payer:'我',participants:['我'],splitMode:'equal',category:'food',date:'2026-10-27',createdAt:2};
const memory = () => { const data=new Map<string,string>(); return {data,get length(){return data.size;},key:(index:number)=>[...data.keys()][index]||null,getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}}; };

test('個人帳本明確標記，未標記的既有帳本維持共用', () => {
  assert.equal(isPersonalLedger(personal),true); assert.equal(ledgerKind(personal),'personal');
  assert.equal(ledgerKind({}), 'shared'); assert.equal(ledgerKind({kind:'shared'}),'shared');
});
test('個人表單排除舊草稿分攤資料，仍保留金額、日期與分類', () => {
  const form = { desc:'午餐',amount:'100',date:'2026-10-27',category:'travel' as const,payer:'朋友',participants:['我','朋友'],splitMode:'custom' as const,customShares:{朋友:'100'} };
  assert.deepEqual(expenseFormForLedger(personal,form),{...form,payer:'我',participants:['我'],splitMode:'equal',customShares:{}});
  assert.equal(expenseFormForLedger({...personal,kind:'shared'},form),form);
});
test('個人帳本離線可記帳、修改與重新命名，但拒絕成員、轉帳與他人分攤', () => {
  const added=applyChange(personal,{type:'expense.put',expense});
  assert.equal(added.kind,'personal'); assert.equal(added.expenses[0].amount,100.01);
  assert.equal(applyChange(added,{type:'group.rename',name:'生活支出'}).kind,'personal');
  assert.equal(applyChange(added,{type:'expense.remove',id:'e1'}).expenses.length,0);
  for (const change of [{type:'member.add' as const,name:'朋友'},{type:'member.remove' as const,name:'我'},{type:'transfer.put' as const,transfer:{id:'t1',from:'我',to:'朋友',amount:1,date:expense.date,createdAt:2}},{type:'expense.put' as const,expense:{...expense,participants:['我','朋友']}},{type:'expense.put' as const,expense:{...expense,payer:'朋友'}}]) assert.throws(()=>applyChange(personal,change));
  assert.equal(overlayPending(personal,[{id:'p1',groupCode:personal.code,change:{type:'expense.put',expense}}]).kind,'personal');
});
test('個人帳本備份保留種類，不合併同碼共用帳本或其他人的私人帳本', () => {
  const source=memory(); source.setItem('warikan_group_654321',JSON.stringify({...personal,expenses:[expense]})); source.setItem('warikan_my_groups',JSON.stringify([{code:personal.code,name:personal.name,myName:'我',kind:'personal'}]));
  const backup=readBackup(JSON.stringify(createBackup(source)));
  assert.equal(JSON.parse(backup.entries.warikan_group_654321).kind,'personal');
  const empty=memory(); assert.equal(planRestore(empty,backup).records,1);
  const current=memory(); current.setItem('warikan_group_654321',JSON.stringify({...personal,kind:'shared'}));
  assert.throws(()=>planRestore(current,backup),/無法合併/);
  current.setItem('warikan_group_654321',JSON.stringify({...personal,security:{...personal.security,ownerUid:'other'}}));
  assert.throws(()=>planRestore(current,backup),/無法合併/);
  const malformed=createBackup(source); malformed.entries.warikan_group_654321=JSON.stringify({...personal,members:['我','朋友']});
  assert.throws(()=>readBackup(JSON.stringify(malformed)));
});
test('個人備份不能夾帶會新增成員或轉帳的待同步操作', () => {
  const source=memory(); source.setItem('warikan_group_654321',JSON.stringify(personal));
  source.setItem('warikan_outbox_v1',JSON.stringify([{id:'p1',groupCode:personal.code,change:{type:'transfer.put',transfer:{id:'t1',from:'我',to:'朋友',amount:1,date:expense.date,createdAt:2}}}]));
  assert.throws(()=>planRestore(memory(),createBackup(source)),/個人帳本/);
});
test('個人明細與統計直接顯示自己的全額支出，省去分攤文案', () => {
  const html=renderToStaticMarkup(createElement(RecordsList,{groups:{[expense.date]:[{...expense,type:'expense'}]},myName:'我',personal:true,filtered:false,resetKey:'test',onClear(){},onExpense(){},onTransfer(){}}));
  assert.ok(html.includes('100.01')); assert.ok(html.includes('餐飲')); assert.ok(html.includes('支出'));
  assert.equal(html.includes('你的分攤'),false); assert.equal(html.includes('先付'),false);
  const stats=renderToStaticMarkup(createElement(Statistics,{group:{...personal,expenses:[expense]},myName:'我',month:'2026-10',onMonth(){}}));
  assert.ok(stats.includes('收支總覽')); assert.ok(stats.includes('收入')); assert.ok(stats.includes('結餘')); assert.ok(stats.includes('100.01'));
  assert.equal(stats.includes('我的分攤'),false); assert.equal(stats.includes('我先付款'),false);
});
