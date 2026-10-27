import test, { before, after, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Group } from '../src/types';
import { applyChange } from '../src/lib/outbox';
import { cloudGroup } from '../src/lib/firebase';
import { personalLedgerDeletionUpdate } from '../src/lib/ledgerDeletion';
const cloud = (group: Group) => cloudGroup(group) as any;

let env: RulesTestEnvironment;
const group: Group = { code: '123456', name: '權限測試', createdAt: 1, members: ['A','B','C'], expenses: [], transfers: [],
  security: { version: 1, ownerUid: 'owner', users: {
    owner: { name: 'A', nameKey: 'A', role: 'owner' },
    member: { name: 'B', nameKey: 'B', role: 'member' },
    third: { name: 'C', nameKey: 'C', role: 'member' },
  }, names: { A: 'owner', B: 'member', C: 'third' } } };
const owner = () => env.authenticatedContext('owner').database().ref('groups/123456');
const member = () => env.authenticatedContext('member').database().ref('groups/123456');
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-expense-splitting', database: { host: '127.0.0.1', port: 9000, rules: await readFile(new URL('../database.rules.json', import.meta.url), 'utf8') } });
});
after(async () => { await env?.cleanup(); });
test('同步資料僅同一帳號可讀寫，其他匿名身分及列出所有帳號均被拒絕', async () => {
  const own = env.authenticatedContext('owner').database().ref('accountSync/owner');
  const profile = { version: 1, books: { '123456': { code: '123456', name: '權限測試', myName: 'A' } }, bank: { rules: '[]', bridge: 'a'.repeat(64), revision: 1 } };
  await assertSucceeds(own.set(profile));
  await assertSucceeds(own.get());
  await assertFails(env.authenticatedContext('stranger').database().ref('accountSync/owner').get());
  await assertFails(env.authenticatedContext('stranger').database().ref('accountSync/owner').set(profile));
  await assertFails(env.unauthenticatedContext().database().ref('accountSync/owner').get());
  await assertFails(env.authenticatedContext('owner').database().ref('accountSync').get());
  await assertFails(own.child('bank/bridge').set('b'.repeat(64)));
  await assertFails(own.child('bank/revision').set(0));
  await assertFails(own.child('bank/password').set('never-store-password'));
  await assertFails(own.child('books/654321').set({ code: '654321', name: '無權帳本', myName: 'A' }));
  await assertFails(own.child('books/123456/myName').set('B'));
});
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(context => context.database().ref('groups/123456').set(cloud(group)));
});
test('未登入不能讀取新群組，也不能列出所有群組', async () => {
  await assertFails(env.unauthenticatedContext().database().ref('groups/123456').get());
  await assertFails(env.authenticatedContext('owner').database().ref('groups').get());
  await assertSucceeds(member().get());
});
test('匿名裝置可建立自己的群組，但不能指定別人為群主', async () => {
  const newGroup = { ...group, code: '654321', members: ['A'], security: { ...group.security!, users: { owner: group.security!.users.owner }, names: { A: 'owner' } } };
  await assertSucceeds(env.authenticatedContext('owner').database().ref('groups/654321').set(cloud(newGroup)));
  await assertFails(env.authenticatedContext('stranger').database().ref('groups/765432').set(cloud({ ...newGroup, code: '765432' })));
  await assertFails(env.unauthenticatedContext().database().ref('groups/876543').set(cloud({ ...newGroup, code: '876543' })));
});
test('成員可以正常記帳與修改，旁觀者不能寫入帳目', async () => {
  const expense = { id: 'e1', desc: '晚餐', amount: 100, payer: 'A', participants: ['A','B'], splitMode: 'equal' as const, date: '2026-10-02', createdAt: 2 };
  const next = applyChange(group, { type: 'expense.put', expense, meta: { id: 'm1', actor: 'B', actorUid: 'member', at: 3, expected: null } });
  await assertSucceeds(member().child('expenses/e1').set(cloud(next).expenses.e1));
  await assertSucceeds(member().child('history/m1').set(next.history!.m1));
  await assertFails(member().child('history/m1/actor').set('假冒'));
  await assertFails(env.authenticatedContext('stranger').database().ref('groups/123456/expenses/e1').set(cloud(next).expenses.e1));
  const edited = applyChange(next, { type: 'expense.put', expense: { ...expense, amount: 200 }, meta: { id: 'm2', actor: 'A', actorUid: 'owner', at: 4 } });
  await assertSucceeds(owner().child('expenses/e1').set(cloud(edited).expenses.e1));
  const removed = applyChange(edited, { type: 'expense.remove', id: 'e1', meta: { id: 'm3', actor: 'B', actorUid: 'member', at: 5 } });
  await assertSucceeds(member().child('expenses/e1').set({ ...cloud(edited).expenses.e1, _deleted: true, lastMutationId: 'm3', updatedByUid: 'member', _lastAudit: removed.history!.m3 }));
  await assertFails(member().child('expenses/e1').remove());
});
test('只有群主可改名或增刪預設成員，直接呼叫 API 也不能繞過', async () => {
  await assertFails(member().set({ ...group, name: '成員擅自改名' }));
  await assertFails(member().set({ ...group, members: ['A','B'] }));
  await assertFails(member().set({ ...group, members: [...group.members, 'D'] }));
  await assertSucceeds(owner().set(cloud({ ...group, name: '群主更新名稱' })));
  await assertSucceeds(owner().set(cloud({ ...group, name: '群主更新名稱', members: [...group.members, 'D'] })));
});
test('成員不能冒用群主身分、移除他人 UID 或降級為公開群組', async () => {
  await assertFails(member().set({ ...group, security: { ...group.security!, ownerUid: 'member' } }));
  await assertFails(member().set({ ...group, security: { ...group.security!, users: { ...group.security!.users, member: { name: 'B', nameKey: 'B', role: 'owner' } } } }));
  const users = { ...group.security!.users }, names = { ...group.security!.names };
  delete users.third; delete names.C;
  await assertFails(member().set({ ...group, security: { ...group.security!, users, names } }));
  const { security, ...legacy } = group;
  await assertFails(member().set(legacy));
  await assertFails(owner().set(legacy));
});
test('知道邀請碼可自行加入為成員，但不能冒用已綁定姓名或順便修改帳目', async () => {
  const joined = { ...group, members: [...group.members, 'D'], security: { ...group.security!,
    users: { ...group.security!.users, guest: { name: 'D', nameKey: 'D', role: 'member' as const } },
    names: { ...group.security!.names, D: 'guest' } } };
  const guest = env.authenticatedContext('guest').database().ref('groups/123456');
  await assertFails(guest.set({ ...joined, name: '偷改名稱' }));
  await assertFails(guest.set({ ...joined, members: ['A','B','D'] }));
  await assertFails(guest.set({ ...joined, security: { ...joined.security, users: { ...joined.security.users, guest: { name: 'A', nameKey: 'A', role: 'member' } }, names: { ...joined.security.names, A: 'guest' } } }));
  await assertSucceeds(guest.child('security').update({ 'users/guest': joined.security.users.guest, 'names/D': 'guest' }));
  await assertSucceeds(guest.child('members/D').set(true));
  await assertFails(guest.child('members/C').remove());
});
test('群主預設的未綁定姓名可由新成員加入，不重複增加姓名', async () => {
  const pending = { ...group, members: [...group.members, 'D'] };
  await assertSucceeds(owner().set(cloud(pending)));
  const guest = env.authenticatedContext('guest').database().ref('groups/123456');
  await assertSucceeds(guest.child('security').update({ 'users/guest': { name: 'D', nameKey: 'D', role: 'member' }, 'names/D': 'guest' }));
  await assertSucceeds(guest.child('members/D').set(true));
});
test('舊群組仍可記帳，但不能僅靠名字或邀請碼認領群主', async () => {
  const { security, ...legacy } = group;
  await env.withSecurityRulesDisabled(context => context.database().ref('groups/123456').set(legacy));
  await assertSucceeds(env.unauthenticatedContext().database().ref('groups/123456').get());
  await assertSucceeds(env.unauthenticatedContext().database().ref('groups/123456').set({ ...legacy, name: '舊版仍可更新' }));
  await assertFails(owner().set(group));
  await assertFails(env.authenticatedContext('stranger').database().ref('groups/123456').set(group));
});
test('新增保護群組的負數帳目或偽造修改者 UID 會被拒絕', async () => {
  const expense = { id: 'e1', desc: '晚餐', amount: -1, payer: 'A', participants: ['A','B'], splitMode: 'equal' as const, date: '2026-10-02', createdAt: 2 };
  const wrong = applyChange(group, { type: 'expense.put', expense, meta: { id: 'm1', actor: 'B', actorUid: 'member', at: 3 } });
  await assertFails(member().child('expenses/e1').set(cloud(wrong).expenses.e1));
  await assertFails(member().child('expenses/e1').set({ ...cloud(wrong).expenses.e1, amount: 100, updatedByUid: 'owner' }));
});
test('直接修改身分子路徑也不能升級角色、刪除 UID 或冒用姓名', async () => {
  await assertFails(member().child('security/users/member/role').set('owner'));
  await assertFails(member().child('security/users/third').remove());
  await assertFails(member().child('security/users/member').remove());
  await assertFails(member().child('security/names/C').set('member'));
  await assertFails(member().child('security/names/B').remove());
  await assertFails(member().child('security').update({ 'users/member/name': 'D', 'users/member/nameKey': 'D', 'names/D': 'member' }));
});
test('成員不能刪除或覆寫已上傳的修改歷史', async () => {
  const entry = { id: 'm1', actor: 'B', actorUid: 'member', at: 3, action: 'expense.put', target: 'e1', changes: [] };
  await assertSucceeds(member().child('history/m1').set(entry));
  await assertFails(member().child('history/m1').remove());
  await assertFails(member().child('history/m1').set({ ...entry, at: 4 }));
});

