import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { categoryLabel } from '../lib/categories';
import { prepareBankEntry, saveBankEntry, type PreparedBankEntry } from '../lib/bankImport';
import { cardSuffixLabel, type BankRequest } from '../lib/bankShortcuts';
import type { Group } from '../types';
import { utils } from '../lib/utils';
import { isPersonalLedger } from '../lib/ledgers';
import { AccountSyncSettings } from './AccountSyncSettings';
import { reportBankDelivery } from '../lib/bankDelivery';

export function BankImport({ input, onClose, onGroup, onSaved, background = false }: { input: { request?: BankRequest; error?: string }; onClose: () => void; onGroup: (group: Group, name: string, recordDate?: string) => void; onSaved: (message: string) => void; background?: boolean }) {
  const [prepared, setPrepared] = useState<PreparedBankEntry | null>(null);
  const [error, setError] = useState(input.error || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(!!input.request);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const preparation = useRef<Promise<PreparedBankEntry> | null>(null);
  const saving = useRef<ReturnType<typeof saveBankEntry> | null>(null);
  const commit = (value: PreparedBankEntry, confirmed = false) => {
    setBusy(true); setError('');
    saving.current ||= saveBankEntry(value, confirmed);
    return saving.current.then(result => {
      const stillPending = result.group.bankInbox?.some(item => item.id === value.id);
      reportBankDelivery(value.captureFirst ? (stillPending ? 'pending' : 'duplicate') : 'saved', value.captureFirst ? (stillPending ? '已保存在手機通知待確認，補好說明與分類後再加入帳本。同步進度請看帳本右上角。' : '這則通知已在其他畫面處理，沒有再次新增。') : '已保存記帳紀錄。同步進度請看帳本右上角。');
      onGroup(result.group, result.myName, value.captureFirst ? undefined : result.group.expenses.find(item => item.id === value.id)?.date || value.entry.date); setSaved(true); setMessage(result.message + (result.warning ? '\n' + result.warning : ''));
      if (value.captureFirst && !result.warning) { onSaved(result.message); onClose(); }
    }).catch(error => { saving.current = null; const message = error instanceof Error ? error.message : '記帳未完成，請保留此畫面'; setError(message); reportBankDelivery('error', message); }).finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!input.request) return;
    setBusy(true); setError('');
    let alive = true;
    preparation.current ||= prepareBankEntry(input.request);
    preparation.current.then(value => {
      if (!alive) return;
      setPrepared(value);
      if (value.duplicate) {
        reportBankDelivery('duplicate', '相同通知已處理，沒有再次新增。請查看待確認或帳本明細。');
        setSaved(true); setMessage('相同通知已處理，未重複新增'); setBusy(false);
        if (value.captureFirst) { onGroup(value.group, value.myName); onSaved(value.group.bankInbox?.some(item => item.id === value.id) ? '這則通知已在待確認，未重複新增' : '相同通知已處理，未重複新增'); onClose(); }
      }
      else if (value.automatic) void commit(value);
      else { reportBankDelivery('review', value.reviewReason || '這則通知需要在開啟的記帳畫面核對後新增。'); setBusy(false); }
    }).catch(error => { if (alive) { const message = error instanceof Error ? error.message : '無法處理銀行通知'; setError(message); reportBankDelivery('error', message); setBusy(false); } });
    return () => { alive = false; };
  }, [attempt]);
  if (background) return null;
  return <Modal title="銀行捷徑記帳" onClose={() => { if (!busy) onClose(); }}>
    {busy && <p role="status" className="text-sm py-4">正在辨識與保存通知，請稍候…</p>}
    {prepared && <div className="rounded-2xl border border-line bg-paper-2 p-4 text-sm leading-loose">
      <p>{prepared.group.name} · {prepared.rule.bank} · {cardSuffixLabel(prepared.rule.last4)} {prepared.rule.last4}</p>
      <p className="money text-2xl">NT$ {utils.fmt(prepared.entry.amount)}</p>
      <p>{prepared.expense.desc}</p><p>{prepared.entry.date} · {categoryLabel(prepared.expense.category)}</p>
      {!isPersonalLedger(prepared.group) && <p>{prepared.rule.payer} 先付款；分攤：{prepared.rule.participants.join('、')}</p>}
      {!prepared.entry.dateInMessage && <p className="text-xs text-ink-3">通知未含日期，使用本次開啟捷徑的日期。</p>}
    </div>}
    {prepared?.reviewReason && !saved && <p className="form-error mt-4">{prepared.reviewReason}</p>}
    {error && <p className="form-error mt-4" role="alert">{error}</p>}
    {error && !prepared && <div className="mt-4"><AccountSyncSettings preferLogin onReady={() => { preparation.current = null; saving.current = null; setAttempt(value => value + 1); }} /></div>}
    {error && input.request && !busy && <button type="button" className="btn w-full mt-3" onClick={() => { preparation.current = null; saving.current = null; setAttempt(value => value + 1); }}>重新讀取設定並辨識</button>}
    {message && <p role="status" className="text-sm whitespace-pre-line mt-4">{message}</p>}
    <p className="text-xs text-ink-3 leading-relaxed mt-4">通知只在本機解析，不保存原始通知。這是新增記帳紀錄，不會付款或轉帳。</p>
    <div className="flex gap-2 mt-5">
      <button type="button" className="btn flex-1" disabled={busy} onClick={onClose}>{saved ? '完成' : '關閉'}</button>
      {prepared && !saved && <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => commit(prepared, true)}>確認新增</button>}
    </div>
  </Modal>;
}
