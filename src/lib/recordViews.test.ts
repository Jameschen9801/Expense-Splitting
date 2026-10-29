import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense, Group } from '../types';
import { dayInMonth, matchesRecordPeriod, recordGroups, recordTotals, resetRecordQuery, shiftRecordMonth } from './recordViews';

const expense:Expense={id:'e1',desc:'晚餐',amount:100.01,date:'2026-10-29',payer:'A',participants:['A','B'],splitMode:'equal',category:'food',createdAt:1,tags:['現金']};
const group:Group={kind:'personal',code:'123456',name:'日常',members:['A'],createdAt:1,expenses:[expense,{...expense,id:'e2',date:'2026-09-29',category:'transport',desc:'車票',amount:800}],transfers:[],incomes:[{id:'i1',desc:'薪資',amount:2000,date:'2026-10-29',createdAt:2,tags:['現金']}],savings:[{id:'s1',desc:'預備金',amount:300,date:'2026-10-29',createdAt:3,tags:['現金']}]};

test('清除篩選回目前月份與今天，清掉分類搜尋而非跳至全部歷史',()=>{
  assert.deepEqual(resetRecordQuery('2026-10-29'),{period:'2026-10',day:'2026-10-29',category:'',search:'',scope:'all'});
  assert.equal(resetRecordQuery('2027-01-01').period,'2027-01');
});
test('月份前後切換正確跨年，選日期在短月與閏年保留有效日期',()=>{
  assert.equal(shiftRecordMonth('2026-12',1),'2027-01');assert.equal(shiftRecordMonth('2027-01',-1),'2026-12');
  assert.equal(dayInMonth('2026-02','2026-01-31'),'2026-02-28');assert.equal(dayInMonth('2024-02','2024-01-31'),'2024-02-29');
  assert.equal(dayInMonth('2026-11','2026-10-31'),'2026-11-30');assert.equal(dayInMonth('2026-10','2026-09-29'),'2026-10-29');
});
test('按日、月份與年份範圍不混用，也不把相近日期算進當天',()=>{
  assert.equal(matchesRecordPeriod('2026-10-29','2026-10-29'),true);assert.equal(matchesRecordPeriod('2026-10-28','2026-10-29'),false);
  assert.equal(matchesRecordPeriod('2026-10-29','2026-10'),true);assert.equal(matchesRecordPeriod('2026-10-29','2026'),true);assert.equal(matchesRecordPeriod('2025-10-29','2026'),false);
  assert.equal(Object.values(recordGroups(group,'A',{period:'2026-10-29'})).flat().length,3);
});
test('每日花銷精確到分，收入、儲蓄與還款不誤算為支出',()=>{
  const rows=Object.values(recordGroups(group,'A',{period:'2026-10-29'})).flat();
  assert.deepEqual(recordTotals(rows,'A'),{expenseCents:10001,incomeCents:200000,count:3});
  const shared=recordGroups({...group,kind:'shared',incomes:[],savings:[],transfers:[{id:'t1',from:'A',to:'B',amount:500,date:'2026-10-29',createdAt:2}]},'A',{period:'2026-10-29'});
  assert.deepEqual(recordTotals(Object.values(shared).flat(),'A',false),{expenseCents:5001,incomeCents:0,count:2});
});
test('統計的支出明細不混入收入儲蓄，分類與標籤明細各有正確範圍',()=>{
  assert.deepEqual(Object.values(recordGroups(group,'A',{period:'2026-10',category:'expense'})).flat().map(row=>row.id),['e1']);
  assert.deepEqual(Object.values(recordGroups(group,'A',{period:'2026',category:'transport'})).flat().map(row=>row.id),['e2']);
  const tagged=Object.values(recordGroups(group,'A',{period:'2026-10',category:'cashflow',tag:'現金'})).flat();
  assert.equal(tagged.length,2);assert.ok(tagged.every(row=>row.type==='expense'||row.type==='income'));
});
test('打開與搜尋統計明細不修改常態帳本的日期、分類和搜尋條件',()=>{
  const main=Object.freeze({period:'2026-10-29',category:'food',search:'晚餐',scope:'all' as const});
  const before=JSON.stringify(group);const visible=recordGroups(group,'A',main);
  const report=recordGroups(group,'A',{period:'2026',category:'transport',search:'車票'});
  assert.deepEqual(Object.values(visible).flat().map(row=>row.id),['e1']);assert.deepEqual(Object.values(report).flat().map(row=>row.id),['e2']);
  assert.equal(main.period,'2026-10-29');assert.equal(main.category,'food');assert.equal(JSON.stringify(group),before);
});
test('日期內完整小計不受顯示分批上限影響，零分攤不灌入日支出',()=>{
  const many={...group,expenses:Array.from({length:60},(_,index)=>({...expense,id:'e'+index,amount:0.01})),incomes:[],savings:[]};
  assert.equal(recordTotals(Object.values(recordGroups(many,'A',{period:'2026-10-29'})).flat(),'A').expenseCents,60);
  const zero={...expense,splitMode:'custom' as const,shares:[{name:'A',amount:0},{name:'B',amount:100.01}]};
  assert.equal(recordTotals([{...zero,type:'expense'}],'A',false).expenseCents,0);
});
