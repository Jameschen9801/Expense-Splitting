import { useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { Expense, Group, SharedDraft } from '../types';
import { Drafts, type ExpenseForm, type RecordDraft } from '../lib/drafts';
import { fingerprint } from '../lib/audit';
import { currentDeviceUid } from '../lib/firebase';
import { sync } from '../lib/sync';
import { storage, utils } from '../lib/utils';
import { possibleBankMatches } from '../lib/sharedExpenses';
import { possiblePersonalMatches, sharedDraftExpense } from '../lib/sharedInbox';
import { BankInbox } from './BankInbox';
import { Modal } from './Modal';
import { RecordEditor } from './RecordEditor';

type Props = { group: Group; myName: string; onClose: () => void; onSaved: (message: string, date?: string) => void };
const draftOwner = (name: string, id: string) => name + ':shared:' + id;

export function PendingInbox(props: Props) {
  const [tab, setTab] = useState<'shared' | 'bank'>(props.group.sharedInbox?.length ? 'shared' : 'bank');
  const navigation = <div className="report-mode mb-5" role="group" aria-label="待確認來源">
    <button type="button" aria-pressed={tab === 'shared'} onClick={() => setTab('shared')}>共用分攤 {props.group.sharedInbox?.length || 0}</button>
    <button type="button" aria-pressed={tab === 'bank'} onClick={() => setTab('bank')}>銀行通知 {props.group.bankInbox?.length || 0}</button>
  </div>;
  return tab === 'shared' ? <SharedInbox {...props} navigation={navigation}/> : <BankInbox {...props} navigation={navigation}/>;
}

export function SharedInbox({ group, myName, onClose, onSaved, navigation }: Props & { navigation?: ReactNode }) {
  const drafts = [...group.sharedInbox || []].sort((a,b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const [editing, setEditing] = useState<{ draft: SharedDraft; initial: RecordDraft; existing?: Expense } | null>(null);
  const [ignoring, setIgnoring] = useState<SharedDraft | null>(null);
  const [separate, setSeparate] = useState(false);
  const [bank, setBank] = useState<Expense | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const open = (draft: SharedDraft) => {
    const cached = new Drafts(localStorage).read(group.code, draftOwner(myName, draft.id));
    const expense: ExpenseForm = { desc: draft.desc, amount: String(draft.amount), date: draft.date, category: draft.category || 'other', payer: myName, participants: [myName], splitMode: 'equal', customShares: {} };
    if (cached?.expenseId === draft.id) Object.assign(expense, cached.expense, { amount: String(draft.amount) });
    setEditing({ draft, existing: group.expenses.find(record => record.id === draft.id), initial: { recordType: 'expense', expenseId: draft.id, expense, transfer: { from: myName, to: '', amount: '', date: draft.date, note: '' } } });
    setError(''); setSeparate(false); setBank(null);
  };
  const confirm = async (form: ExpenseForm) => {
    if (!editing || lock.current) return false;
    lock.current = true; setSaving(true); setError('');
    try {
      const live = sync.merge(storage.getGroup(group.code) || group), pending = live.sharedInbox?.find(draft => draft.id === editing.draft.id);
      if (!pending || fingerprint(pending) !== fingerprint(editing.draft)) throw new Error('原分攤剛更新，請返回重新核對；輸入的說明會保留');
      if (fingerprint(live.expenses.find(record => record.id === pending.id)) !== fingerprint(editing.existing)) throw new Error('個人紀錄剛更新，請返回重新核對');
      if (!separate && !bank && (possiblePersonalMatches(pending, live).length || possibleBankMatches(pending, live).length)) throw new Error('請先核對可能重複的紀錄；若是不同消費，請勾選下方選項');
      if (bank && !possibleBankMatches(pending, live).some(record => record.id === bank.id && fingerprint(record) === fingerprint(bank))) throw new Error('銀行記帳剛更新，請返回重新核對');
      const expense = sharedDraftExpense(pending, form);
      sync.enqueue(group.code, { type: 'sharedDraft.confirm', id: pending.id, expense, expectedExpense: fingerprint(editing.existing),
        ...(bank ? { bankExpenseId: bank.id, expectedBank: fingerprint(bank) } : {}),
        meta: { id: crypto.randomUUID(), actor: myName, actorUid: currentDeviceUid(), at: Date.now(), expected: fingerprint(editing.draft) } });
      try { new Drafts(localStorage).clear(group.code, draftOwner(myName, pending.id)); } catch { /* Confirmation remains durable in the outbox. */ }
      setEditing(null); onSaved(bank ? '已改記你的分攤，銀行全額未重複計入' : editing.existing ? '已確認並更新原分攤，未重複新增' : '分攤已確認加入個人帳本', expense.date); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '確認未完成，內容仍保留'); return false; }
    finally { lock.current = false; setSaving(false); }
  };
  const ignore = () => {
    if (!ignoring || lock.current) return;
    try {
      sync.enqueue(group.code, { type: 'sharedDraft.remove', id: ignoring.id, meta: { id: crypto.randomUUID(), actor: myName, actorUid: currentDeviceUid(), at: Date.now(), expected: fingerprint(ignoring) } });
      try { new Drafts(localStorage).clear(group.code, draftOwner(myName, ignoring.id)); } catch { /* Ignore remains durable. */ }
      setIgnoring(null); onSaved('已忽略此分攤，不會重複送入待確認');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '忽略未完成，內容仍保留'); }
  };
  if (ignoring) return <Modal title="忽略這筆分攤？" onClose={() => setIgnoring(null)}><h3 className="text-lg mb-3">{ignoring.desc}</h3><p className="text-sm leading-relaxed">{ignoring.sharedSource.groupName} · {ignoring.date}<br/>你的分攤 NT$ {utils.fmt(ignoring.amount)}</p><p className="text-sm text-ink-2 mt-3">同一筆分攤不會再送入待確認。已經手動記帳或確認過的紀錄會保留。</p>{error && <p className="form-error mt-3">{error}</p>}<div className="flex gap-2 mt-5"><button type="button" className="btn flex-1" onClick={() => setIgnoring(null)}>返回</button><button type="button" className="btn btn-danger flex-1" onClick={ignore}>確認忽略</button></div></Modal>;
  if (editing) {
    const matches = possiblePersonalMatches(editing.draft, group), banks = possibleBankMatches(editing.draft, group);
    return <RecordEditor group={group} myName={myName} initial={editing.initial} sharedReview draftOwner={draftOwner(myName, editing.draft.id)} isSaving={saving} error={error} clearError={() => setError('')} onClose={() => { if (!saving) setEditing(null); }} onExpense={confirm} onTransfer={async () => false}
      notice={<><div className="shared-source-detail"><strong>來自 {editing.draft.sharedSource.groupName}</strong><p>整筆 NT$ {utils.fmt(editing.draft.sharedSource.totalAmount)} · 你的分攤 NT$ {utils.fmt(editing.draft.amount)}</p><p>{editing.existing ? '原分攤已更新，確認後會更新同一筆個人紀錄。' : '尚未計入支出；補好說明與分類後再確認。'}</p></div>
        {(matches.length > 0 || banks.length > 0) && <div className="shared-match-notice"><strong>有可能已記過的消費</strong>{matches.map(record => <p key={record.id}>{record.desc} · NT$ {utils.fmt(record.amount)} · {record.date}</p>)}
          {matches.length > 0 && <button type="button" className="btn btn-sm" onClick={() => { setIgnoring(editing.draft); setEditing(null); }}>已經記過，忽略此分攤</button>}
          {banks.map(record => <div key={record.id}><p>{record.desc} · 銀行全額 NT$ {utils.fmt(record.amount)}</p><button type="button" aria-pressed={bank?.id === record.id} className="btn btn-sm" onClick={() => { setBank(record); setSeparate(false); }}>{bank?.id === record.id ? '已選擇合併銀行記帳' : '同一筆刷卡，改為只記我的分攤'}</button></div>)}
          <label><input type="checkbox" checked={separate} onChange={event => { setSeparate(event.target.checked); if (event.target.checked) setBank(null); }}/>這是不同消費，仍要新增</label></div>}</>}/>;
  }
  return <Modal title="共用分攤待確認" onClose={onClose}>{navigation}
    <div className="bank-inbox-intro"><strong>{drafts.length}</strong><div><h3>筆等你確認</h3><p>{group.name} · 尚未正式入帳</p></div></div>
    {error && <p className="form-error mb-4">{error}</p>}
    {drafts.length > 0 && <button type="button" className="btn btn-primary w-full mb-4" onClick={() => open(drafts[0])}>繼續確認最早一筆</button>}
    <div className="space-y-3">{drafts.map(draft => <article className="bank-inbox-item" key={draft.id}><button type="button" className="bank-inbox-item-main" onClick={() => open(draft)} aria-label={`確認分攤 ${draft.desc} NT$${utils.fmt(draft.amount)}`}><div><strong>{draft.desc}</strong><p>{draft.sharedSource.groupName} · {draft.date}{group.expenses.some(record => record.id === draft.id) ? ' · 更新待確認' : ''}</p></div><span className="money">NT$ {utils.fmt(draft.amount)}</span><ChevronRight size={17} aria-hidden="true"/></button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setIgnoring(draft); }}>忽略</button></article>)}</div>
    {!drafts.length && <div className="empty-state"><Check size={30} aria-hidden="true"/><h3>全部處理好了</h3><p>符合起始日期的新分攤會先放在這裡。</p></div>}
  </Modal>;
}
