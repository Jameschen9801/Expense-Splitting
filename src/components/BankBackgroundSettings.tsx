import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { accountSync } from '../lib/accountSync';
import { backgroundStatus, bindBackgroundShortcut, revokeBackgroundShortcuts, bankBackgroundInstallUrl, richartBackgroundInstallUrl, bankBackgroundName, richartBackgroundName, type BackgroundStatus } from '../lib/bankBackgroundClient';
import { bankNotificationShortcutName } from '../lib/bankShortcuts';

const openShortcut = (name: string) => 'shortcuts://open-shortcut?name=' + encodeURIComponent(name);
export function BankBackgroundSettings({ hasRule }: { hasRule: boolean }) {
  const account = useSyncExternalStore(accountSync.subscribe, accountSync.getSnapshot);
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!account.email || !account.ready || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { setStatus(await backgroundStatus()); }
    catch (error) { setMessage((error as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }, [account.email, account.ready]);
  useEffect(() => {
    setStatus(null);
    void refresh();
    const foreground = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', foreground);
    return () => document.removeEventListener('visibilitychange', foreground);
  }, [refresh]);
  const bind = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { const url = await bindBackgroundShortcut(); setMessage('即將開啟銀行背景記帳，保存設定並完成連線測試；測試不會新增帳目。'); location.assign(url); }
    catch (error) { setMessage((error as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const revoke = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { await revokeBackgroundShortcuts(); setConfirmRevoke(false); setStatus(await backgroundStatus()); setMessage('所有背景綁定已停用。需要再使用時，重新按「綁定並測試連線」。'); }
    catch (error) { setMessage((error as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const last = status?.lastDelivery;
  const statusLabel = last ? { ready: '連線測試', pending: '等待你確認', duplicate: '重複通知已略過', ignored: '未符合規則', error: '需要處理' }[last.status] : '';
  return <section className="bank-background-settings mt-6" aria-labelledby="bank-background-heading">
    <p className="text-xs text-ink-3 mb-2">背景接收 · 個人帳本</p>
    <h4 id="bank-background-heading" tabIndex={-1} className="text-base font-medium">2. 改用背景記帳</h4>
    <p className="text-sm text-ink-2 leading-relaxed mt-3">Richart 通知符合銀行與末 4 碼規則，就直接送進「手機通知待確認」，成功時不開 Safari。補好說明與分類後，再由你確認加入帳本。</p>
    <div className="rounded-2xl border border-line bg-paper-2 p-4 mt-4">
      <div className="flex items-center justify-between gap-3"><strong className="text-sm">最近一次背景接收</strong><button type="button" className="btn btn-sm" disabled={busy || !account.email || !account.ready} onClick={refresh}>{busy ? '確認中…' : '重新確認'}</button></div>
      <p className="text-sm mt-3" role="status">{last ? last.message : status ? '尚未收到背景捷徑的連線測試或通知' : '完成下方綁定後，可在這裡查看接收結果'}</p>
      {last && <p className="text-xs text-ink-3 mt-2">{new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(last.at)} · {statusLabel}</p>}
    </div>
    {(!account.email || !account.ready) && <p className="text-sm text-ink-2 mt-4">先在上方完成帳本同步，讓背景捷徑能找到你原本的個人帳本。</p>}
    {!hasRule && <p className="text-sm text-ink-2 mt-4">請先儲存並啟用上方的銀行與末 4 碼規則。</p>}
    <div className="rounded-2xl border border-line p-4 mt-4">
      <p className="text-sm font-medium">先加入主捷徑，再綁定</p>
      <a className="btn btn-primary w-full mt-3" href={bankBackgroundInstallUrl} target="_blank" rel="noopener noreferrer">加入銀行背景記帳</a>
      <button type="button" className="btn w-full mt-3" disabled={busy || !hasRule || !account.email || !account.ready} onClick={bind}>{busy ? '處理中…' : '已加入，綁定並測試連線'}</button>
      <p className="text-xs text-ink-3 mt-3 leading-relaxed">開啟捷徑後完成連線測試。若詢問是否允許連線到自己的記帳服務，請確認網址是 asia-east1-expense-splitting-a9b78.cloudfunctions.net。之後修改銀行規則只需在 App 儲存。</p>
    </div>
    <div className="rounded-2xl border border-line p-4 mt-4">
      <h4 className="text-sm font-medium">3. 切換 Richart 通知來源</h4>
      <a className="btn btn-primary w-full mt-3" href={richartBackgroundInstallUrl} target="_blank" rel="noopener noreferrer">加入 Richart 背景記帳</a>
      <a className="btn w-full mt-3" href={openShortcut(richartBackgroundName)}>開啟新版啟用設定</a>
      <ol className="text-sm leading-relaxed space-y-3 pl-5 list-decimal mt-4">
        <li>加入後，開啟「Richart 背景記帳」，按「編輯」，在已填好的 Richart 通知條件旁開啟「自動化」並儲存。</li>
        <li>停用原本「Richart 通知自動化」的自動化開關，避免舊版繼續開 Safari。Richart Life 不用另外加入。</li>
        <li>想在鎖定時接收，可在主捷徑「{bankBackgroundName}」的「編輯 → 資訊 → 隱私」檢查「允許鎖定時執行」。先在解鎖時完成一次綁定與連線授權。</li>
      </ol>
      <a className="btn w-full mt-4" href={openShortcut(bankNotificationShortcutName)}>開啟舊版，停用舊自動化</a>
      <p className="text-xs text-ink-3 leading-relaxed mt-3">App 無法讀取 iPhone 的啟用狀態。請以下一次真實通知與上方接收時間確認；鎖定時能否執行，仍需在你的手機實測。</p>
    </div>
    <details className="expense-more mt-4"><summary>無法開啟 Apple 安裝頁面？</summary><div className="py-3"><p className="text-xs text-ink-3 leading-relaxed">請用 Safari 開啟安裝連結。也可下載 ZIP，在「檔案」解壓後點捷徑加入；不要直接預覽 .shortcut 原始檔。</p><a className="btn w-full mt-3" href={import.meta.env.BASE_URL + 'shortcuts/bank-background-shortcut.zip'} download="銀行背景記帳.zip">下載主捷徑 ZIP</a><a className="btn w-full mt-3" href={import.meta.env.BASE_URL + 'shortcuts/richart-background-source.zip'} download="Richart 背景記帳.zip">下載 Richart 來源 ZIP</a></div></details>
    <details className="expense-more mt-4"><summary>背景記帳如何保存資料？</summary><div className="text-xs text-ink-3 leading-relaxed py-3"><p>通知會透過加密連線傳到此專案的 Firebase 接收服務，只保存辨識後的金額、日期與待確認資料，不保存原始通知，也不使用 AI。綁定僅可送入待確認，不能讀取帳目、刪帳或改設定。</p><p className="mt-2">成功、重複或不符合規則時安靜結束；伺服器拒絕時會提示。沒有網路或 iOS 中止時可能需要手動重試，不代表已保存，也不會自動補送。</p></div></details>
    <details className="expense-more mt-3"><summary>停用背景綁定</summary><div className="py-3"><p className="text-xs text-ink-3 leading-relaxed">讓此帳號所有已綁定的背景捷徑停止收件，既有帳目與待確認資料會保留。</p>{confirmRevoke ? <div className="mt-3"><p className="text-sm">確定停用所有背景綁定？重新使用時需再綁定捷徑。</p><div className="flex gap-2 mt-3"><button type="button" className="btn flex-1" disabled={busy} onClick={() => setConfirmRevoke(false)}>取消</button><button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={revoke}>確定停用</button></div></div> : <button type="button" className="btn btn-danger w-full mt-3" disabled={busy || !status?.activeKeys} onClick={() => setConfirmRevoke(true)}>停用所有背景綁定</button>}</div></details>
    {message && <p role="status" className="text-sm leading-relaxed mt-4">{message}</p>}
  </section>;
}
