import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { categoryLabel } from '../lib/categories';
import { prepareBankEntry, saveBankEntry, type PreparedBankEntry } from '../lib/bankImport';
import type { BankRequest } from '../lib/bankShortcuts';
import type { Group } from '../types';
import { utils } from '../lib/utils';

export function BankImport({ input, onClose, onGroup }: { input: { request?: BankRequest; error?: string }; onClose: () => void; onGroup: (group: Group, name: string) => void }) {
  const [prepared, setPrepared] = useState<PreparedBankEntry | null>(null);
  const [error, setError] = useState(input.error || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(!!input.request);
  const [saved, setSaved] = useState(false);
  const preparation = useRef<Promise<PreparedBankEntry> | null>(null);
  const saving = useRef<ReturnType<typeof saveBankEntry> | null>(null);
  const commit = (value: PreparedBankEntry, confirmed = false) => {
    setBusy(true); setError('');
    saving.current ||= saveBankEntry(value, confirmed);
    return saving.current.then(result => {
      onGroup(result.group, result.myName); setSaved(true); setMessage(result.message + (result.warning ? '\n' + result.warning : ''));
    }).catch(error => { saving.current = null; setError(error instanceof Error ? error.message : '記帳未完成，請保留此畫面'); }).finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!input.request) return;
    let alive = true;
    preparation.current ||= prepareBankEntry(input.request);
    preparation.current.then(value => {
      if (!alive) return;
      setPrepared(value);
      if (value.duplicate) { setSaved(true); setMessage('相同通知已處理，未重複新增'); setBusy(false); }
      else if (value.rule.mode === 'auto' && !value.reviewReason) void commit(value);
      else setBusy(false);
    }).catch(error => { if (alive) { setError(error instanceof Error ? error.message : '無法處理銀行通知'); setBusy(false); } });
    return () => { alive = false; };
  }, []);
  return <Modal title="銀行捷徑記帳" onClose={() => { if (!busy) onClose(); }}>
    {busy && <p role="status" className="text-sm py-4">正在辨識與保存通知，請稍候…</p>}
    {prepared && <div className="rounded-2xl border border-line bg-paper-2 p-4 text-sm leading-loose">
      <p>{prepared.group.name} · {prepared.rule.bank} · 末四碼 {prepared.rule.last4}</p>
      <p className="money text-2xl">NT$ {utils.fmt(prepared.entry.amount)}</p>
      <p>{prepared.entry.desc}</p><p>{prepared.entry.date} · {categoryLabel(prepared.rule.category)}</p>
      <p>{prepared.rule.payer} 先付款；分攤：{prepared.rule.participants.join('、')}</p>
      {!prepared.entry.dateInMessage && <p className="text-xs text-ink-3">通知未含日期，使用本次開啟捷徑的日期。</p>}
    </div>}
    {prepared?.reviewReason && !saved && <p className="form-error mt-4">{prepared.reviewReason}</p>}
    {error && <p className="form-error mt-4" role="alert">{error}</p>}
    {message && <p role="status" className="text-sm whitespace-pre-line mt-4">{message}</p>}
    <p className="text-xs text-ink-3 leading-relaxed mt-4">通知只在本機解析，不保存原始通知。這是新增記帳紀錄，不會付款或轉帳。</p>
    <div className="flex gap-2 mt-5">
      <button type="button" className="btn flex-1" disabled={busy} onClick={onClose}>{saved ? '完成' : '關閉'}</button>
      {prepared && !saved && <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => commit(prepared, true)}>確認新增</button>}
    </div>
  </Modal>;
}
