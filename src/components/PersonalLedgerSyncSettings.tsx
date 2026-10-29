import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link2, Check } from 'lucide-react';
import type { Group, MyGroup } from '../types';
import { personalLedgerSync } from '../lib/personalLedgerSync';
import { currentDeviceUid, fetchGroupOnce } from '../lib/firebase';
import { isPersonalLedger } from '../lib/ledgers';
import { memberExpenseAmount } from '../lib/sharedExpenses';
import { legacySharedExpense, reviewLink } from '../lib/sharedInbox';
import { storage, utils } from '../lib/utils';

export function PersonalLedgerSyncSettings({ group, myName, books, onAccount }: {
  group: Group; myName: string; books: MyGroup[]; onAccount: () => void;
}) {
  const state = useSyncExternalStore(personalLedgerSync.subscribe, personalLedgerSync.getSnapshot);
  const link = state.links[group.code];
  const [choices, setChoices] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(link?.targetCode || '');
  const [since, setSince] = useState(link?.since || utils.todayStr());
  const [cleanupLegacy, setCleanupLegacy] = useState(link?.cleanupLegacy || false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const bookCodes = books.map(book => [book.code, book.name, book.kind].join(':')).join(',');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all(books.map(async book => {
      const cached = storage.getGroup(book.code);
      if (!isPersonalLedger(cached || book)) return null;
      const owned = cached?.security?.ownerUid === currentDeviceUid() ? cached : await fetchGroupOnce(book.code).catch(() => null);
      return owned && isPersonalLedger(owned) && owned.security?.ownerUid === currentDeviceUid() ? owned : null;
    })).then(values => { if (!cancelled) { setChoices(values.filter((book): book is Group => !!book)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [bookCodes, state.uid]);
  useEffect(() => { setTarget(link?.targetCode || ''); setSince(link?.since || utils.todayStr()); setCleanupLegacy(link?.cleanupLegacy || false); }, [link?.targetCode, link?.since, link?.cleanupLegacy]);
  useEffect(() => { if (!target && choices.length === 1) setTarget(choices[0].code); }, [choices, target]);
  const eligible = group.expenses.filter(expense => expense.date >= since && memberExpenseAmount(expense, myName) > 0).length;
  const legacyCount = choices.reduce((count, book) => count + (storage.getGroup(book.code) || book).expenses.filter(expense => expense.sharedSource?.groupCode === group.code && legacySharedExpense(expense)).length, 0);
  const enabled = !!link?.enabled && reviewLink(link);
  const save = async (active: boolean) => {
    setBusy(true); setError(''); setSaved('');
    try {
      await personalLedgerSync.configure(group.code, myName, !active && link ? link.targetCode : target, active, !active && link?.since ? link.since : since, !active && link ? link.cleanupLegacy : cleanupLegacy);
      setSaved(active ? '已儲存，符合日期的分攤會先送到所選帳本的待確認。' : '已暫停新增分攤，已確認紀錄與待確認內容會保留。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '設定未完成，請稍後再試'); }
    finally { setBusy(false); }
  };
  return <section className="personal-sync-settings">
    <div className="personal-sync-title"><Link2 size={19} aria-hidden="true" /><h3>我的分攤同步</h3>{enabled && <span><Check size={14} aria-hidden="true" />待確認同步已開啟</span>}</div>
    <p>只送入你負擔的金額。先在個人帳本補好說明與分類，確認後才計入收支。</p>
    {link?.enabled && !reviewLink(link) && <p className="shared-match-notice">舊版直接入帳已暫停。請確認目標帳本及起始日期，改用待確認流程。</p>}
    {loading ? <p role="status">載入你的個人帳本…</p> : choices.length ? <>
      <div className="field"><label className="field-label" htmlFor="personal-sync-target">同步到哪本個人帳本</label>
        <select id="personal-sync-target" value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setSaved(''); }}>
          <option value="" disabled>請選擇個人帳本</option>
          {choices.map(book => <option key={book.code} value={book.code}>{book.name}</option>)}
        </select>
      </div>
      <div className="field"><label className="field-label" htmlFor="personal-sync-since">從哪一天的帳開始</label>
        <input id="personal-sync-since" type="date" value={since} disabled={busy} onChange={event => { setSince(event.target.value); setSaved(''); }}/>
        <p className="personal-sync-note">包含當天，依分帳的消費日期判斷。更早的帳不會補匯。</p>
      </div>
      <div className="shared-match-notice"><strong>先進入待確認，再由你入帳</strong><p>{since} 起，你有負擔的分攤目前共 {eligible} 筆；已確認或忽略的同一筆不會重複新增。</p></div>
      {legacyCount > 0 && <label className="shared-sync-cleanup"><input type="checkbox" checked={cleanupLegacy} disabled={busy} onChange={event => setCleanupLegacy(event.target.checked)}/><span>整理舊版的 {legacyCount} 筆同步副本<small>起始日期以前的副本移除，之後的移到待確認；手動記帳與 CSV 匯入保留。</small></span></label>}
      <button type="button" className="btn btn-primary w-full mt-3" disabled={busy || !state.ready || !choices.some(book => book.code === target) || !since} onClick={() => void save(true)}>{busy ? '設定中…' : enabled ? '儲存同步設定' : '開啟待確認同步'}</button>
      {enabled && <button type="button" className="btn btn-ghost w-full mt-2" disabled={busy} onClick={() => void save(false)}>暫停分攤同步</button>}
      <p className="personal-sync-note">可以直接更換目標帳本。未確認的新分攤會移到新帳本；已確認的紀錄留在原帳本，不再複製一次。還款轉帳不會同步為支出。</p>
    </> : <><p>先建立自己的個人帳本，就能在這裡選擇。</p><button type="button" className="btn btn-sm" onClick={onAccount}>查看帳本同步</button></>}
    {saved && <p role="status" className="personal-sync-note">{saved}</p>}
    {(error || state.errors[group.code] || state.errors.settings) && <p role="status" className="form-error">{error || state.errors[group.code] || state.errors.settings}</p>}
    {enabled && state.errors[group.code] && <button type="button" className="btn btn-sm" onClick={() => personalLedgerSync.retry(group.code)}>重新核對</button>}
  </section>;
}
