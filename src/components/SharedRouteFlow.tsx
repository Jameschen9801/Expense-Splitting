import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import type { Expense, Group, MyGroup, SharedRoute } from '../types';
import { currentDeviceUid, fetchGroupOnce } from '../lib/firebase';
import { fingerprint } from '../lib/audit';
import { Drafts, type ExpenseForm, type RecordDraft } from '../lib/drafts';
import { isPersonalLedger } from '../lib/ledgers';
import { personalLedgerSync } from '../lib/personalLedgerSync';
import { reviewLink } from '../lib/sharedInbox';
import { memberExpenseAmount } from '../lib/sharedExpenses';
import { possibleRouteMatches, prepareSharedRoute, routeForm, routedExpense, sharedMemberName, sharedRouteDraftOwner, sharedRoutePreferenceKey } from '../lib/sharedRouting';
import { sync } from '../lib/sync';
import { storage, utils } from '../lib/utils';
import { Modal } from './Modal';
import { RecordEditor } from './RecordEditor';
import { PersonalLedgerSyncSettings } from './PersonalLedgerSyncSettings';

type Selection={group:Group;member:string;initial:RecordDraft};
export function SharedRouteFlow({group,record,source,initialForm,onClose,onSaved}:{group:Group;record:Expense;source:SharedRoute['source'];initialForm?:ExpenseForm;onClose:()=>void;onSaved:(message:string)=>void}){
  const syncState=useSyncExternalStore(personalLedgerSync.subscribe,personalLedgerSync.getSnapshot);
  const uid=currentDeviceUid(),owner=sharedRouteDraftOwner(group.code,record.id);
  const [books]=useState(()=>storage.getMyGroups());
  const [choices]=useState(()=>books.filter(book=>!isPersonalLedger(storage.getGroup(book.code)||book)));
  const [selection,setSelection]=useState<Selection|null>(null);
  const [preview,setPreview]=useState<ExpenseForm|null>(null);
  const [linking,setLinking]=useState<Expense|null>(null);
  const [separate,setSeparate]=useState(false);
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [showSyncSettings,setShowSyncSettings]=useState(false);
  const loadGeneration=useRef(0),lock=useRef(false);
  const carried=useRef(initialForm);
  const lastTarget=()=>{try{return localStorage.getItem(sharedRoutePreferenceKey(uid));}catch{return null;}};
  const select=async(book:MyGroup)=>{
    const generation=++loadGeneration.current;setLoading(true);setError('');setSeparate(false);setLinking(null);
    try{
      const cached=storage.getGroup(book.code);
      const target=sync.getStatus(group.code).connected?await fetchGroupOnce(book.code):cached;
      if(!target)throw new Error('請先連線載入這本共用帳本，原通知仍保留');
      const member=sharedMemberName(target,uid,book.myName);
      const saved=new Drafts(localStorage).read(target.code,owner);
      const form=saved?.expenseId===record.id?{...saved.expense,payer:member,participants:saved.expense.participants.filter(name=>target.members.includes(name))}:{...routeForm(record,member,target.members),...(carried.current?{desc:carried.current.desc,amount:carried.current.amount,date:carried.current.date,category:carried.current.category}:{})};
      const initial:RecordDraft={recordType:'expense',expenseId:record.id,expense:form,transfer:{from:member,to:'',amount:'',date:form.date,note:''}};
      if(generation!==loadGeneration.current)return;
      setSelection({group:target,member,initial});setPreview(form);
    }catch(cause){if(generation===loadGeneration.current)setError(cause instanceof Error?cause.message:'共用帳本無法載入，請稍後再試');}
    finally{if(generation===loadGeneration.current)setLoading(false);}
  };
  useEffect(()=>{
    const preferred=choices.find(book=>book.code===lastTarget()) || (choices.length===1?choices[0]:undefined);
    if(preferred)void select(preferred);
    return()=>{loadGeneration.current++;};
  },[]);
  const backToChoices=()=>{
    const detail={failed:false};window.dispatchEvent(new CustomEvent('warikan:flush-draft',{detail}));
    if(detail.failed)return;
    carried.current=preview||carried.current;setSelection(null);setPreview(null);setLinking(null);setError('');
  };
  const save=async(form:ExpenseForm,existing?:Expense)=>{
    if(!selection||lock.current)return false;
    lock.current=true;setSaving(true);setError('');
    try{
      const live=sync.merge(storage.getGroup(group.code)||group);
      const before=(source==='bank'?live.bankInbox:live.expenses)?.find(row=>row.id===record.id);
      if(!before||fingerprint(before)!==fingerprint(record)||live.sharedRoutes?.[record.id])throw new Error('原通知或個人記錄已變更，請返回重新核對');
      if(!existing&&!separate&&possibleRouteMatches(record,selection.group,selection.member).length)throw new Error('請先核對可能相同的分帳；若是另一筆消費，請勾選下方選項');
      const meta={id:crypto.randomUUID(),actor:group.members[0],actorUid:uid,at:Date.now()};
      const change=await prepareSharedRoute(group,record,selection.group,selection.member,form,source,meta,existing);
      sync.enqueue(group.code,change);
      try{new Drafts(localStorage).clear(selection.group.code,owner);localStorage.setItem(sharedRoutePreferenceKey(uid),selection.group.code);}catch{/* The transfer itself is durable in the outbox. */}
      const amount=memberExpenseAmount(change.expense,selection.member);
      const link=syncState.links[selection.group.code];
      const review=link?.enabled&&reviewLink(link)&&change.expense.date>=link.since!;
      onSaved(`${existing?'已保存分帳連結':'已保存共同分帳'}；${amount===0?'純代墊不計入個人支出':review?'你的分攤將送到指定個人帳本待確認':link?.enabled&&reviewLink(link)?'這筆早於同步起始日，不會補匯到個人帳本':'個人分攤同步尚未開啟，原全額不計入個人支出'}`);
      return true;
    }catch(cause){setError(cause instanceof Error?cause.message:'轉換未完成，原記錄仍保留');return false;}
    finally{lock.current=false;setSaving(false);}
  };
  if(!selection)return <Modal title="記到哪本共用帳本？" onClose={()=>{loadGeneration.current++;onClose();}}>
    <p className="text-sm text-ink-2 mb-4">NT$ {utils.fmt(record.amount)} · {record.date}<br/>付款人預設為你，接著選擇誰要分攤。</p>
    {error&&<p className="form-error mb-4" role="alert">{error}</p>}
    {loading&&<p role="status" className="personal-sync-note">正在核對共用帳本…</p>}
    <div className="shared-route-choices">{[...choices].sort((a,b)=>Number(b.code===lastTarget())-Number(a.code===lastTarget())).map(book=><button type="button" className="shared-route-choice" key={book.code} disabled={loading} onClick={()=>void select(book)}><Users size={21} aria-hidden="true"/><span><strong>{book.name}</strong><small>{book.code===lastTarget()?'最近使用':'共用帳本'}</small></span><ChevronRight size={18} aria-hidden="true"/></button>)}</div>
    {!choices.length&&<p className="personal-sync-note">目前沒有已加入的共用帳本。先回首頁建立或加入共用帳本，再處理這筆記帳。</p>}
    <button type="button" className="btn btn-ghost w-full mt-4" onClick={onClose}>返回原記帳</button>
  </Modal>;
  const target=selection.group,member=selection.member,link=syncState.links[target.code];
  let mine:number|undefined;
  if(preview)try{mine=memberExpenseAmount(routedExpense({...preview,desc:preview.desc||'分帳',category:preview.category||'other'},target,member,'preview',1),member);}catch{/* Show the validation in the form when submitted. */}
  const review=link?.enabled&&reviewLink(link);
  const destination=books.find(book=>book.code===link?.targetCode)?.name || '指定個人帳本';
  const matches=possibleRouteMatches(record,target,member);
  const notice=<>
    <div className="shared-route-destination"><div><small>{source==='expense'?'個人支出轉成共同分帳':'銀行通知轉成共同分帳'}</small><strong>{target.name}</strong></div><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={backToChoices}>更換帳本</button></div>
    <div className="shared-route-outcome" role="status">{mine===0?'純代墊 · 你的負擔為 0，不新增個人支出':mine!=null?<>你的負擔 <strong>NT$ {utils.fmt(mine)}</strong>{review&&preview&&preview.date>=link.since! ? <small>先送到「{destination}」待確認</small>:<small>{review?'這筆早於同步起始日，不會補匯到個人帳本':'個人分攤同步尚未開啟'}</small>}</>:'請選擇分攤對象與金額'}</div>
    {mine!==0&&(!review||preview&&preview.date<link.since!)&&<details className="shared-route-sync" onToggle={event=>setShowSyncSettings(event.currentTarget.open)}><summary>查看個人分攤同步設定</summary>{showSyncSettings&&<PersonalLedgerSyncSettings group={target} myName={member} books={books} onAccount={()=>setError('請先回帳本設定，登入原本的帳本同步帳號')}/>}</details>}
    {source==='expense'&&<p className="personal-sync-note mb-4">轉成分帳後，原本的個人全額支出會移除；你的負擔依同步設定先進待確認。</p>}
    {matches.length>0&&<div className="shared-match-notice"><strong>可能已經記過這筆分帳</strong>{matches.map(expense=><div key={expense.id}><p>{expense.desc} · {expense.date}<br/>整筆 NT$ {utils.fmt(expense.amount)} · 你的負擔 NT$ {utils.fmt(memberExpenseAmount(expense,member))}</p><button type="button" className="btn btn-sm" disabled={saving} onClick={()=>{if(preview)setSelection({...selection,initial:{...selection.initial,expense:preview}});setLinking(expense);setError('');}}>核對並連結這筆分帳</button></div>)}<label><input type="checkbox" checked={separate} onChange={event=>setSeparate(event.target.checked)}/>這是另一筆消費，仍要新增分帳</label></div>}
  </>;
  if(linking)return <Modal title="連結已記過的分帳？" onClose={()=>{if(!saving)setLinking(null);}}>
    <div className="shared-source-detail"><strong>{target.name} · {linking.desc}</strong><p>{linking.date} · 整筆 NT$ {utils.fmt(linking.amount)}</p><p>你的負擔 NT$ {utils.fmt(memberExpenseAmount(linking,member))}</p></div>
    <p className="text-sm leading-relaxed">確認是同一筆刷卡後，會沿用這筆共用分帳，處理原{source==='bank'?'銀行通知':'個人全額記錄'}；不再新增第二筆分帳。</p>
    {error&&<p className="form-error mt-3" role="alert">{error}</p>}
    <div className="flex flex-col gap-2 mt-5"><button type="button" className="btn btn-primary" disabled={saving} onClick={()=>void save(preview||selection.initial.expense,linking)}>{saving?'儲存中…':'確認同一筆，連結分帳'}</button><button type="button" className="btn" disabled={saving} onClick={()=>setLinking(null)}>返回核對</button></div>
  </Modal>;
  return <Fragment key={target.code}><RecordEditor group={target} myName={member} initial={selection.initial} title="確認共同分帳" submitLabel="確認新增分帳" lockPayer bankReview={source==='bank'} draftOwner={owner} notice={notice} isSaving={saving} error={error} clearError={()=>setError('')} onClose={onClose} onExpense={form=>save(form)} onTransfer={async()=>false} onFormChange={setPreview}/></Fragment>;
}
