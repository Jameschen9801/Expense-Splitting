import test from 'node:test';
import assert from 'node:assert/strict';
import type { BankDraft, Expense, Group } from '../types';
import { pureAdvance, prepareSharedRoute, routedExpense, routedExpenseId, routeForm, routeExpenseForm, possibleRouteMatches, sharedRoutingPatch, validSharedRoute } from './sharedRouting';
import { applyChange, applyCloudChange } from './outbox';
import { fingerprint, RecordConflictError } from './audit';
import { cloudGroup, normalizeGroup } from './firebase';
import { projectSharedDrafts } from './sharedInbox';
import { memberExpenseAmount } from './sharedExpenses';
import { utils } from './utils';
import { createBackup, planRestore, readBackup } from './backup';
import { createSyncEngine } from './sync';

const personal:Group={code:'654321',kind:'personal',name:'個人',members:['我'],expenses:[],transfers:[],createdAt:1,security:{version:1,ownerUid:'owner',users:{owner:{name:'我',nameKey:'我',role:'owner'}},names:{我:'owner'}}};
const shared:Group={code:'123456',kind:'shared',name:'共用',members:['A','B'],expenses:[],transfers:[],createdAt:1,security:{version:1,ownerUid:'other',users:{other:{name:'B',nameKey:'B',role:'owner'},owner:{name:'A',nameKey:'A',role:'member'}},names:{A:'owner',B:'other'}}};
const draft:BankDraft={id:'ebank_card',amount:2000,desc:'銀行消費（待補說明）',category:'other',date:'2026-11-08',createdAt:2,payer:'我',participants:['我'],splitMode:'equal',bank:'測試銀行',last4:'1234',revision:1,lastMutationId:'capture'};
const source={...personal,bankInbox:[draft],bankReceiptIds:[draft.id]};
const form={...routeForm(draft,'A',shared.members),desc:'晚餐',category:'food' as const};
const meta={id:'routing',actor:'我',actorUid:'owner',at:10};
const applyPatch=(patch:Record<string,unknown>)=>{
  const root:any={groups:{[personal.code]:cloudGroup(source),[shared.code]:cloudGroup(shared)}};
  for(const [path,value]of Object.entries(patch)){const keys=path.split('/');const key=keys.pop()!;let node=root;for(const part of keys)node=node[part]||=( {} );node[key]=value;}
  return {source:normalizeGroup(root.groups[personal.code]),target:normalizeGroup(root.groups[shared.code]),raw:root};
};
const memory=()=>{const values=new Map<string,string>();return {get length(){return values.size;},key:(at:number)=>[...values.keys()][at]||null,getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};};

