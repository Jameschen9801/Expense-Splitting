import { useState } from 'react';
import type { Group } from '../types';
import { Modal } from './Modal';

export function DeleteLedgerDialog({ group, pending, connected, busy, error, onClose, onConfirm }: {
  group: Group; pending: number; connected: boolean; busy: boolean; error: string; onClose: () => void; onConfirm: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const ready = confirmation.trim() === '刪除' && connected && !busy;
  return <Modal title="刪除個人帳本？" onClose={() => { if (!busy) onClose(); }} footer={<div className="flex gap-3">
    <button type="button" className="btn flex-1" disabled={busy} onClick={onClose}>保留帳本</button>
    <button type="button" className="btn btn-danger flex-1" disabled={!ready} onClick={() => { if (ready) onConfirm(); }}>{busy ? '正在刪除…' : '確認刪除帳本'}</button>
  </div>}>
    <div className="delete-ledger-summary" id="delete-ledger-summary"><strong>{group.name}</strong><span>個人帳本 · {group.expenses.length} 筆記帳</span></div>
    <p className="text-sm text-ink-2 leading-relaxed mt-4">確認後會永久刪除這本帳本、所有帳目、草稿與這本帳本的銀行規則，無法在 App 復原。其他帳本不受影響。</p>
    {pending > 0 && <p className="text-sm text-ink-2 leading-relaxed mt-3">還有 {pending} 筆待同步資料；會先完成同步，再刪除帳本。同步未完成時不會繼續刪除。</p>}
    {!connected && <p className="form-error mt-3">需要連線才能刪除，請恢復連線後再確認。</p>}
    <div className="field mt-5"><label className="field-label" htmlFor="delete-ledger-confirm">請輸入「刪除」以確認</label><input type="text" id="delete-ledger-confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} aria-describedby="delete-ledger-summary" placeholder="刪除" /></div>
    {busy && <p role="status" className="text-sm text-ink-2 leading-relaxed">正在處理刪除，請保持連線並稍候。</p>}
    {error && <p role="alert" className="form-error mt-3">{error}</p>}
  </Modal>;
}
