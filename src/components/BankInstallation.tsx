import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleCheck, RefreshCw } from 'lucide-react';
import type { Group, MyGroup } from '../types';
import { accountSync } from '../lib/accountSync';
import { currentDeviceUid } from '../lib/firebase';
import { isPersonalLedger } from '../lib/ledgers';
import { storage } from '../lib/utils';
import { bankRulesKey, readBankRules } from '../lib/bankShortcuts';
import { backgroundStatus, bindBackgroundShortcut, revokeBackgroundShortcuts, type BackgroundStatus } from '../lib/bankBackgroundClient';
import { bankBackgroundEndpoint, bankBackgroundInstallUrl, bankBackgroundName, richartBackgroundInstallUrl, richartBackgroundName } from '../lib/bankBackgroundProtocol';
import { freshInstallation, installationChecks, installationReceipt, readInstallation, saveInstallation, type InstallationProgress } from '../lib/bankInstallation';
import { AccountSyncSettings } from './AccountSyncSettings';
import { BankShortcutSettings } from './BankShortcutSettings';
import { Modal } from './Modal';

const titles = ['確認銀行資料', '加入主捷徑並測試', '開啟 Richart 通知'];
const time = (at: number) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at);
const openShortcut = (name: string) => 'shortcuts://open-shortcut?name=' + encodeURIComponent(name);

