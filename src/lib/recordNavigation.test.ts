import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecordView, recordSearchQuery, recordViewKey, saveRecordView } from './recordNavigation';
import { recordGroups } from './recordViews';
import type { Group } from '../types';

test('各帳本只記住瀏覽方式，不保存過去的日期；損壞或無法存取偏好仍可使用', () => {
  const values=new Map<string,string>();const store={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  saveRecordView(store,'123456','month');
  assert.equal(readRecordView(store,'123456'),'month');assert.equal(readRecordView(store,'654321'),'day');
  assert.deepEqual([...values],[[recordViewKey('123456'),'month']]);
  values.set(recordViewKey('123456'),'invalid');assert.equal(readRecordView(store,'123456'),'day');
  assert.equal(readRecordView({getItem(){throw Error('blocked');}},'123456'),'day');
  assert.doesNotThrow(()=>saveRecordView({setItem(){throw Error('full');}},'123456','month'));
});
test('只有有關鍵字的全部日期搜尋會跨月份，退出後保留原來期間、分類與成員條件', () => {
  const original=Object.freeze({period:'2026-10-30',category:'food',scope:'mine' as const});
  const query=recordSearchQuery(original,'早餐',true);
  assert.deepEqual(query,{period:'',category:'food',scope:'mine',search:'早餐'});
  assert.equal(recordSearchQuery(original,'',true).period,original.period);
  assert.equal(recordSearchQuery(original,'早餐',false).period,original.period);
  assert.equal(original.period,'2026-10-30');
  const expense={id:'a',desc:'早餐',amount:80,date:'2026-10-30',payer:'我',participants:['我'],splitMode:'equal' as const,category:'food' as const,createdAt:1};
  const book:Group={code:'123456',kind:'personal',name:'日常',members:['我'],createdAt:1,transfers:[],expenses:[expense,{...expense,id:'b',date:'2025-09-01'},{...expense,id:'c',category:'transport'}]};
  assert.deepEqual(Object.values(recordGroups(book,'我',query)).flat().map(row=>row.id),['a','b']);
  assert.deepEqual(Object.values(recordGroups(book,'我',recordSearchQuery(original,'早餐',false))).flat().map(row=>row.id),['a']);
});
