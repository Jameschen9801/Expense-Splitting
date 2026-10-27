import { useState, useSyncExternalStore } from 'react';
import { accountError, accountSync } from '../lib/accountSync';

export function AccountSyncSettings({ preferLogin = false, compact = false, onReady }: { preferLogin?: boolean; compact?: boolean; onReady?: () => void }) {
  const account = useSyncExternalStore(accountSync.subscribe, accountSync.getSnapshot);
  const [expanded, setExpanded] = useState(!compact);
  const [mode, setMode] = useState<'link' | 'login'>(preferLogin ? 'login' : 'link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (action: () => Promise<void>, success?: string) => {
    if (busy || account.busy) return;
    setBusy(true); setMessage('');
    try { await action(); setPassword(''); setConfirmation(''); if (success) setMessage(success); onReady?.(); }
    catch (error) { setMessage(accountError(error)); }
    finally { setBusy(false); }
  };
  const locked = busy || account.busy;
  return <section className="account-sync-settings settings-section">
    <div className="account-sync-title"><h3 className="settings-heading">帳本同步</h3><span className="account-sync-badge">{account.email ? account.ready ? '已連結' : '待同步' : '尚未連結'}</span></div>
    <p className="text-sm text-ink-2 leading-relaxed">桌面 App、Safari 都使用同一本帳本，銀行規則也一起同步。</p>
    {!expanded ? <button type="button" className="btn w-full mt-3" onClick={() => setExpanded(true)}>{account.email ? '查看同步帳號' : '連結原本帳本'}</button> : <>
      {account.email ? <div className="mt-4">
        <p className="text-sm break-all">{account.email}</p>
        <p className="text-xs text-ink-3 leading-relaxed mt-2">在 Safari 登入這個帳號即可。你和女朋友可各用自己的帳號；共用帳本繼續用邀請碼加入。</p>
        <button type="button" className="btn w-full mt-3" disabled={locked} onClick={() => run(accountSync.refresh)}>{locked ? '同步中…' : '立即同步帳本與銀行設定'}</button>
        {account.message && <p role="status" className="text-xs text-ink-2 mt-3">{account.message}</p>}
      </div> : <>
        <div className="account-sync-steps mt-4"><p><strong>1</strong> 先在有原本帳目的桌面 App 開啟同步</p><p><strong>2</strong> 捷徑開到 Safari 時，登入同一個帳號</p></div>
        <div className="account-sync-modes mt-4" role="group" aria-label="帳本同步方式">
          <button type="button" className="btn btn-sm" aria-pressed={mode === 'link'} disabled={locked} onClick={() => { setMode('link'); setMessage(''); }}>我是原本記帳的 App</button>
          <button type="button" className="btn btn-sm" aria-pressed={mode === 'login'} disabled={locked} onClick={() => { setMode('login'); setMessage(''); }}>我已設定，要登入</button>
        </div>
        <p className="text-xs text-ink-3 leading-relaxed mt-3">{mode === 'link' ? '綁定目前的帳本身分，保留原本帳目。請設定自己的 Email 與密碼。' : '使用桌面 App 剛設定的 Email 與密碼，不需要新增帳本。'}</p>
        <form className="bank-rule-form mt-4" onSubmit={event => { event.preventDefault(); if (mode === 'link' && password !== confirmation) { setMessage('兩次密碼不一致'); return; } void run(() => mode === 'link' ? accountSync.link(email, password) : accountSync.login(email, password), mode === 'link' ? '原本帳本已開啟同步。接著在 Safari 登入相同帳號，再完成銀行捷徑綁定。' : '已連回原本帳本，可繼續記帳'); }}>
          <div><label className="field-label" htmlFor="sync-email">Email</label><input id="sync-email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={locked} onChange={event => setEmail(event.target.value)} placeholder="你的 Email" /></div>
          <div><label className="field-label" htmlFor="sync-password">密碼</label><input id="sync-password" type="password" autoComplete={mode === 'link' ? 'new-password' : 'current-password'} required minLength={mode === 'link' ? 8 : 1} maxLength={128} value={password} disabled={locked} onChange={event => setPassword(event.target.value)} placeholder={mode === 'link' ? '至少 8 個字元' : '同步帳號的密碼'} /></div>
          {mode === 'link' && <div><label className="field-label" htmlFor="sync-confirmation">再次輸入密碼</label><input id="sync-confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={locked} onChange={event => setConfirmation(event.target.value)} /></div>}
          <button className="btn btn-primary w-full" disabled={locked || !account.initialized}>{locked ? '處理中…' : mode === 'link' ? '保留現有帳本並開啟同步' : '登入並連回原本帳本'}</button>
        </form>
        {mode === 'login' && <button type="button" className="btn btn-ghost btn-sm w-full mt-2" disabled={locked || !email.trim()} onClick={() => run(() => accountSync.resetPassword(email), '若此 Email 已註冊，你將收到密碼重設信，請查看收件匣。')}>忘記密碼，寄送重設信</button>}
      </>}
    </>}
    {message && <p role="status" className="text-sm leading-relaxed mt-4 whitespace-pre-line">{message}</p>}
  </section>;
}