export function BankInstallation({ groups, currentGroup, onClose, onCreateLedger, onLaunchSetup = (url: string) => location.assign(url) }: { groups: MyGroup[]; currentGroup: Group | null; onClose: () => void; onCreateLedger: () => void; onLaunchSetup?: (url: string) => void }) {
  const account = useSyncExternalStore(accountSync.subscribe, accountSync.getSnapshot);
  const [revision, setRevision] = useState(0);
  const books = useMemo(() => groups.flatMap(book => { const group = currentGroup?.code === book.code ? currentGroup : storage.getGroup(book.code); return group && isPersonalLedger(group) ? [group] : []; }), [groups, currentGroup, revision]);
  const [selected, setSelected] = useState(isPersonalLedger(currentGroup) ? currentGroup!.code : '');
  const group = books.find(book => book.code === selected) || books[0] || null;
  const uid = currentDeviceUid(), code = group?.code || '', scope = uid + ':' + code;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [saved, setSaved] = useState<{ scope: string; value: InstallationProgress } | null>(null);
  const progress = saved?.scope === scope ? saved.value : readInstallation(localStorage, uid, code);
  const [status, setStatus] = useState<{ scope: string; value: BackgroundStatus } | null>(null);
  const currentStatus = status?.scope === scope ? status.value : null;
  const [loading, setLoading] = useState(false), [acting, setActing] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false), [confirmReset, setConfirmReset] = useState(false), [confirmRevoke, setConfirmRevoke] = useState(false);
  const inFlight = useRef('');
  const rules = useMemo(() => { try { return readBankRules(localStorage).filter(rule => rule.enabled && rule.groupCode === code); } catch { return []; } }, [code, revision]);
  const checks = installationChecks(!!account.email && account.ready, code, currentStatus, progress);
  const step = checks.findIndex(checked => !checked), completed = checks.filter(Boolean).length;
  const receipt = installationReceipt(code, currentStatus, progress);
  const ready = !!account.email && account.ready;
  const refresh = useCallback(async () => {
    if (!ready || !code || inFlight.current === scope) return;
    inFlight.current = scope; setLoading(true);
    try { const value = await backgroundStatus(); if (scopeRef.current === scope) { setStatus({ scope, value }); setError(''); } }
    catch (e) { if (scopeRef.current === scope) setError((e as Error).message); }
    finally { if (inFlight.current === scope) { inFlight.current = ''; setLoading(false); } }
  }, [ready, code, scope]);
  useEffect(() => {
    const changed = (event: Event) => { if (!(event instanceof StorageEvent) || event.key === bankRulesKey) setRevision(value => value + 1); };
    window.addEventListener('storage', changed); window.addEventListener('account-sync-updated', changed);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('account-sync-updated', changed); };
  }, []);
  useEffect(() => { setError(''); setMessage(''); void refresh(); }, [refresh, revision]);
  useEffect(() => {
    const foreground = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', foreground); window.addEventListener('focus', foreground); window.addEventListener('online', foreground);
    const interval = progress.testBaselineAt !== null && !checks[1] ? window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000) : undefined;
    return () => { document.removeEventListener('visibilitychange', foreground); window.removeEventListener('focus', foreground); window.removeEventListener('online', foreground); window.clearInterval(interval); };
  }, [refresh, progress.testBaselineAt, checks[1]]);
  useEffect(() => { window.scrollTo(0, 0); }, [step, scope]);
  useEffect(() => { if (checks[1]) setMessage(''); }, [checks[1]]);
  const remember = (value: InstallationProgress) => { saveInstallation(localStorage, uid, code, value); setSaved({ scope, value }); };
  const bind = async () => {
    if (acting) return;
    setActing(true); setError(''); setMessage(''); const activeScope = scope;
    try {
      const before = await backgroundStatus();
      if (!before.eligibleGroupCodes?.includes(code)) throw new Error('這本帳本的銀行資料還沒同步完成，請先回第 1 步確認。');
      const url = await bindBackgroundShortcut();
      if (scopeRef.current !== activeScope) return;
      remember({ ...freshInstallation(), testBaselineAt: before.currentKey?.testedAt || 0 });
      setMessage('請在捷徑完成連線測試，再切回這個 App；這一步會自動打勾。');
      onLaunchSetup(url);
    } catch (e) { setError((e as Error).message); }
    finally { setActing(false); }
  };
  const confirmAutomation = () => { try { remember({ ...progress, automationConfirmed: true }); setError(''); } catch (e) { setError((e as Error).message); } };
  const reset = () => { try { remember(freshInstallation()); setConfirmReset(false); setMessage('安裝進度已重設，原本的帳本與銀行資料會保留。'); setError(''); } catch (e) { setError((e as Error).message); } };
  const revoke = async () => {
    setActing(true); setError('');
    try { await revokeBackgroundShortcuts(); remember(freshInstallation()); setStatus(null); setConfirmRevoke(false); setMessage('背景綁定已停用，可以重新安裝；帳目與待確認資料會保留。'); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setActing(false); }
  };

  return <div className="bank-install-page">
    <nav className="bank-install-nav" aria-label="捷徑安裝導覽"><button type="button" className="icon-btn" onClick={onClose} aria-label="返回帳本"><ArrowLeft size={20} /></button><span>手機自動記帳</span><span className="bank-install-count">{completed} / 3</span></nav>
    <main className="bank-install-content">
      <header className="bank-install-intro"><h1>{completed === 3 ? '設定完成' : '跟著做，就能開始記帳'}</h1><p>{completed === 3 ? '之後有效消費先進待確認，補好資料才入帳。' : '只需 2 個捷徑，依序完成下面 3 步。'}</p></header>
      <ol className="bank-install-progress" aria-label="安裝進度">{titles.map((title, index) => <li key={title} data-done={checks[index]} aria-current={step === index ? 'step' : undefined}><span className="bank-install-dot" aria-hidden="true">{checks[index] ? <Check size={18} /> : index + 1}</span><span>{['銀行資料', '主捷徑', '通知來源'][index]}</span><span className="sr-only">{checks[index] ? index === 2 ? '：你已確認完成' : '：已驗證' : '：尚未完成'}</span></li>)}</ol>
      {group && <div className="bank-install-book"><div><span>記入個人帳本</span><strong>{group.name}</strong>{rules.length > 0 && <small>{rules.map(rule => rule.bank + ' · 末 4 碼 ' + rule.last4).join('、')}</small>}</div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>修改</button></div>}
      {step === 0 && <section className="bank-install-card" aria-labelledby="install-step-title">
        <p className="bank-install-step-label">第 1 步，共 3 步</p><h2 id="install-step-title">確認銀行資料</h2>
        <p>沿用你原本的個人帳本，銀行與卡號末 4 碼只需在這裡設定。</p>
        {!account.initialized && <p className="bank-install-notice" role="status">正在讀取原本的帳本與銀行設定…</p>}
        {account.initialized && !ready && <AccountSyncSettings preferLogin={!books.length} />}
        {books.length > 1 && <div className="field mt-4"><label className="field-label" htmlFor="install-ledger">要記入的個人帳本</label><select id="install-ledger" value={code} onChange={event => setSelected(event.target.value)}>{books.map(book => <option key={book.code} value={book.code}>{book.name}</option>)}</select></div>}
        {account.initialized && (!group ? <div className="mt-4"><p className="text-sm text-ink-2">原本已有帳本，請先登入上方的帳本同步。</p><button type="button" className="btn btn-ghost w-full mt-3" onClick={onCreateLedger}>我還沒有個人帳本，先建立一本</button></div> : !rules.length ? <Fragment key={code}><BankShortcutSettings group={group} rulesOnly /></Fragment> : <p className="bank-install-notice">{loading ? '正在確認銀行資料已同步…' : ready ? '確認同步完成後，會自動進入下一步。' : '完成帳本同步後，這一步會自動打勾。'}</p>)}
        {ready && <button type="button" className="btn w-full mt-4" disabled={loading || acting} onClick={() => { setActing(true); void accountSync.refresh().then(refresh).catch(e => setError((e as Error).message)).finally(() => setActing(false)); }}>{loading || acting ? '確認中…' : '重新確認資料'}</button>}
      </section>}
      {step === 1 && <section className="bank-install-card" aria-labelledby="install-step-title">
        <p className="bank-install-step-label">第 2 步，共 3 步</p><h2 id="install-step-title">先加入主捷徑</h2><p>它負責把消費安全送回這本帳本。</p>
        <div className="bank-install-shortcut"><span className="bank-install-shortcut-icon" aria-hidden="true"><ArrowUpRight size={25} /></span><div><strong>{bankBackgroundName}</strong><small>主捷徑 · 背景傳送</small></div></div>
        <a className="btn btn-primary w-full" href={bankBackgroundInstallUrl} target="_blank" rel="noopener noreferrer">1. 加入「銀行背景記帳」<ArrowUpRight size={16} /></a>
        <p className="bank-install-hint">在 Apple 頁面按「加入捷徑」，再切回這個 App 繼續。</p>
        <button type="button" className="btn w-full mt-3" disabled={acting || loading} onClick={bind}>{acting ? '準備綁定…' : '2. 已加入，綁定並測試'}</button>
        <p className="bank-install-hint">連線成功才會自動打勾，測試不會新增帳目。首次若詢問連線權限，請允許自己的記帳服務。</p>
        {progress.testBaselineAt !== null && <div className="bank-install-waiting" role="status"><RefreshCw size={16} /><span>等待捷徑回報連線結果</span><button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? '確認中' : '檢查結果'}</button></div>}
      </section>}
      {step === 2 && <section className="bank-install-card" aria-labelledby="install-step-title">
        <p className="bank-install-step-label">第 3 步，共 3 步</p><h2 id="install-step-title">讓 Richart 通知觸發記帳</h2><p>最後加入通知來源，開啟自動化。</p>
        <div className="bank-install-shortcut"><span className="bank-install-shortcut-icon" data-source aria-hidden="true"><ArrowUpRight size={25} /></span><div><strong>{richartBackgroundName}</strong><small>通知來源 · 已選好 Richart</small></div></div>
        <a className="btn btn-primary w-full" href={richartBackgroundInstallUrl} target="_blank" rel="noopener noreferrer">加入「Richart 背景記帳」<ArrowUpRight size={16} /></a>
        <a className="btn btn-ghost w-full mt-3" href={openShortcut(richartBackgroundName)}>開啟剛加入的捷徑<ChevronRight size={16} /></a>
        <p className="bank-install-notice">在捷徑中按「編輯」，開啟「自動化」並儲存，再回到這裡。</p>
        <button type="button" className="btn btn-primary w-full mt-4" onClick={confirmAutomation}>我已開啟自動化，完成設定<Check size={17} /></button>
        <p className="bank-install-hint">這個開關只能由你在 iPhone 確認，App 無法讀取它的狀態。</p>
      </section>}
      {completed === 3 && <section className="bank-install-complete" aria-labelledby="install-complete-title"><CircleCheck size={44} aria-hidden="true" /><h2 id="install-complete-title">3 步都完成了</h2><ul><li><Check size={16} />銀行與帳本已驗證</li><li><Check size={16} />主捷徑連線測試通過</li><li><Check size={16} />通知自動化：你已確認開啟</li></ul><button type="button" className="btn btn-primary w-full" onClick={onClose}>回帳本，查看待確認</button></section>}
      {error && <div className="bank-install-error" role="alert"><p>{error}</p><button type="button" className="btn btn-sm mt-3" disabled={loading} onClick={() => void refresh()}>重新確認</button></div>}
      {message && completed !== 3 && <p className="bank-install-notice" role="status">{message}</p>}
      {completed >= 2 && <section className="bank-install-receipt">{receipt ? <CircleCheck size={19} aria-hidden="true" /> : <RefreshCw size={19} aria-hidden="true" />}<div><h3>{receipt ? '已收到有效消費通知' : '第一則通知，等待驗證'}</h3><p>{receipt ? time(receipt.at) + ' · ' + receipt.message : '下次收到 Richart 有效消費通知後，這裡會自動更新。先到待確認，不會直接計入支出。'}</p><button type="button" className="bank-install-text-button" disabled={loading} onClick={() => void refresh()}>{loading ? '確認中…' : '確認最新接收結果'}</button></div></section>}
      <details className="bank-install-help"><summary>需要重新安裝或遇到問題？</summary><div>
        <p>刪過捷徑或換手機，可從頭安裝。只會重設這台裝置的安裝勾選，不會刪除帳目或銀行資料。</p><button type="button" className="btn w-full mt-3" onClick={() => setConfirmReset(true)}>我刪過捷徑，從頭安裝</button>
        <details className="mt-4"><summary>想在鎖定時接收</summary><p>先在解鎖時完成連線授權，再到「銀行背景記帳 → 編輯 → 資訊 → 隱私」檢查「允許鎖定時執行」。鎖定時的網路與檔案存取，仍需用你的 iPhone 實際通知確認。</p></details>
        <details className="mt-4"><summary>Apple 安裝頁打不開</summary><p>可用 Safari 開啟 Apple 安裝頁。也可下載 ZIP，在「檔案」解壓後加入。</p><a className="btn w-full mt-3" href={import.meta.env.BASE_URL + 'shortcuts/bank-background-shortcut.zip'} download="銀行背景記帳.zip">下載主捷徑 ZIP</a><a className="btn w-full mt-3" href={import.meta.env.BASE_URL + 'shortcuts/richart-background-source.zip'} download="Richart 背景記帳.zip">下載通知來源 ZIP</a></details>
        <details className="mt-4"><summary>連線權限與資料保存</summary><p className="break-all">連線網址：{new URL(bankBackgroundEndpoint).hostname}</p><p>沿用免費接收服務，只保存解析後的待確認資料，不保存原始通知。成功時不開 Safari；無網路或 iOS 中止時不會自動補送。</p></details>
        <button type="button" className="bank-install-text-button mt-4" onClick={() => setConfirmRevoke(true)}>停用此帳號所有背景綁定</button>
      </div></details>
    </main>
    {editing && <Modal title="銀行資料" onClose={() => setEditing(false)}>{books.length > 1 && <div className="field"><label className="field-label" htmlFor="install-edit-ledger">個人帳本</label><select id="install-edit-ledger" value={code} onChange={event => setSelected(event.target.value)}>{books.map(book => <option key={book.code} value={book.code}>{book.name}</option>)}</select></div>}<AccountSyncSettings compact />{group && <Fragment key={code}><BankShortcutSettings group={group} rulesOnly /></Fragment>}<button type="button" className="btn btn-primary w-full mt-4" onClick={() => { setEditing(false); void refresh(); }}>回到安裝步驟</button></Modal>}
    {confirmReset && <Modal title="重新安裝捷徑" onClose={() => setConfirmReset(false)}><p className="text-sm leading-relaxed">清除這台裝置的安裝勾選，重新加入兩個捷徑並測試連線。帳目、待確認與銀行資料會保留。</p><div className="flex gap-3 mt-5"><button type="button" className="btn flex-1" onClick={() => setConfirmReset(false)}>取消</button><button type="button" className="btn btn-primary flex-1" onClick={reset}>從頭安裝</button></div></Modal>}
    {confirmRevoke && <Modal title="停用所有背景綁定" onClose={() => { if (!acting) setConfirmRevoke(false); }}><p className="text-sm leading-relaxed">此帳號所有裝置的背景捷徑將停止接收。重新使用時需再綁定；既有帳目與待確認資料會保留。</p><div className="flex gap-3 mt-5"><button type="button" className="btn flex-1" disabled={acting} onClick={() => setConfirmRevoke(false)}>取消</button><button type="button" className="btn btn-danger flex-1" disabled={acting} onClick={revoke}>{acting ? '處理中…' : '確定停用'}</button></div></Modal>}
  </div>;
}
