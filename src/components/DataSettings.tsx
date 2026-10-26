import { useRef, useState, useSyncExternalStore } from 'react';
import type { Group } from '../types';
import { appUpdates, flushDraftBeforeNavigation } from '../lib/appUpdates';
import { commitRestore, createBackup, downloadFile, groupCsv, planRestore, readBackup, type Backup, type RestorePlan } from '../lib/backup';
import { utils } from '../lib/utils';
import { Modal } from './Modal';
import { AppearanceSettings } from './AppearanceSettings';
import { BankShortcutSettings } from './BankShortcutSettings';

export function DataSettings({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const updates = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ backup: Backup; plan: RestorePlan; previous: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const exportFile = async (contents: string, name: string, type: string) => {
    try {
      const file = new File([contents], name, { type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else downloadFile(contents, name, type);
      setMessage('已開啟檔案儲存／分享，請確認檔案已保存');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // Some browsers advertise file sharing but reject it in standalone mode.
      // Keep a regular download available instead of making backups impossible.
      try { downloadFile(contents, name, type); setMessage('分享無法使用，已改用檔案下載，請確認檔案已保存'); }
      catch { setMessage('無法開啟檔案儲存，請改在 Safari 匯出'); }
    }
  };
  const exportBackup = () => {
    if (!flushDraftBeforeNavigation()) { setMessage('草稿尚未保存，請先確認裝置儲存空間'); return; }
    void exportFile(JSON.stringify(createBackup(localStorage), null, 2), '分帳備份-' + utils.todayStr() + '.json', 'application/json');
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setPreview(null); setMessage('');
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('檔案超過 8 MB，請使用較小的備份');
      const backup = readBackup(await file.text());
      setPreview({ backup, plan: planRestore(localStorage, backup), previous: JSON.stringify(createBackup(localStorage).entries) });
    } catch (error) { setMessage(error instanceof Error ? error.message : '無法讀取備份檔'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const restore = () => {
    if (!preview || !flushDraftBeforeNavigation()) return;
    try {
      if (preview.previous !== JSON.stringify(createBackup(localStorage).entries)) {
        setPreview({ backup: preview.backup, plan: planRestore(localStorage, preview.backup), previous: JSON.stringify(createBackup(localStorage).entries) });
        setMessage('預覽後資料已更新，已重新計算，請再次確認還原');
        return;
      }
      commitRestore(localStorage, preview.plan);
      location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '還原未完成，原資料保留'); }
  };
  return <Modal title="資料與 App" onClose={onClose}>
    <AppearanceSettings />
    <section className="mb-6">
      <h3 className="settings-heading">版本與離線</h3>
      <p className="text-xs text-ink-3 break-all mb-3">版本 {updates.version.split('-')[0]} · {updates.offlineReady ? '離線啟動已準備' : '離線啟動尚未準備'}</p>
      <p className="text-xs text-ink-3 leading-relaxed mb-3">首次連網載入後可離線開啟。離線記帳與未完成草稿保留在此裝置；重新連線並開啟 App 後同步。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => appUpdates.check()} disabled={updates.checking}>{updates.checking ? '檢查中…' : '檢查更新'}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => appUpdates.update()}>安全重新載入{updates.available ? '／更新' : ''}</button>
      </div>
      {updates.message && <p role="status" className="text-xs text-ink-2 mt-3">{updates.message}</p>}
    </section>
    <BankShortcutSettings group={group} />
    <section className="border-t border-line pt-4">
      <h3 className="settings-heading">資料備份</h3>
      <p className="text-xs text-ink-3 leading-relaxed mb-3">JSON 包含此裝置保存的群組、帳目、草稿與待同步資料，保留舊版備份相容性；不包含登入憑證與銀行捷徑識別碼。檔案含私人帳目，請妥善保管；新裝置的群主身分仍需管理者驗證。</p>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn btn-primary w-full" onClick={exportBackup}>匯出完整 JSON 備份</button>
        {group && <button type="button" className="btn w-full" onClick={() => exportFile(groupCsv(group), '分帳明細-' + group.code + '-' + utils.todayStr() + '.csv', 'text/csv;charset=utf-8')}>匯出此帳本全部明細 CSV</button>}
        <button type="button" className="btn w-full" onClick={() => input.current?.click()} disabled={busy}>{busy ? '檢查備份中…' : '選擇 JSON 備份還原'}</button>
        <input ref={input} type="file" accept=".json,application/json" className="sr-only" aria-label="選擇分帳 JSON 備份" onChange={event => readFile(event.target.files?.[0])} />
      </div>
    </section>
    {preview && <section className="rounded-2xl border border-line bg-paper-2 p-4 mt-4">
      <div className="text-sm font-medium mb-2">還原預覽</div>
      <p className="text-sm leading-relaxed">新增 {preview.plan.groups} 個群組、{preview.plan.records} 筆紀錄、{preview.plan.drafts} 份草稿；{preview.plan.pending} 筆待同步。{preview.plan.templates > 0 && `另保留 ${preview.plan.templates} 份舊版設定。`}</p>
      <p className="text-xs text-ink-3 leading-relaxed mt-2">保留目前資料，略過 {preview.plan.skipped} 項重複或可能覆蓋現況的資料。雲端若已有不同版本，會要求你處理衝突；不會自動重建已刪除的雲端群組。</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>取消還原</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={restore}>確認合併並重新載入</button>
      </div>
    </section>}
    {message && <p className="form-error" role="status">{message}</p>}
  </Modal>;
}