const personal: Group = {kind:'personal',code:'654321',name:'日常記帳',createdAt:1,members:['A'],expenses:[],transfers:[],security:{version:1,ownerUid:'owner',users:{owner:{name:'A',nameKey:'A',role:'owner'}},names:{A:'owner'}}};
const privateRef=(uid='owner')=>env.authenticatedContext(uid).database().ref('groups/654321');
const personalExpense={id:'pe1',desc:'午餐',amount:120,payer:'A',participants:['A'],splitMode:'equal' as const,date:'2026-10-27',createdAt:2};
test('個人帳本刪除必須與防重建標記同時完成，只允許本人操作',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  await assertSucceeds(privateRef().set(cloud({...personal,expenses:[personalExpense]})));
  const patch=personalLedgerDeletionUpdate(personal,'owner',{'.sv':'timestamp'});
  await assertFails(privateRef().remove());
  await assertFails(env.authenticatedContext('owner').database().ref('deletedPersonalLedgers/654321').set({ownerUid:'owner',deletedAt:{'.sv':'timestamp'}}));
  await assertFails(env.authenticatedContext('stranger').database().ref().update(patch));
  await assertFails(env.unauthenticatedContext().database().ref().update(patch));
  await assertSucceeds(env.authenticatedContext('owner').database().ref().update(patch));
  const deleted=await assertSucceeds(privateRef().get());
  if (deleted.exists()) throw new Error('帳本及記錄仍存在');
  await assertSucceeds(env.authenticatedContext('owner').database().ref('deletedPersonalLedgers/654321').get());
  await assertFails(env.authenticatedContext('stranger').database().ref('deletedPersonalLedgers/654321').get());
  await assertFails(env.authenticatedContext('owner').database().ref('deletedPersonalLedgers').get());
});
test('舊版、離線佇列與備份不能重建已刪除帳本或移除防重建標記',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  await assertSucceeds(env.authenticatedContext('owner').database().ref().update(personalLedgerDeletionUpdate(personal,'owner',{'.sv':'timestamp'})));
  await assertFails(privateRef().set(cloud(personal)));
  await assertFails(privateRef().child('expenses/pe1').set(personalExpense));
  await assertFails(env.unauthenticatedContext().database().ref('groups/654321').set({...personal,security:null}));
  await assertFails(env.authenticatedContext('owner').database().ref('deletedPersonalLedgers/654321').remove());
  await assertFails(env.authenticatedContext('owner').database().ref('deletedPersonalLedgers/654321/deletedAt').set(1));
  await assertFails(env.authenticatedContext('stranger').database().ref('groups/654321').set(cloud({...personal,security:{...personal.security!,ownerUid:'stranger',users:{stranger:{name:'A',nameKey:'A',role:'owner'}},names:{A:'stranger'}}})));
});
test('新的刪除權限不允許刪除共用帳本或舊群組',async()=>{
  await assertFails(owner().remove());
  await assertFails(env.authenticatedContext('owner').database().ref().update({'groups/123456':null,'deletedPersonalLedgers/123456':{ownerUid:'owner',deletedAt:{'.sv':'timestamp'}}}));
  const {security,...legacy}=group;
  await env.withSecurityRulesDisabled(context=>context.database().ref('groups/123456').set(legacy));
  await assertFails(env.unauthenticatedContext().database().ref('groups/123456').remove());
});
test('個人帳本只能由建立者讀取，知道帳本代碼仍不能讀取明細或名稱',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  await assertSucceeds(privateRef().get());
  await assertFails(privateRef('stranger').get());
  await assertFails(privateRef('member').child('name').get());
  await assertFails(privateRef('stranger').child('expenses').get());
  await assertFails(env.unauthenticatedContext().database().ref('groups/654321').get());
});
test('個人帳本拒絕自行加入，也不能把自己加入身分或成員子路徑',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  await assertFails(privateRef('guest').child('security').update({'users/guest':{name:'D',nameKey:'D',role:'member'},'names/D':'guest'}));
  await assertFails(privateRef('guest').child('security/users/guest').set({name:'D',nameKey:'D',role:'member'}));
  await assertFails(privateRef('guest').child('members/D').set(true));
  await assertFails(privateRef('guest').set(cloud({...personal,members:['A','D']})));
});
test('個人帳本種類不可改為共用或刪除，既有共用帳本也不會被轉為私人',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  await assertFails(privateRef().child('kind').set('shared'));
  await assertFails(privateRef().child('kind').remove());
  await assertFails(privateRef().set(cloud({...personal,kind:'shared'})));
  const {kind,...missingKind}=personal; await assertFails(privateRef().set(cloud(missingKind)));
  await assertFails(owner().child('kind').set('personal'));
  await assertSucceeds(owner().child('name').set('共用帳本維持正常'));
});
test('個人帳本可正常新增、編輯、刪除支出與變更帳本名稱',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  const next=applyChange(personal,{type:'expense.put',expense:personalExpense,meta:{id:'pm1',actor:'A',actorUid:'owner',at:3,expected:null}});
  await assertSucceeds(privateRef().child('expenses/pe1').set(cloud(next).expenses.pe1));
  await assertSucceeds(privateRef().child('history/pm1').set(next.history!.pm1));
  await assertSucceeds(privateRef().child('expenses/pe1/amount').set(150));
  await assertSucceeds(privateRef().child('expenses/pe1/_deleted').set(true));
  await assertSucceeds(privateRef().child('name').set('每日花費'));
});
test('個人帳本即使建立者直接寫入，也不能增加成員、分攤對象或轉帳',async()=>{
  await assertSucceeds(privateRef().set(cloud(personal)));
  await assertFails(privateRef().child('members/D').set(true));
  await assertFails(privateRef().child('security').update({'users/guest':{name:'D',nameKey:'D',role:'member'},'names/D':'guest'}));
  await assertFails(privateRef().child('expenses/pe1').set({...personalExpense,payer:'D'}));
  await assertFails(privateRef().child('expenses/pe1').set({...personalExpense,participants:{0:'A',2:'A'}}));
  await assertFails(privateRef().child('transfers/t1').set({id:'t1',from:'A',to:'D',amount:1,date:'2026-10-27',createdAt:2}));
});
test('個人帳本建立時就必須只有建立者，不能混入其他成員或冒用他人身分',async()=>{
  await assertFails(privateRef('guest').set(cloud(personal)));
  await assertFails(privateRef().set(cloud({...personal,members:['A','D']})));
  await assertFails(privateRef().set(cloud({...personal,security:{...personal.security!,users:{...personal.security!.users,guest:{name:'D',nameKey:'D',role:'member'}},names:{...personal.security!.names,D:'guest'}}})));
  await assertSucceeds(privateRef().set(cloud(personal)));
});
test('明確標記為共用的新帳本仍可使用邀請碼加入與共同記帳',async()=>{
  await assertSucceeds(privateRef().set(cloud({...personal,kind:'shared'})));
  await assertSucceeds(privateRef('guest').child('security').update({'users/guest':{name:'D',nameKey:'D',role:'member'},'names/D':'guest'}));
  await assertSucceeds(privateRef('guest').child('members/D').set(true));
  const shared={...personal,kind:'shared' as const,members:['A','D']};
  const next=applyChange(shared,{type:'expense.put',expense:{...personalExpense,participants:['A','D']},meta:{id:'sm1',actor:'D',actorUid:'guest',at:3,expected:null}});
  await assertSucceeds(privateRef('guest').child('expenses/pe1').set(cloud(next).expenses.pe1));
});
