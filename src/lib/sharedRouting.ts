import type { Expense, Group, MutationMeta, SharedRoute } from '../types';
import type { ExpenseForm } from './drafts';
import { categories } from './categories';
import { fingerprint, RecordConflictError, auditEntry, updatedRecord } from './audit';
import { memberExpenseAmount } from './sharedExpenses';
import { utils } from './utils';
import { validSyncDate } from './sharedInbox';

export type SharedRouteChange = {
  type: 'bankDraft.routeShared' | 'expense.routeShared'; id: string;
  route: SharedRoute; expense: Expense; expectedTarget: string | null;
  meta?: MutationMeta;
};
export const isSharedRouteChange = (change: { type: string }): change is SharedRouteChange => ['bankDraft.routeShared','expense.routeShared'].includes(change.type);
export const sharedRouteDraftOwner = (code: string, id: string) => `route:${code}:${id}`;
export const sharedRoutePreferenceKey = (uid: string) => `warikan_shared_route_target_v1_${uid}`;

export function validSharedRoute(value: any): value is SharedRoute {
  const id=(text:unknown,empty=false)=>typeof text==='string'&&(empty||text.length>0)&&text.length<=150&&!/[.#$\[\]/\u0000-\u001f\u007f]/.test(text);
  const amount=(number:unknown)=>typeof number==='number'&&Number.isFinite(number)&&number>0&&number<=1e9;
  return !!value && typeof value==='object'&&!Array.isArray(value)&&['bank','expense'].includes(value.source)&&['create','link'].includes(value.mode)
    && typeof value.groupCode==='string'&&/^\d{6}$/.test(value.groupCode)&&id(value.expenseId)&&id(value.memberName)&&value.memberName.length<=12&&id(value.mutationId)
    && Number.isFinite(value.at)&&value.at>0&&['sourceRevision','targetRevision'].every(key=>Number.isInteger(value[key])&&value[key]>=0)
    && id(value.sourceMutationId,true)&&id(value.targetMutationId,true)&&amount(value.sourceAmount)&&amount(value.amount)&&validSyncDate(value.sourceDate)&&validSyncDate(value.date)
    && Object.keys(value).every(key=>['source','mode','groupCode','expenseId','memberName','at','mutationId','sourceRevision','sourceMutationId','sourceAmount','sourceDate','targetRevision','targetMutationId','amount','date'].includes(key));
}

export function sharedMemberName(group: Group, uid: string, fallback: string): string {
  const name = group.security ? group.security.users[uid]?.name : fallback;
  if (group.kind === 'personal' || !name || !group.members.includes(name)) throw new Error('請選擇你已加入的共用帳本');
  return name;
}
export function routeForm(record: Expense, member: string, members: string[]): ExpenseForm {
  return { desc: record.desc, amount: String(record.amount), date: record.date, category: record.category === 'other' ? undefined : record.category,
    payer: member, participants: [...members], splitMode: 'equal', customShares: {} };
}
export function routeExpenseForm(expense: Expense): ExpenseForm {
  return {desc:expense.desc,amount:String(expense.amount),date:expense.date,category:expense.category,payer:expense.payer,
    participants:[...expense.participants],splitMode:expense.splitMode,
    customShares:Object.fromEntries((expense.splitMode==='percent'?expense.percentages||[]:expense.shares||[]).map(share=>[share.name,String(share.amount)]))};
}
export function pureAdvance(form: ExpenseForm, member: string, members: string[]): ExpenseForm {
  return { ...form, payer: member, participants: members.filter(name=>name!==member), splitMode:'equal', customShares:{} };
}

export function routedExpense(form: ExpenseForm, group: Group, member: string, id: string, at: number): Expense {
  if (form.desc.trim().length > 200) throw new Error('說明最多 200 字');
  if (!categories.some(category=>category.id===form.category)) throw new Error('請選擇分類');
  const amount=Number(form.amount);
  if (!/^\d+(?:\.\d{1,2})?$/.test(form.amount.trim()) || !Number.isFinite(amount) || amount<=0 || amount>1e9) throw new Error('請填寫有效金額，最多兩位小數');
  if (!validSyncDate(form.date)) throw new Error('請填寫有效日期');
  if (group.kind==='personal' || form.payer!==member || !group.members.includes(member)) throw new Error('刷卡分帳由你先付款，請確認共用帳本身分');
  if (!form.participants.length || new Set(form.participants).size!==form.participants.length || form.participants.some(name=>!group.members.includes(name))) throw new Error('請選擇有效的分攤對象');
  if (!['equal','custom','percent'].includes(form.splitMode)) throw new Error('請選擇有效的分攤方式');
  const expense: Expense={id,desc:form.desc.trim(),amount:utils.fromCents(utils.toCents(amount)),date:form.date,category:form.category,
    payer:member,participants:[...form.participants],splitMode:form.splitMode,createdAt:at};
  if(form.splitMode!=='equal'){
    const values=form.participants.map(name=>({name,amount:Number(form.customShares[name]||'0')}));
    if(values.some(value=>!/^\d+(?:\.\d{1,2})?$/.test((form.customShares[value.name]||'0').trim())||!Number.isFinite(value.amount)||value.amount<0)) throw new Error('分攤數值必須是 0 或正數，最多兩位小數');
    if(form.splitMode==='percent'){
      if(values.some(value=>value.amount>100)||utils.toCents(values.reduce((sum,value)=>sum+value.amount,0))!==10000) throw new Error('分攤比例加總必須等於 100%');
      expense.percentages=values;expense.shares=utils.percentShares(amount,values);
    }else{
      if(values.reduce((sum,value)=>sum+utils.toCents(value.amount),0)!==utils.toCents(amount)) throw new Error('分攤金額加總必須等於刷卡金額');
      expense.shares=values;
    }
    if(expense.shares.some(share=>share.amount<0)) throw new Error('此金額無法依目前比例分攤，請改用平均或自訂金額');
  }
  return expense;
}

// A charge can be routed once, even when two devices choose different books.
// The ID is independent of the chosen destination and survives a lost reply.
export async function routedExpenseId(code: string, id: string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([code,id])));
  return 'erouted_'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function possibleRouteMatches(record: Expense, group: Group, member: string): Expense[] {
  return group.expenses.filter(expense=>expense.payer===member && expense.date===record.date && utils.toCents(expense.amount)===utils.toCents(record.amount));
}
export async function prepareSharedRoute(source: Group, record: Expense, target: Group, member: string, form: ExpenseForm, sourceKind: SharedRoute['source'], meta: MutationMeta, existing?: Expense): Promise<SharedRouteChange> {
  if(source.kind!=='personal'||record.sharedSource) throw new Error('請從自己的銀行通知或個人支出轉成分帳');
  const id=existing?.id||await routedExpenseId(source.code,record.id);
  const expense=existing||routedExpense(form,target,member,id,meta.at);
  if(existing&&!possibleRouteMatches(record,target,member).some(row=>row.id===existing.id)) throw new Error('金額、日期或付款人不同，請重新核對');
  const route: SharedRoute={source:sourceKind,mode:existing?'link':'create',groupCode:target.code,expenseId:id,memberName:member,at:meta.at,mutationId:meta.id,
    sourceRevision:record.revision||0,sourceMutationId:record.lastMutationId||'',sourceAmount:record.amount,sourceDate:record.date,
    targetRevision:existing?.revision|| (existing?0:1),targetMutationId:existing?.lastMutationId|| (existing?'':meta.id),amount:expense.amount,date:expense.date};
  return {type:sourceKind==='bank'?'bankDraft.routeShared':'expense.routeShared',id:record.id,route,expense,expectedTarget:fingerprint(existing),meta:{...meta,expected:fingerprint(record)}};
}

