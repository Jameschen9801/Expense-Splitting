import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link2, Check } from 'lucide-react';
import type { Group, MyGroup } from '../types';
import { personalLedgerSync } from '../lib/personalLedgerSync';
import { currentDeviceUid } from '../lib/firebase';
import { isPersonalLedger } from '../lib/ledgers';
import { memberExpenseAmount } from '../lib/sharedExpenses';
import { storage } from '../lib/utils';

export function PersonalLedgerSyncSettings({ group, myName, books, onAccount }: {
  group: Group; myName: string; books: MyGroup[]; onAccount: () => void;
}) {
  const state = useSyncExternalStore(personalLedgerSync.subscribe, personalLedgerSync.getSnapshot);
  const link = state.links[group.code];
  const choices = books.filter(book => { const cached = storage.getGroup(book.code); return cached && isPersonalLedger(cached) && cached.security?.ownerUid === currentDeviceUid(); });
  const [target, setTarget] = useState(link?.targetCode || choices[0]?.code || '');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setTarget(link?.targetCode || choices[0]?.code || ''); setConfirmOff(false); }, [link?.targetCode, link?.enabled, choices.map(book => book.code).join(',')]);
  const count = group.expenses.filter(expense => memberExpenseAmount(expense, myName) > 0).length;
  const save = async (enabled: boolean) => {
    setBusy(true); setError('');
    try { await personalLedgerSync.configure(group.code, myName, target, enabled); setConfirmOff(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '設定未完成，請稍後再試'); }
    finally { setBusy(false); }
  };
  return <section className="personal-sync-settings">
    <div className="personal-sync-title"><Link2 size={19} aria-hidden="true" /><h3>我的分攤同步</h3>{link?.enabled && <span><Check size={14} aria-hidden="true" />已開啟</span>}</div>
    <p>只把你負擔的金額記入個人帳本。其他成員新增、修改或刪除時，開啟 App 會自動核對。</p>
    {choices.length ? <>
      <label className="field-label" htmlFor="personal-sync-target">同步到哪本個人帳本</label>
      <select id="personal-sync-target" value={target} disabled={busy || !!link?.enabled} onChange={event => setTarget(event.target.value)}>
        {!choices.some(book => book.code === target) && <option value="">請選擇個人帳本</option>}
        {choices.map(book => <option key={book.code} value={book.code}>{book.name}</option>)}
      </select>
      {confirmOff ? <div className="personal-sync-confirm"><p>關閉會移除這個共用帳本同步的記錄，原始分帳與個人手動記帳會保留。</p><div><button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirmOff(false)}>保留同步</button><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void save(false)}>{busy ? '處理中…' : '確認關閉'}</button></div></div>
        : <button type="button" className={`btn ${link?.enabled ? '' : 'btn-primary'} w-full mt-3`} disabled={busy || !state.ready || !target} onClick={() => link?.enabled ? setConfirmOff(true) : void save(true)}>{busy ? '設定中…' : link?.enabled ? '關閉分攤同步' : `開啟並同步${count ? ` ${count} 筆` : ''}`}</button>}
      <p className="personal-sync-note">{link?.enabled ? '金額、說明與分類跟隨原始分帳；要更換帳本，請先關閉同步。' : '會一併帶入既有分攤，還款轉帳不計入支出。'}</p>
    </> : <><p>先建立自己的個人帳本，就能在這裡選擇。</p><button type="button" className="btn btn-sm" onClick={onAccount}>查看帳本同步</button></>}
    {(error || state.errors[group.code] || state.errors.settings) && <p role="status" className="form-error">{error || state.errors[group.code] || state.errors.settings}</p>}
    {link?.enabled && state.errors[group.code] && <button type="button" className="btn btn-sm" onClick={() => personalLedgerSync.retry(group.code)}>重新核對</button>}
  </section>;
}
