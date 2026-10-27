import { useEffect, useRef, useState } from 'react';
import { Check, Inbox, ChevronRight } from 'lucide-react';
import type { BankDraft, Group } from '../types';
import { bankDraftExpense, bankDraftOwner, pendingDescription } from '../lib/bankInbox';
import { Drafts, type ExpenseForm, type RecordDraft } from '../lib/drafts';
import { fingerprint } from '../lib/audit';
import { currentDeviceUid } from '../lib/firebase';
import { sync } from '../lib/sync';
import { storage, utils } from '../lib/utils';
import { Modal } from './Modal';
import { RecordEditor } from './RecordEditor';

export function BankInboxCard({ drafts, onOpen }: { drafts: BankDraft[]; onOpen: () => void }) {
  const latest = [...drafts].sort((a,b) => b.createdAt - a.createdAt)[0];
  return <section className="bank-inbox-card">
    <div className="bank-inbox-label"><Inbox size={19} aria-hidden="true" /><span>手機通知待確認</span></div>
    <div className="bank-inbox-count"><strong>{drafts.length}</strong><span>筆等你確認</span></div>
    <p>{latest ? `最近一則 ${new Date(latest.createdAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})} · ${latest.bank}` : '收到的銀行通知會先放在這裡'}</p>
    <div className="bank-inbox-footer"><span>確認後才計入帳本與統計</span><button type="button" className="btn btn-primary btn-sm" onClick={onOpen}>{drafts.length ? '繼續確認' : '查看待確認'}<ChevronRight size={16} aria-hidden="true" /></button></div>
  </section>;
}

export function BankInbox({ group, myName, onClose, onSaved }: { group: Group; myName: string; onClose: () => void; onSaved: (message: string, date?: string) => void }) {
  const drafts = [...(group.bankInbox || [])].sort((a,b) => a.createdAt - b.createdAt);
  const [editing, setEditing] = useState<{ draft: BankDraft; initial: RecordDraft } | null>(null);
  const [ignoring, setIgnoring] = useState<BankDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (saving) return;
    if (editing && !drafts.some(item => item.id === editing.draft.id)) { setEditing(null); setError('這則通知已在另一個畫面處理'); }
    if (ignoring && !drafts.some(item => item.id === ignoring.id)) setIgnoring(null);
  }, [group.bankInbox, editing, ignoring, saving]);
  const open = (draft: BankDraft) => {
    const cached = new Drafts(localStorage).read(group.code, bankDraftOwner(myName, draft.id));
    const initial: RecordDraft = cached?.expenseId === draft.id ? cached : { recordType: 'expense', expenseId: draft.id,
      expense: { amount: String(draft.amount), desc: pendingDescription(draft.desc) ? '' : draft.desc, date: draft.date, payer: myName, participants: [myName], splitMode: 'equal', customShares: {} },
      transfer: { amount: '', from: myName, to: '', date: draft.date, note: '' } };
    setError(''); setEditing({ draft, initial });
  };
  const confirm = async (form: ExpenseForm) => {
    if (!editing || lock.current) return false;
    lock.current = true; setSaving(true); setError('');
    try {
      const live = sync.merge(storage.getGroup(group.code) || group);
      const draft = live.bankInbox?.find(item => item.id === editing.draft.id);
      if (!draft) throw new Error('這則通知已處理，請返回待確認清單');
      const expense = bankDraftExpense(draft, form);
      sync.enqueue(group.code, { type: 'bankDraft.confirm', id: draft.id, expense, meta: { id: crypto.randomUUID(), actor: myName, actorUid: currentDeviceUid(), at: Date.now(), expected: fingerprint(editing.draft) } });
      let notice = '確認已保存，正在加入帳本';
      try { new Drafts(localStorage).clear(group.code, bankDraftOwner(myName, draft.id)); } catch { notice += '；本機草稿未能清除'; }
      setEditing(null); onSaved(notice, expense.date); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '確認未完成，資料仍保留'); return false; }
    finally { lock.current = false; setSaving(false); }
  };
  const ignore = () => {
    if (!ignoring || lock.current) return;
    try {
      sync.enqueue(group.code, { type: 'bankDraft.remove', id: ignoring.id, meta: { id: crypto.randomUUID(), actor: myName, actorUid: currentDeviceUid(), at: Date.now(), expected: fingerprint(ignoring) } });
      try { new Drafts(localStorage).clear(group.code, bankDraftOwner(myName, ignoring.id)); } catch { /* The ignored receipt will not be imported again. */ }
      setIgnoring(null); onSaved('已忽略這則通知，未加入帳本');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '忽略未完成，原資料保留'); }
  };
  if (editing) return <RecordEditor group={group} myName={myName} initial={editing.initial} bankReview draftOwner={bankDraftOwner(myName, editing.draft.id)} isSaving={saving} error={error} clearError={() => setError('')} onClose={() => { if (!saving) { setEditing(null); setError(''); } }} onExpense={confirm} onTransfer={async () => false} />;
  if (ignoring) return <Modal title="忽略這則通知？" onClose={() => setIgnoring(null)}><p className="text-sm leading-relaxed">{ignoring.bank} · NT$ {utils.fmt(ignoring.amount)} · {ignoring.date}</p><p className="text-sm text-ink-2 leading-relaxed mt-3">這則通知會移出待確認，同一通知重送也不會再次新增。不影響已確認的帳目。</p>{error && <p className="form-error mt-3">{error}</p>}<div className="flex gap-2 mt-5"><button type="button" className="btn flex-1" onClick={() => setIgnoring(null)}>保留通知</button><button type="button" className="btn btn-danger flex-1" onClick={ignore}>確認忽略</button></div></Modal>;
  return <Modal title="手機通知待確認" onClose={onClose}>
    <div className="bank-inbox-intro"><strong>{drafts.length}</strong><div><h3>筆等你補資料</h3><p>{group.name} · 尚未計入支出與統計</p></div></div>
    {error && <p role="status" className="form-error mb-4">{error}</p>}
    {drafts.length > 0 && <button type="button" className="btn btn-primary w-full mb-4" onClick={() => open(drafts[0])}>繼續確認最早一筆</button>}
    <div className="space-y-3">{drafts.map(draft => <article key={draft.id} className="bank-inbox-item"><button type="button" className="bank-inbox-item-main" onClick={() => open(draft)} aria-label={`確認 ${draft.bank} NT$${utils.fmt(draft.amount)} ${draft.date}`}><div><strong>{draft.bank} · 末 4 碼 {draft.last4}</strong><p>{draft.date} · {pendingDescription(draft.desc) ? '待補說明與分類' : draft.desc}</p></div><span className="money">NT$ {utils.fmt(draft.amount)}</span><ChevronRight size={17} aria-hidden="true" /></button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setIgnoring(draft); }}>忽略</button></article>)}</div>
    {!drafts.length && <div className="empty-state"><Check size={30} aria-hidden="true" /><h3>全部處理好了</h3><p>之後收到的新銀行通知會先保存在這裡。</p></div>}
  </Modal>;
}