export function sharedRoutingPatch(source: Group, target: Group, change: SharedRouteChange, uid: string): Record<string, unknown> | null {
  const {route,meta}=change;
  if(source.kind!=='personal'||source.security?.ownerUid!==uid) throw new Error('permission_denied：只有個人帳本本人可轉成分帳');
  if(!meta||!validSharedRoute(route)||route.mutationId!==meta.id||route.at!==meta.at||route.groupCode!==target.code||route.expenseId!==change.expense.id||source.code===target.code) throw new Error('分帳資料不完整，請重新核對');
  const previous=source.sharedRoutes?.[change.id];
  if(previous){if(previous.mutationId===meta.id)return null;throw new RecordConflictError(source,change.id);}
  const member=sharedMemberName(target,uid,route.memberName);
  if(member!==route.memberName) throw new Error('共用帳本身分已變更，請重新選擇');
  const before=(route.source==='bank'?source.bankInbox:source.expenses)?.find(record=>record.id===change.id);
  const oldTarget=target.expenses.find(record=>record.id===route.expenseId);
  if(!before||before.sharedSource||fingerprint(before)!==meta.expected||fingerprint(oldTarget)!==change.expectedTarget) throw new RecordConflictError(source,change.id);
  if(route.source!==(change.type==='bankDraft.routeShared'?'bank':'expense')||route.sourceRevision!==(before.revision||0)||route.sourceMutationId!==(before.lastMutationId||'')||route.sourceAmount!==before.amount||route.sourceDate!==before.date) throw new RecordConflictError(source,change.id);
  if(route.mode==='link'&&!possibleRouteMatches(before,target,member).some(record=>record.id===route.expenseId)) throw new RecordConflictError(source,change.id);
  if(route.mode==='create'&&(oldTarget||change.expectedTarget!==null||change.expense.payer!==member)) throw new RecordConflictError(source,change.id);
  const sourceActor=source.members[0],sourceMeta={...meta,actor:sourceActor,actorUid:uid};
  const sourceAudit={id:meta.id,actor:sourceActor,actorUid:uid,at:meta.at,action:change.type,target:change.id,changes:[
    {label:'處理方式',before:route.source==='bank'?'銀行通知待確認':'個人支出',after:route.mode==='create'?'轉成共同分帳':'連結既有分帳'},
    {label:'共用帳本',before:'',after:target.name},
    {label:'我的負擔',before:route.source==='expense'?String(before.amount):'尚未入帳',after:String(memberExpenseAmount(change.expense,member))},
  ]};
  const base=`groups/${source.code}`;
  const patch: Record<string,unknown>={
    [`${base}/sharedRoutes/${change.id}`]:route,
    [`${base}/${route.source==='bank'?'bankInbox':'expenses'}/${change.id}`]:{...updatedRecord(before,before,sourceMeta),_deleted:true,_lastAudit:sourceAudit},
    [`${base}/history/${meta.id}`]:sourceAudit,
  };
  if(route.mode==='create'){
    const targetMeta={...meta,actor:member,actorUid:uid};
    const original=change.expense;
    const safe=routedExpense(routeExpenseForm(original),target,member,original.id,meta.at);
    if(safe.amount!==route.amount||safe.date!==route.date||route.targetRevision!==1||route.targetMutationId!==meta.id)throw new Error('分帳內容已變更，請重新核對');
    const expense=updatedRecord(safe,undefined,targetMeta);
    const audit=auditEntry('expense.routeCreate',expense.id,undefined,expense,targetMeta);
    patch[`groups/${target.code}/expenses/${expense.id}`]={...expense,_lastAudit:audit};
    patch[`groups/${target.code}/history/${meta.id}`]=audit;
  }
  return patch;
}
