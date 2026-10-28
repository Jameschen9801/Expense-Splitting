import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense, Group, Income, Saving } from '../types';
import { prepareReceiptBox, parseCsv, receiptBoxCategory } from './receiptBox';
import { cashflowValue, summarizePersonal } from './personalFinance';
import { applyChange, applyCloudChange, overlayPending } from './outbox';
import { fingerprint, RecordConflictError } from './audit';
import { cloudGroup, normalizeGroup } from './firebase';
import { storage, utils } from './utils';
import { createBackup, groupCsv, planRestore, readBackup } from './backup';

const group:Group={kind:'personal',code:'654321',name:'測試',members:['我'],expenses:[],transfers:[],createdAt:1,security:{version:1,ownerUid:'owner',users:{owner:{name:'我',nameKey:'我',role:'owner'}},names:{我:'owner'}}};
const income:Income={id:'i1',desc:'薪資',amount:1000,date:'2024-02-29',createdAt:2};
const saving:Saving={id:'s1',desc:'預備金',amount:200,date:'2024-02-29',createdAt:3,direction:'out'};
const expense:Expense={id:'e1',desc:'午餐',amount:100.01,date:'2024-02-29',createdAt:4,payer:'我',participants:['我'],splitMode:'equal',category:'food'};
const memory=()=>{const data=new Map<string,string>();return{get length(){return data.size;},key:(i:number)=>[...data.keys()][i]||null,getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};};

