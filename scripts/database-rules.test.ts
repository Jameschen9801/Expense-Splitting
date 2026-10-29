import test, { before, after, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Group } from '../src/types';
import { applyChange } from '../src/lib/outbox';
import { fingerprint } from '../src/lib/audit';
import { cloudGroup, normalizeGroup as normalizeGroupForTest } from '../src/lib/firebase';
import { personalLedgerDeletionUpdate } from '../src/lib/ledgerDeletion';
import { projectSharedExpenses } from '../src/lib/sharedExpenses';
import { projectSharedDrafts, sharedDraftExpense } from '../src/lib/sharedInbox';
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
test('背景憑證與接收管理路徑不允許前端帳號直接讀寫', async () => {
  await env.withSecurityRulesDisabled(context => context.database().ref().update({ bankIngressKeys: { digest: { uid: 'owner' } }, bankIngressUsers: { owner: { keys: { digest: { enabled: true } } } } }));
  for (const context of [env.authenticatedContext('owner'), env.authenticatedContext('stranger'), env.unauthenticatedContext()]) {
    for (const path of ['bankIngressKeys', 'bankIngressKeys/digest', 'bankIngressUsers/owner', 'bankIngressUsers/owner/keys/digest']) {
      await assertFails(context.database().ref(path).get());
      await assertFails(context.database().ref(path).set({ enabled: true }));
    }
  }
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
test('個人收入與儲蓄僅本人可讀寫，共用帳本與背景服務不能存取',async()=>{
  await privateRef().set(cloud(personal));
  const income={id:'i1',desc:'薪資',amount:10000,date:'2026-10-28',createdAt:2};
  const saving={id:'s1',desc:'預備金',amount:1000,date:'2026-10-28',createdAt:3,direction:'out' as const};
  const next=applyChange(applyChange(personal,{type:'income.put',income,meta:{id:'im1',actor:'A',actorUid:'owner',at:4}}),{type:'saving.put',saving,meta:{id:'sm1',actor:'A',actorUid:'owner',at:5}});
  await assertSucceeds(privateRef().set(cloud(next)));
  await assertSucceeds(privateRef().child('incomes/i1/amount').set(12000));
  for(const uid of ['member','stranger'])for(const path of ['incomes/i1','savings/s1']){
    await assertFails(privateRef(uid).child(path).get());await assertFails(privateRef(uid).child(path).set(income));
  }
  await assertFails(owner().child('incomes/i1').set(income));await assertFails(owner().child('savings/s1').set(saving));
  await assertFails(privateRef().child('incomes/i1/amount').set(-1));await assertFails(privateRef().child('savings/s1/direction').set('invalid'));
  const removed=applyChange(next,{type:'income.remove',id:'i1',meta:{id:'im2',actor:'A',actorUid:'owner',at:6}});
  await assertSucceeds(privateRef().set(cloudGroup(removed,cloud(next))));
});
test('核准的新分類及匯入地點標籤可保存，未知欄位或過長資料不能寫入收入',async()=>{
  await privateRef().set(cloud(personal));
  await assertSucceeds(privateRef().child('expenses/education').set({...personalExpense,id:'education',category:'education',importSource:{system:'ReceiptBox',category:'教育'},location:'教室',tags:['現金']}));
  await assertSucceeds(privateRef().child('expenses/haircut').set({...personalExpense,id:'haircut',category:'haircut'}));
  const income={id:'i1',desc:'收入',amount:100,date:'2026-10-28',createdAt:2,importSource:{system:'ReceiptBox',category:'收入'}};
  await assertSucceeds(privateRef().child('incomes/i1').set(income));
  await assertFails(privateRef().child('incomes/i1').set({...income,location:'x'.repeat(301)}));
  await assertFails(privateRef().child('incomes/i1').set({...income,unknown:'unexpected'}));
});
test('分攤同步設定只由本人存取，只能連結自己的個人帳本與正確的共用身分', async () => {
  await privateRef().set(cloud(personal));
  const own = env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456');
  const link = {targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'};
  await assertSucceeds(own.set(link)); await assertSucceeds(own.get());
  await assertFails(env.authenticatedContext('member').database().ref('personalLedgerLinks/owner').get());
  await assertFails(env.authenticatedContext('member').database().ref('personalLedgerLinks/owner/123456').set(link));
  await assertFails(env.authenticatedContext('member').database().ref('personalLedgerLinks/member/123456').set({...link,memberName:'B'}));
  await assertFails(own.set({...link,memberName:'B'}));
  await assertFails(own.set({...link,targetCode:'123456'}));
  await assertFails(own.set({...link,extra:'unexpected'}));
  await assertFails(env.unauthenticatedContext().database().ref('personalLedgerLinks/owner').get());
  await assertSucceeds(own.set({...link,enabled:false}));
});
test('舊版共用帳本也能設定分攤同步，個人帳本不能當來源', async () => {
  await privateRef().set(cloud(personal));
  const {security,...legacy}=group;
  await env.withSecurityRulesDisabled(context=>context.database().ref('groups/123456').set(legacy));
  const links=env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner');
  await assertSucceeds(links.child('123456').set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'}));
  await assertFails(links.child('654321').set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'}));
});
test('同步分攤與通知連結可原子儲存，其他成員不能讀寫個人記錄', async () => {
  const expense={...personalExpense,id:'shared',amount:2000,payer:'A',participants:['A','B']};
  const [legacyCopy]=await projectSharedExpenses({...group,expenses:[expense]},'A','A');
  const copy={...legacyCopy,sharedSource:{...legacyCopy.sharedSource!,sourceVersion:'a'.repeat(64),confirmedAt:2}};
  const draft={...personalExpense,id:'ebank_notice',amount:2000,bank:'Richart',last4:'0123',category:'other' as const};
  const initial={...personal,expenses:[copy],bankInbox:[draft],bankReceiptIds:[draft.id]};
  await assertSucceeds(privateRef().set(cloud(personal)));
  await env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456').set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'});
  await assertSucceeds(privateRef().set(cloud(initial)));
  const {sharedSource,...detached}=cloud(initial).expenses[copy.id];
  await assertFails(privateRef().child('expenses/'+copy.id).set(detached));
  const linked=applyChange(initial,{type:'bankDraft.link',id:draft.id,expenseId:copy.id,meta:{id:'link',actor:'A',actorUid:'owner',at:3}});
  await assertSucceeds(privateRef().set(cloudGroup(linked,cloud(initial))));
  await assertFails(privateRef('member').child('expenses/'+copy.id).get());
  await assertFails(privateRef('member').child('expenses/'+copy.id).set(copy));
  await env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456/enabled').set(false);
  const removed=applyChange(linked,{type:'expense.remove',id:copy.id,meta:{id:'unlink',actor:'A',actorUid:'owner',at:4}});
  await assertSucceeds(privateRef().set(cloudGroup(removed,cloudGroup(linked,cloud(initial)))));
  await assertFails(privateRef().child('expenses/'+copy.id).set(cloud(initial).expenses[copy.id]));
});
test('分攤待確認只能本人存取，起始日以前及舊版直接入帳被拒絕', async () => {
  await privateRef().set(cloud(personal));
  const link={targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'};
  await env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456').set(link);
  const original={...personalExpense,id:'r1',amount:2000,date:'2026-10-29',participants:['A','B']};
  const [draft]=await projectSharedDrafts({...group,expenses:[original]},'A','A','2026-10-29');
  const waiting=applyChange(personal,{type:'sharedDraft.put',draft,meta:{id:'sp1',actor:'A',actorUid:'owner',at:3}});
  await assertSucceeds(privateRef().set(cloud(waiting)));
  await assertFails(privateRef('member').child('sharedInbox/'+draft.id).get());
  await assertFails(privateRef('member').child('sharedInbox/'+draft.id).set(draft));
  const [legacy]=await projectSharedExpenses({...group,expenses:[original]},'A','A');
  await assertFails(privateRef().child('expenses/'+legacy.id).set(legacy));
  const [old]=await projectSharedDrafts({...group,expenses:[{...original,id:'old',date:'2026-10-28'}]},'A','A','2026-10-28');
  await assertFails(privateRef().child('sharedInbox/'+old.id).set(old));
  const form={desc:'自己確認的說明',amount:String(draft.amount),date:draft.date,category:'shopping' as const,payer:'A',participants:['A'],splitMode:'equal' as const,customShares:{}};
  const confirmed=applyChange(waiting,{type:'sharedDraft.confirm',id:draft.id,expense:sharedDraftExpense(draft,form,5),expectedExpense:null,meta:{id:'sc1',actor:'A',actorUid:'owner',at:5,expected:fingerprint(waiting.sharedInbox![0])}});
  await assertSucceeds(privateRef().set(cloudGroup(confirmed,cloud(waiting))));
  await env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456/enabled').set(false);
  await assertSucceeds(privateRef().child('expenses/'+draft.id+'/desc').set('確認後自行修改'));
  const raw=(await privateRef().get()).val();
  await assertFails(privateRef().child('expenses/'+draft.id).set({...raw.expenses[draft.id],_deleted:true,_lastAudit:{...raw.expenses[draft.id]._lastAudit,action:'expense.remove'}}));
  const current=normalizeGroupForTest(raw);
  const removed=applyChange(current,{type:'expense.remove',id:draft.id,meta:{id:'sd1',actor:'A',actorUid:'owner',at:6}});
  await assertSucceeds(privateRef().set(cloudGroup(removed,raw)));
});
test('更換目標後舊目標不能再收新分攤，忽略標記不能被重送繞過', async () => {
  const other={...personal,code:'654322',name:'第二本'};
  await privateRef().set(cloud(personal));await env.authenticatedContext('owner').database().ref('groups/654322').set(cloud(other));
  const link=env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456');
  await link.set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'});
  const [draft]=await projectSharedDrafts({...group,expenses:[{...personalExpense,id:'move',amount:2000,date:'2026-10-29',participants:['A','B']}]},'A','A','2026-10-29');
  await link.set({targetCode:'654322',memberName:'A',enabled:true,mode:'review',since:'2026-10-29',formerTargets:{'654321':true}});
  await assertFails(privateRef().child('sharedInbox/'+draft.id).set(draft));
  const newRef=env.authenticatedContext('owner').database().ref('groups/654322');
  const pending=applyChange(other,{type:'sharedDraft.put',draft,meta:{id:'new1',actor:'A',actorUid:'owner',at:3}});
  await assertSucceeds(newRef.set(cloud(pending)));
  const ignored=applyChange(pending,{type:'sharedDraft.remove',id:draft.id,meta:{id:'ignore1',actor:'A',actorUid:'owner',at:4}});
  await assertSucceeds(newRef.set(cloudGroup(ignored,cloud(pending))));
  await assertFails(newRef.child('sharedInbox/'+draft.id).set(draft));
  await assertFails(env.authenticatedContext('member').database().ref('groups/654322/sharedHandled').get());
});
test('暫停後可確認已收到的分攤，不能再建立新的待確認', async () => {
  await privateRef().set(cloud(personal));
  const link=env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456');
  await link.set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'});
  const [draft]=await projectSharedDrafts({...group,expenses:[{...personalExpense,id:'pause',date:'2026-10-29'}]},'A','A','2026-10-29');
  const pending=applyChange(personal,{type:'sharedDraft.put',draft,meta:{id:'p1',actor:'A',actorUid:'owner',at:3}});
  await privateRef().set(cloud(pending));await link.child('enabled').set(false);
  await assertSucceeds(privateRef().child('name').set('暫停仍可記帳'));
  const form={desc:'確認',amount:String(draft.amount),date:draft.date,category:'food' as const,payer:'A',participants:['A'],splitMode:'equal' as const,customShares:{}};
  const confirmed=applyChange(pending,{type:'sharedDraft.confirm',id:draft.id,expense:sharedDraftExpense(draft,form,5),expectedExpense:null,meta:{id:'p2',actor:'A',actorUid:'owner',at:5}});
  await assertSucceeds(privateRef().set(cloudGroup(confirmed,cloud(pending))));
  const [newDraft]=await projectSharedDrafts({...group,expenses:[{...personalExpense,id:'pause-new',date:'2026-10-29'}]},'A','A','2026-10-29');
  await assertFails(privateRef().child('sharedInbox/'+newDraft.id).set(newDraft));
});
test('銀行背景服務不能存取共用分攤待確認與處理標記', async () => {
  await seedBankService();
  for(const path of ['sharedInbox','sharedHandled']){
    await assertFails(serviceRef('groups/654321/'+path).get());
    await assertFails(serviceRef('groups/654321/'+path+'/fake').set({status:'ignored',version:'a'.repeat(64)}));
  }
});
test('舊版副本先移到待確認後能首次確認，原始墓碑不會阻止新流程', async () => {
  const original={...personalExpense,id:'legacy-migrate',amount:2000,date:'2026-10-29',participants:['A','B']};
  const source={...group,expenses:[original]};
  const [legacy]=await projectSharedExpenses(source,'A','A');
  const before={...personal,expenses:[legacy]};
  await env.withSecurityRulesDisabled(context=>context.database().ref('groups/654321').set(cloud(before)));
  await env.authenticatedContext('owner').database().ref('personalLedgerLinks/owner/123456').set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29',cleanupLegacy:true});
  const [draft]=await projectSharedDrafts(source,'A','A','2026-10-29');
  const removed=applyChange(before,{type:'expense.remove',id:legacy.id,meta:{id:'legacy-remove',actor:'A',actorUid:'owner',at:3}});
  const pending=applyChange(removed,{type:'sharedDraft.put',draft,meta:{id:'legacy-review',actor:'A',actorUid:'owner',at:4}});
  const pendingRaw=cloudGroup(pending,cloud(before));
  await assertSucceeds(privateRef().set(pendingRaw));
  const form={desc:'確認後的說明',amount:String(draft.amount),date:draft.date,category:'food' as const,payer:'A',participants:['A'],splitMode:'equal' as const,customShares:{}};
  const confirmed=applyChange(pending,{type:'sharedDraft.confirm',id:draft.id,expense:sharedDraftExpense(draft,form,5),expectedExpense:null,meta:{id:'legacy-confirm',actor:'A',actorUid:'owner',at:5}});
  await assertSucceeds(privateRef().set(cloudGroup(confirmed,pendingRaw)));
});
const serviceRef = (path = '') => env.authenticatedContext('bank-service').database().ref(path || undefined);
async function seedBankService() {
  await env.withSecurityRulesDisabled(context => context.database().ref().update({
    'bankBackgroundServices/bank-service': true,
    'groups/654321': cloud(personal),
    'accountSync/owner': { version: 1, books: { '654321': { code: '654321', name: personal.name, myName: 'A' } }, bank: { rules: '[]', bridge: 'b'.repeat(64), revision: 1 } },
  }));
}
function serviceCapture() {
  const id = 'ebank_' + 'a'.repeat(64), at = Date.now();
  const next = applyChange(personal, { type: 'bankDraft.put', draft: { ...personalExpense, id, createdAt: at, category: 'other', bank: 'Richart', last4: '0123' }, meta: { id: 'm' + id, actor: 'A', actorUid: 'owner', at, expected: null } });
  return { id, draft: cloud(next).bankInbox[id], audit: next.history!['m' + id] };
}
test('背景服務只能讀取所需路徑，不能列出帳號、讀同步憑證或變更設定', async () => {
  await seedBankService();
  for (const path of ['accountSync/owner/bank/rules', 'groups/654321/security', 'groups/654321/expenses', 'groups/654321/bankInbox', 'groups/654321/history']) await assertSucceeds(serviceRef(path).get());
  for (const path of ['', 'groups', 'groups/654321', 'groups/123456/security', 'accountSync', 'accountSync/owner', 'accountSync/owner/bank/bridge', 'accountSync/owner/books', 'bankBackgroundServices/bank-service']) await assertFails(serviceRef(path).get());
  await assertFails(serviceRef('personalLedgerLinks/owner').get());
  for(const path of ['groups/654321/incomes','groups/654321/savings']){await assertFails(serviceRef(path).get());await assertFails(serviceRef(path+'/fake').set({id:'fake',desc:'不允許',amount:1,date:'2026-10-28',createdAt:1}));}
  await assertFails(serviceRef('personalLedgerLinks/bank-service/123456').set({targetCode:'654321',memberName:'A',enabled:true,mode:'review',since:'2026-10-29'}));
  await assertFails(serviceRef('accountSync/owner/bank/rules').set('[]'));
  await assertFails(serviceRef('groups/654321/name').set('不能改名'));
  await assertFails(serviceRef('groups/654321/security/ownerUid').set('bank-service'));
  await assertFails(serviceRef('groups/123456/security/users/bank-service').set({ name: 'D', nameKey: 'D', role: 'member' }));
  await assertFails(serviceRef('bankBackgroundServices/another-service').set(true));
  const ownServiceBook = { ...personal, security: { ...personal.security!, ownerUid: 'bank-service', users: { 'bank-service': { name: 'A', nameKey: 'A', role: 'owner' as const } }, names: { A: 'bank-service' } } };
  await assertFails(serviceRef('groups/765432').set(cloud({ ...ownServiceBook, code: '765432' })));
});
test('背景服務可原子新增待確認及歷史，但不能覆寫、刪除或修改正式帳目', async () => {
  await seedBankService();
  const { id, draft, audit } = serviceCapture();
  await assertSucceeds(serviceRef().update({ ['groups/654321/bankInbox/' + id]: draft, ['groups/654321/history/m' + id]: audit }));
  await assertFails(serviceRef('groups/654321/bankInbox/' + id + '/amount').set(999));
  await assertFails(serviceRef('groups/654321/bankInbox/' + id + '/_deleted').set(true));
  await assertFails(serviceRef('groups/654321/bankInbox/' + id).remove());
  await assertFails(serviceRef('groups/654321/history/m' + id).set({ ...audit, at: Date.now() + 1 }));
  await assertFails(serviceRef('groups/654321/history/m' + id).remove());
  await assertFails(serviceRef('groups/654321/expenses/' + id).set(draft));
  await assertFails(serviceRef('groups/654321').remove());
});
test('背景服務拒絕偽造身分、共用帳本、任意歷史與已刪帳本，撤銷登錄立即生效', async () => {
  await seedBankService();
  const { id, draft, audit } = serviceCapture();
  await assertFails(serviceRef('groups/654321/bankInbox/' + id).set({ ...draft, createdByUid: 'stranger' }));
  await assertFails(serviceRef('groups/654321/bankInbox/' + id).set({ ...draft, category: 'food' }));
  await assertFails(serviceRef('groups/654321/bankInbox/' + id).set({ ...draft, rawNotification: '不保存全文' }));
  await assertFails(serviceRef('groups/654321/history/m' + id).set(audit));
  await assertFails(serviceRef('groups/123456/bankInbox/' + id).set(draft));
  await assertSucceeds(env.authenticatedContext('owner').database().ref().update(personalLedgerDeletionUpdate(personal, 'owner', { '.sv': 'timestamp' })));
  await assertFails(serviceRef().update({ ['groups/654321/bankInbox/' + id]: draft, ['groups/654321/history/m' + id]: audit }));
  await env.withSecurityRulesDisabled(context => context.database().ref('bankBackgroundServices/bank-service').remove());
  await assertFails(serviceRef('accountSync/owner/bank/rules').get());
  await assertFails(serviceRef('bankIngressKeys/' + 'a'.repeat(64)).set({ uid: 'owner', createdAt: Date.now() }));
});
test('手機通知待確認只供本人讀寫，不能混入共用帳本或其他成員',async()=>{
  const root=env.authenticatedContext('owner').database().ref('groups/654321');
  const draft={...personalExpense,id:'bank1',category:'other' as const,bank:'測試銀行',last4:'0123'};
  await assertSucceeds(root.set(cloud({...personal,bankInbox:[draft],bankReceiptIds:['bank1']})));
  await assertSucceeds(root.child('bankInbox').get());
  await assertFails(env.authenticatedContext('stranger').database().ref('groups/654321/bankInbox').get());
  await assertFails(env.authenticatedContext('stranger').database().ref('groups/654321/bankInbox/bank1/amount').set(999));
  await assertFails(root.child('bankInbox/bank1/participants/1').set('B'));
  await assertFails(root.child('bankInbox/bank1/rawNotification').set('不應保存通知全文'));
  await assertFails(root.child('bankInbox/bank1/amount').set(-1));
  await assertFails(owner().child('bankInbox/bank1').set(draft));
});
test('確認手機通知在同一次寫入移出待確認並建立帳目，收據標記不可復活',async()=>{
  const root=env.authenticatedContext('owner').database().ref('groups/654321');
  const draft={...personalExpense,id:'bank1',category:'other' as const,bank:'測試銀行',last4:'0123'};
  const before=applyChange(personal,{type:'bankDraft.put',draft,meta:{id:'capture1',actor:'A',actorUid:'owner',at:3,expected:null}});
  const beforeRaw=cloud(before);
  await assertSucceeds(root.set(beforeRaw));
  const confirmed=applyChange(before,{type:'bankDraft.confirm',id:'bank1',expense:{...personalExpense,id:'bank1',category:'food'},meta:{id:'confirm1',actor:'A',actorUid:'owner',at:4,expected:fingerprint(before.bankInbox![0])}});
  await assertSucceeds(root.set(cloudGroup(confirmed,beforeRaw)));
  const snapshot=(await root.get()).val();
  if(snapshot.bankInbox.bank1._deleted!==true || snapshot.expenses.bank1.amount!==120)throw new Error('確認入帳必須同時完成');
  await assertFails(root.child('bankInbox/bank1/_deleted').remove());
  await assertFails(root.child('bankInbox/bank1').set(draft));
  await assertFails(root.set(cloud(personal)));
});
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
