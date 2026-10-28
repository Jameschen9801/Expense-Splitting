import { useEffect, useRef, useState } from 'react';
import type { Income, Saving } from '../types';
import { DraftWriter } from '../lib/drafts';
import { cashflowDraftKey, cashflowValue, type CashflowForm, type CashflowKind } from '../lib/personalFinance';
import { utils } from '../lib/utils';
import { Modal } from './Modal';

export function EntryKindTabs({kind,onKind}:{kind:'expense'|CashflowKind;onKind:(kind:'expense'|CashflowKind)=>void}) {
  return <div className="entry-kind-tabs" role="group" aria-label="記帳類型">{([{id:'expense',label:'支出'},{id:'income',label:'收入'},{id:'saving',label:'儲蓄'}] as const).map(option=><button type="button" key={option.id} aria-pressed={kind===option.id} onClick={()=>onKind(option.id)}>{option.label}</button>)}</div>;
}
export function CashflowEditor({code,myName,kind,record,busy,error,onClose,onSave,onKind,clearError}:{
  code:string;myName:string;kind:CashflowKind;record?:Income|Saving;busy:boolean;error:string;
  onClose:()=>void;onSave:(form:CashflowForm)=>Promise<boolean>;onKind:(kind:'expense'|CashflowKind)=>void;
  clearError:()=>void;
}) {
  const key=cashflowDraftKey(code,myName,kind);
  const [form,setForm]=useState<CashflowForm>(()=>{
    const initial:CashflowForm={kind,id:record?.id,desc:record?.desc||'',amount:record?String(record.amount):'',date:record?.date||utils.todayStr(),direction:record&&'direction' in record?record.direction||'out':'out'};
    try{const saved=JSON.parse(localStorage.getItem(key)||'null');return saved?.kind===kind && saved?.id===record?.id?{...initial,...saved}:initial;}catch{return initial;}
  });
  const [localError,setLocalError]=useState('');
  const latest=useRef(form);latest.current=form;
  const finished=useRef(false);
  const writer=useRef<DraftWriter|null>(null);
  if(!writer.current)writer.current=new DraftWriter(()=>setLocalError('草稿暫時無法保存，請保留輸入內容'));
  useEffect(()=>{writer.current!.schedule(()=>{if(!finished.current){if(latest.current.desc||latest.current.amount)localStorage.setItem(key,JSON.stringify(latest.current));else localStorage.removeItem(key);}});},[form,key]);
  useEffect(()=>{
    const flush=(event?:Event)=>{if(!writer.current!.flush()&&event instanceof CustomEvent)event.detail.failed=true;};
    const hidden=()=>{if(document.visibilityState==='hidden')flush();};
    window.addEventListener('pagehide',flush);window.addEventListener('warikan:flush-draft',flush);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('pagehide',flush);window.removeEventListener('warikan:flush-draft',flush);document.removeEventListener('visibilitychange',hidden);writer.current!.flush();};
  },[]);
  const patch=(change:Partial<CashflowForm>)=>{setLocalError('');clearError();setForm(previous=>({...previous,...change}));};
  const save=async()=>{
    if(busy)return;
    try{cashflowValue(form);}catch(cause){setLocalError((cause as Error).message);return;}
    finished.current=true;writer.current!.cancel();
    if(await onSave(form)){try{localStorage.removeItem(key);}catch{}}else{finished.current=false;writer.current!.schedule(()=>localStorage.setItem(key,JSON.stringify(latest.current)));}
  };
  const label=kind==='income'?'收入':'儲蓄';
  return <Modal layout="editor" title={(record?'編輯':'新增')+label} onClose={()=>{if(!busy&&writer.current!.flush())onClose();}}
    keyboardFields={[{id:'cashflow-amount',label:label+'金額 (NT$)'},{id:'cashflow-description',label:'說明'}]} keyboardError={localError||error}
    footer={<div className="flex gap-2 justify-end"><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>{if(writer.current!.flush())onClose();}}>取消</button><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={()=>void save()}>{busy?'儲存中…':'儲存'}</button></div>}>
    {!record&&<EntryKindTabs kind={kind} onKind={next=>{if(!busy&&writer.current!.flush())onKind(next);}}/>}
    <div className="field"><label className="field-label" htmlFor="cashflow-amount">{label}金額 (NT$)</label><input id="cashflow-amount" type="number" inputMode="decimal" step="0.01" min="0.01" value={form.amount} onChange={event=>patch({amount:event.target.value})} enterKeyHint="next" data-autofocus="true" className="expense-amount-input" placeholder="0"/></div>
    <div className="field"><label className="field-label" htmlFor="cashflow-description">說明</label><input id="cashflow-description" type="text" value={form.desc} onChange={event=>patch({desc:event.target.value})} maxLength={200} enterKeyHint="done" placeholder={kind==='income'?'例：薪資、兼職收入':'例：預備金、共同儲蓄'}/></div>
    <div className="field"><label className="field-label" htmlFor="cashflow-date">日期</label><input id="cashflow-date" type="date" value={form.date} onChange={event=>patch({date:event.target.value})}/></div>
    {kind==='saving'&&<><div className="field"><label className="field-label" htmlFor="saving-direction">儲蓄方向</label><select id="saving-direction" value={form.direction} onChange={event=>patch({direction:event.target.value as 'in'|'out'})}><option value="out">存入儲蓄</option><option value="in">從儲蓄轉回</option></select></div><p className="text-sm text-ink-2 leading-relaxed">儲蓄是資金移轉，會另列統計，不計入消費支出或收入。</p></>}
    {(localError||error)&&<p role="alert" className="form-error">{localError||error}</p>}
  </Modal>;
}