test('CSV 正確解析千分位、引號、多行註記、BOM 與省略最後空標籤',async()=>{
  assert.deepEqual(parseCsv('\uFEFFa,b,c\r\n"x,y","say ""hi""","one\ntwo"\r\n'),[['a','b','c'],['x,y','say "hi"','one\ntwo']]);
  assert.throws(()=>parseCsv('a,b\n"unterminated'));
  const csv='日期,分類,支出,收入,定位,註記,標籤1\n2024-02-29,教育,"1,234.50",0,教室,"課程,書籍",現金\n2024-02-29,收入,0,2000,,薪資\n2024-02-29,儲蓄,500,0,,預備金,\n2027-01-10,家電,12.30,0,,分期付款,分期付款';
  const plan=await prepareReceiptBox(csv,'我',10);
  assert.equal(plan.expenses[0].amount,1234.5);assert.equal(plan.expenses[0].category,'education');assert.equal(plan.expenses[0].location,'教室');assert.deepEqual(plan.expenses[0].tags,['現金']);
  assert.equal(plan.incomes[0].amount,2000);assert.equal(plan.savings[0].direction,'out');assert.equal(plan.expenses[1].date,'2027-01-10');
  assert.equal(plan.report.expenseCents+plan.report.savingCents,plan.report.inputExpenseCents);assert.deepEqual(plan.report.unknownCategories,{});
});
test('重匯與重新排序使用同一組來源編號，同日同額合法多筆仍完整保留',async()=>{
  const header='日期,分類,支出,收入,定位,註記';const first='2026-10-01,食物,50,0,,早餐',second='2026-10-02,飲料,35,0,,紅茶';
  const a=await prepareReceiptBox([header,first,second,first].join('\n'),'我',1),b=await prepareReceiptBox([header,first,first,second].join('\n'),'我',2);
  assert.equal(a.expenses.length,3);assert.equal(new Set(a.expenses.map(row=>row.id)).size,3);assert.deepEqual(a.expenses.map(row=>row.id).sort(),b.expenses.map(row=>row.id).sort());assert.equal(a.report.identicalRowsRetained,1);
});
test('匯入不自行猜薪資或更改原金額，無效日期、雙欄金額與不明金額拒絕',async()=>{
  const header='日期,分類,支出,收入,定位,註記\n';
  const plan=await prepareReceiptBox(header+'2024-08-05,收入,0,9731,,可用餘額與薪資總額不同','我');assert.equal(plan.incomes[0].amount,9731);
  for(const row of ['2026-02-30,食物,50,0,,早餐','2026-10-01,食物,50,20,,早餐','2026-10-01,食物,1.001,0,,早餐','2026-10-01,食物,-50,0,,早餐'])await assert.rejects(()=>prepareReceiptBox(header+row,'我'));
  assert.equal(receiptBoxCategory('理髮','修眉'),'haircut');assert.equal(receiptBoxCategory('教育','課程'),'education');assert.equal(receiptBoxCategory('酒水','送禮'),'social');assert.equal(receiptBoxCategory('交通','早餐'),'food');
  assert.equal(receiptBoxCategory('食物','加油'),'transport');assert.equal(receiptBoxCategory('日用品','高鐵'),'transport');
});
test('收入與儲蓄可離線重試、偵測修改衝突與刪除墓碑，不改變分帳結算',()=>{
  const put={type:'income.put' as const,income,meta:{id:'m1',actor:'我',actorUid:'owner',at:3,expected:null}};
  const once=applyCloudChange(group,put);assert.deepEqual(applyCloudChange(once,put),once);
  const next=applyCloudChange(once,{type:'saving.put',saving,meta:{id:'m2',actor:'我',actorUid:'owner',at:4,expected:null}});
  assert.deepEqual(utils.calcBalances(next),utils.calcBalances(group));
  assert.equal(overlayPending(next,[{id:'q',groupCode:group.code,change:put}]).incomes?.length,1);
  assert.throws(()=>applyCloudChange(next,{type:'income.put',income:{...income,amount:2000},meta:{...put.meta,id:'edit',expected:fingerprint(income)}}),RecordConflictError);
  const removed=applyCloudChange(next,{type:'income.remove',id:income.id,meta:{id:'remove',actor:'我',actorUid:'owner',at:5,expected:fingerprint(next.incomes![0])}});
  const raw=cloudGroup(removed,cloudGroup(next)) as any;assert.equal(raw.incomes.i1._deleted,true);assert.equal(normalizeGroup(raw).incomes?.length,0);assert.equal(normalizeGroup(raw).savings?.length,1);
  assert.throws(()=>applyChange({...group,kind:'shared'},{type:'income.put',income}),/個人帳本/);
});
test('畫面清單的類型標記不會存入收入或費用，編輯後仍可通過雲端格式',()=>{
  const view={...income,type:'income'};
  const next=applyChange(group,{type:'income.put',income:view,meta:{id:'view',actor:'我',actorUid:'owner',at:4}});
  assert.equal('type' in next.incomes![0],false);
  const expenseView={...expense,type:'expense'};
  assert.equal('type' in applyChange(group,{type:'expense.put',expense:expenseView}).expenses[0],false);
});
test('月報涵蓋閏日、排除下月，年報十二個月加總精確，儲蓄不灌進收支',()=>{
  const book={...group,expenses:[expense,{...expense,id:'march',date:'2024-03-01',amount:30}],incomes:[income],savings:[saving,{...saving,id:'back',direction:'in' as const,amount:50}]};
  const month=summarizePersonal(book,'2024-02','2024-02-28');assert.equal(month.divisor,29);assert.equal(month.expenseCents,10001);assert.equal(month.incomeCents,100000);assert.equal(month.balanceCents,89999);assert.equal(month.savingOutCents-month.savingInCents,15000);assert.equal(month.points[28].expenseCents,10001);assert.equal(month.futureCount,4);
  const year=summarizePersonal(book,'2024','2024-12-31');assert.equal(year.points.length,12);assert.equal(year.expenseCents,13001);assert.equal(year.points.reduce((sum,row)=>sum+row.expenseCents,0),year.expenseCents);assert.equal(year.points.reduce((sum,row)=>sum+row.incomeCents,0),year.incomeCents);
});
test('收入、儲蓄、來源標籤與草稿完整備份還原，CSV 匯出含全部類型',()=>{
  const book={...group,expenses:[{...expense,importSource:{system:'ReceiptBox' as const,category:'食物'},tags:['現金'],location:'測試地點'}],incomes:[income],savings:[saving]};
  const source=memory();source.setItem('warikan_group_654321',JSON.stringify(book));source.setItem('warikan_my_groups',JSON.stringify([{code:'654321',name:'測試',myName:'我',kind:'personal'}]));source.setItem('warikan_cashflow_draft_v1_654321_owner_income',JSON.stringify({kind:'income',amount:'20',desc:'草稿',date:'2024-02-29',direction:'out'}));
  const backup=readBackup(JSON.stringify(createBackup(source))),restored=planRestore(memory(),backup);assert.equal(restored.records,3);assert.equal(restored.pending,3);assert.equal(restored.drafts,1);
  const queue=JSON.parse(restored.entries.warikan_outbox_v1);assert.deepEqual(queue.map(row=>row.change.type).sort(),['expense.put','income.put','saving.put']);
  const csv=groupCsv(book);assert.ok(csv.includes('收入'));assert.ok(csv.includes('存入儲蓄'));assert.ok(csv.includes('現金'));assert.ok(csv.includes('測試地點'));
});
test('收入輸入不可為零、負數或錯誤日期，金額保留分與儲蓄方向',()=>{
  const form={kind:'income' as const,amount:'100.01',desc:'薪資',date:'2024-02-29',direction:'out' as const};assert.equal(cashflowValue(form).amount,100.01);assert.equal('direction' in cashflowValue(form),false);
  assert.equal(cashflowValue({...form,kind:'saving',direction:'in'}).direction,'in');for(const amount of ['0','-1','NaN','100.001'])assert.throws(()=>cashflowValue({...form,amount}));
});
test('新版可讀取舊畫面保留成物件的收入節點，刪除墓碑不會顯示',()=>{
  const store=memory();store.setItem('warikan_group_654321',JSON.stringify({...group,incomes:{i1:income,deleted:{...income,id:'deleted',_deleted:true}},savings:{s1:saving}}));
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store});
  try{const cached=storage.getGroup('654321')!;assert.deepEqual(cached.incomes,[income]);assert.deepEqual(cached.savings,[saving]);}
  finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage');}
});