test('通知原子轉成分帳，個人僅留下待確認份額，共用不含銀行或個人來源資料',async()=>{
  const change=await prepareSharedRoute(source,draft,shared,'A',form,'bank',meta);
  const patch=sharedRoutingPatch(source,shared,change,'owner')!;
  const result=applyPatch(patch),expense=result.target.expenses[0];
  assert.equal(result.source.bankInbox?.length,0);assert.equal(result.source.expenses.length,0);
  assert.equal(result.target.expenses.length,1);assert.equal(expense.amount,2000);
  assert.equal(memberExpenseAmount(expense,'A'),1000);
  assert.equal(result.source.sharedRoutes?.[draft.id].expenseId,expense.id);
  assert.ok(result.raw.groups[personal.code].bankInbox[draft.id]._deleted);
  assert.ok(!('bank' in expense)&&!('last4' in expense)&&!('importSource' in expense));
  assert.ok(!JSON.stringify(result.raw.groups[shared.code]).includes(draft.id));
  const [pending]=await projectSharedDrafts(result.target,'我','A','2026-11-08');
  assert.equal(pending.amount,1000);assert.equal(pending.sharedSource.totalAmount,2000);
  assert.deepEqual(utils.calcBalances(result.target),{A:1000,B:-1000});
});
test('純代墊一鍵排除自己，只產生應收款，不產生個人支出或待確認',async()=>{
  const advance=pureAdvance({...form,splitMode:'custom',customShares:{A:'1000',B:'1000'}},'A',shared.members);
  assert.deepEqual(advance.participants,['B']);assert.equal(advance.payer,'A');assert.equal(advance.splitMode,'equal');
  const change=await prepareSharedRoute(source,draft,shared,'A',advance,'bank',meta);
  const result=applyPatch(sharedRoutingPatch(source,shared,change,'owner')!);
  assert.equal(memberExpenseAmount(result.target.expenses[0],'A'),0);
  assert.deepEqual(await projectSharedDrafts(result.target,'我','A','2026-11-08'),[]);
  assert.deepEqual(utils.calcSettlements(utils.calcBalances(result.target)),[{from:'B',to:'A',amount:2000}]);
});
test('金額與比例分攤都保留分，輸入未完成或分攤不平衡時拒絕轉換',()=>{
  const custom=routedExpense({...form,amount:'100.01',splitMode:'custom',customShares:{A:'40',B:'60.01'}},shared,'A','test',10);
  assert.equal(memberExpenseAmount(custom,'A'),40);assert.equal(memberExpenseAmount(custom,'B'),60.01);
  assert.deepEqual(routedExpense(routeExpenseForm(custom),shared,'A','test',10),custom);
  const percent=routedExpense({...form,amount:'100.01',splitMode:'percent',customShares:{A:'30',B:'70'}},shared,'A','test',10);
  assert.equal(utils.toCents(percent.shares!.reduce((sum,row)=>sum+row.amount,0)),10001);
  for(const changed of [{desc:''},{category:undefined},{amount:'1.001'},{date:'2026-02-30'},{payer:'B'},{participants:[]},{participants:['A','A']},{splitMode:'custom',customShares:{A:'1',B:'2'}},{splitMode:'percent',customShares:{A:'20',B:'20'}}])assert.throws(()=>routedExpense({...form,...changed} as any,shared,'A','test',10));
});
test('連結已存在分帳只處理原通知，完全不修改他人已記錄的分帳',async()=>{
  const existing={...routedExpense(form,shared,'A','already',3),revision:2,lastMutationId:'updated',createdBy:'B'};
  const target={...shared,expenses:[existing]};
  const change=await prepareSharedRoute(source,draft,target,'A',form,'bank',meta,existing);
  const patch=sharedRoutingPatch(source,target,change,'owner')!;
  assert.ok(Object.keys(patch).every(path=>path.startsWith('groups/'+personal.code+'/')));
  assert.equal(change.route.mode,'link');
  assert.equal(possibleRouteMatches(draft,{...shared,expenses:[existing,{...existing,id:'different-date',date:'2026-11-07'},{...existing,id:'different-payer',payer:'B'}]},'A').length,1);
  assert.throws(()=>sharedRoutingPatch(source,{...target,expenses:[{...existing,shares:[],amount:2100}]},change,'owner'),RecordConflictError);
});
test('同時轉到不同共用帳本只能成功一次，遺失回覆後重試不覆寫分帳',async()=>{
  const first=await prepareSharedRoute(source,draft,shared,'A',form,'bank',meta);
  const other={...shared,code:'123457'};
  const second=await prepareSharedRoute(source,draft,other,'A',form,'bank',{...meta,id:'another'});
  assert.equal(first.expense.id,second.expense.id);
  assert.equal(await routedExpenseId(personal.code,draft.id),first.expense.id);
  const committed=applyPatch(sharedRoutingPatch(source,shared,first,'owner')!);
  assert.equal(sharedRoutingPatch(committed.source,{...committed.target,expenses:[{...committed.target.expenses[0],desc:'後來自行更正'}]},first,'owner'),null);
  assert.throws(()=>applyCloudChange(committed.source,second),RecordConflictError);
  assert.throws(()=>sharedRoutingPatch(committed.source,other,second,'owner'),RecordConflictError);
});
test('其他帳號、原通知更新及目標改為個人帳本都不能搬動原資料',async()=>{
  const change=await prepareSharedRoute(source,draft,shared,'A',form,'bank',meta);
  assert.throws(()=>sharedRoutingPatch(source,shared,change,'stranger'),/本人/);
  assert.throws(()=>sharedRoutingPatch({...source,bankInbox:[{...draft,amount:2100,lastMutationId:'new'}]},shared,change,'owner'),RecordConflictError);
  assert.throws(()=>sharedRoutingPatch(source,{...shared,kind:'personal'},change,'owner'),/共用帳本/);
  assert.equal(validSharedRoute({...change.route,extra:'unsupported'}),false);
  assert.equal(validSharedRoute({...change.route,groupCode:'654321/expenses'}),false);
});
test('已入個人帳本的全額轉成分帳，備份重匯不復活全額記錄',async()=>{
  const {bank,last4,...expense}=draft;
  const before={...personal,expenses:[expense]};
  const change=await prepareSharedRoute(before,expense,shared,'A',form,'expense',meta);
  const optimistic=applyChange(before,change);
  assert.equal(optimistic.expenses.length,0);assert.equal(optimistic.sharedRoutes?.[expense.id].source,'expense');
  const store=memory();store.setItem('warikan_group_654321',JSON.stringify(optimistic));
  const backupStore=memory();backupStore.setItem('warikan_group_654321',JSON.stringify(before));
  const restore=planRestore(store,readBackup(JSON.stringify(createBackup(backupStore))));
  assert.equal(restore.records,0);assert.equal(JSON.parse(restore.entries.warikan_group_654321).expenses.length,0);
  const queued=memory();queued.setItem('warikan_group_654321',JSON.stringify(before));queued.setItem('warikan_outbox_v1',JSON.stringify([{id:'pending',groupCode:personal.code,change}]));
  assert.equal(JSON.parse(readBackup(JSON.stringify(createBackup(queued))).entries.warikan_outbox_v1)[0].change.route.groupCode,shared.code);
});
test('離線意圖先保存；衝突時不能強制覆蓋另一台裝置的分帳選擇',async()=>{
  const change=await prepareSharedRoute(source,draft,shared,'A',form,'bank',meta);
  const store=memory();let sends=0;
  const engine=createSyncEngine({getStorage:()=>store,saveGroup:()=>{},send:async()=>{sends++;throw new RecordConflictError(source,draft.id);}});
  engine.enqueue(source.code,change);assert.equal(sends,0);assert.equal(engine.merge(source).bankInbox?.length,0);
  assert.ok(store.getItem('warikan_outbox_v1'));
  engine.setConnected(true);await engine.flush(source.code);
  assert.equal(sends,1);assert.ok(engine.getStatus(source.code).conflict);
  assert.throws(()=>engine.resolveConflict(source.code,'mine'),/重新核對/);
  engine.resolveConflict(source.code,'cloud');assert.equal(engine.getStatus(source.code).pending,0);
});
