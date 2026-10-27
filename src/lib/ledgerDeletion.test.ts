import assert from 'node:assert/strict';
import test from 'node:test';
import type { Group } from '../types';
import { cleanupDeletedLedger, personalLedgerDeletionUpdate } from './ledgerDeletion';
import { bankBridgeKey, bankRulesKey, newBankRule, readBankRules, saveBankRules } from './bankShortcuts';

const ledger: Group = {kind:'personal',code:'654321',name:'日常記帳',members:['我'],expenses:[],transfers:[],createdAt:1,security:{version:1,ownerUid:'owner',users:{owner:{name:'我',nameKey:'我',role:'owner'}},names:{我:'owner'}}};
const memory = () => {
  const data=new Map<string,string>();
  return {data,get length(){return data.size;},key:(index:number)=>[...data.keys()][index]||null,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
};

test('刪除請求只包含本人個人帳本與防重建標記，拒絕共用與其他身分',()=>{
  assert.deepEqual(personalLedgerDeletionUpdate(ledger,'owner',123),{'groups/654321':null,'deletedPersonalLedgers/654321':{ownerUid:'owner',deletedAt:123}});
  assert.throws(()=>personalLedgerDeletionUpdate({...ledger,kind:'shared'},'owner',123));
  assert.throws(()=>personalLedgerDeletionUpdate(ledger,'other',123));
  assert.throws(()=>personalLedgerDeletionUpdate({...ledger,security:undefined},'owner',123));
});

test('刪除清理只移除該帳本、草稿、銀行規則與佇列，保留其他帳本和身分',()=>{
  const store=memory();
  const rule=newBankRule({bank:'測試銀行',last4:'0123',groupCode:ledger.code,payer:'我',participants:['我'],category:'food',mode:'review',limit:10000});
  const other=newBankRule({...rule,groupCode:'123456',last4:'4567'});
  saveBankRules(store,[rule,other]);
  const kept={'warikan_group_123456':'other-ledger','warikan_draft_v1_123456_A':'other-draft','warikan_last_group':'123456',[bankBridgeKey]:'binding','firebase:authUser:project':'identity','warikan_appearance_v1':'dark'};
  for(const [key,value] of Object.entries(kept))store.setItem(key,value);
  store.setItem('warikan_my_groups',JSON.stringify([{code:ledger.code,name:ledger.name},{code:'123456',name:'其他'}]));
  store.setItem('warikan_group_654321',JSON.stringify(ledger));
  store.setItem('warikan_draft_v1_654321_我','draft');store.setItem('warikan_templates_v1_654321_我','templates');
  store.setItem('warikan_outbox_v1',JSON.stringify([{id:'p1',groupCode:ledger.code},{id:'p2',groupCode:'123456'}]));
  cleanupDeletedLedger(store,ledger.code);
  assert.equal(store.getItem('warikan_group_654321'),null);assert.equal(store.getItem('warikan_draft_v1_654321_我'),null);assert.equal(store.getItem('warikan_templates_v1_654321_我'),null);
  for(const [key,value] of Object.entries(kept))assert.equal(store.getItem(key),value);
  assert.deepEqual(JSON.parse(store.getItem('warikan_my_groups')!),[{code:'123456',name:'其他'}]);
  assert.deepEqual(JSON.parse(store.getItem('warikan_outbox_v1')!),[{id:'p2',groupCode:'123456'}]);
  assert.deepEqual(readBankRules(store),[other]);
  cleanupDeletedLedger(store,ledger.code);
  assert.deepEqual(readBankRules(store),[other]);
});

test('清理寫入失敗會回復本機資料，不留下只刪一半的帳本清單',()=>{
  const store=memory();store.setItem('warikan_my_groups',JSON.stringify([{code:ledger.code}]));store.setItem('warikan_group_654321',JSON.stringify(ledger));store.setItem('warikan_outbox_v1','[]');
  const before=[...store.data];let failed=false;
  const failing={...store,setItem:(key:string,value:string)=>{if(key==='warikan_outbox_v1'&&!failed){failed=true;throw new Error('quota');}store.setItem(key,value);}};
  assert.throws(()=>cleanupDeletedLedger(failing,ledger.code),/本機資料清理未完成/);
  assert.deepEqual([...store.data],before);
});
