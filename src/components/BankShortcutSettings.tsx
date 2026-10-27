import { useEffect, useRef, useState } from 'react';
import type { ExpenseCategory, Group } from '../types';
import { categories, categoryLabel, defaultExpenseCategory } from '../lib/categories';
import { bankRulesKey, bankNotificationShortcutName, bankNotificationShortcutInstallUrl, bankShortcutPrefix, bankShortcutSetupUrl, cardSuffixLabel, newBankRule, parseBankText, readBankRules, type BankRule, type BankEntry } from '../lib/bankShortcuts';
import { storage, utils } from '../lib/utils';
import { isPersonalLedger } from '../lib/ledgers';
import { accountSync } from '../lib/accountSync';
import { bankConfig } from '../lib/accountData';
import { AccountSyncSettings } from './AccountSyncSettings';
import { BankDeliveryStatus } from './BankDeliveryStatus';

export function BankShortcutSettings({ group }: { group: Group | null }) {
  const personal = isPersonalLedger(group);
  const myName = group && storage.getMyGroups().find(item => item.code === group.code)?.myName;
  const [rules, setRules] = useState<BankRule[]>([]);
  const [bank, setBank] = useState('');
  const [last4, setLast4] = useState('');
  const [payer, setPayer] = useState(myName || group?.members[0] || '');
  const [participants, setParticipants] = useState<string[]>(payer ? [payer] : []);
  const [category, setCategory] = useState<ExpenseCategory>(defaultExpenseCategory);
  const [mode, setMode] = useState<'review'|'auto'>('review');
  const [limit, setLimit] = useState('10000');
  const [consent, setConsent] = useState(false);
  const [sample, setSample] = useState('');
  const [test, setTest] = useState<{ entry: BankEntry; signature: string } | null>(null);
  const [message, setMessage] = useState('');
  const [activeLink, setActiveLink] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState('');
  const [updating, setUpdating] = useState(false);
  const updateLock = useRef(false);
  const editingConfig = useRef('');
  const signature = JSON.stringify([bank, last4, sample]);
  useEffect(() => {
    const refresh = () => { try { setRules(readBankRules(localStorage)); } catch (error) { setMessage((error as Error).message); } };
    refresh();
    if (group) {
      try { setFormOpen(!readBankRules(localStorage).some(rule => rule.groupCode === group.code)); }
      catch { /* The refresh above reports unreadable settings. */ }
    }
    const changed = (event: StorageEvent) => { if (event.key === bankRulesKey) refresh(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const update = async (transform: (rules: BankRule[]) => BankRule[]) => {
    if (updateLock.current) throw new Error('正在儲存，請稍候');
    updateLock.current = true; setUpdating(true);
    try {
      const previous = readBankRules(localStorage);
      const next = transform(previous);
      await accountSync.saveRules(next, previous); setRules(next); return next;
    } finally { updateLock.current = false; setUpdating(false); }
  };
  const openForm = (rule?: BankRule) => {
    editingConfig.current = rule ? bankConfig([rule]) : '';
    setEditing(rule?.id || ''); setBank(rule?.bank || ''); setLast4(rule?.last4.length === 4 ? rule.last4 : '');
    const name = rule?.payer || myName || group?.members[0] || '';
    setPayer(name); setParticipants(rule?.participants || (name ? [name] : []));
    setCategory(personal ? 'other' : rule?.category || defaultExpenseCategory); setMode(personal ? 'auto' : rule?.mode || 'review'); setLimit(String(rule?.limit || 10000));
    setSample(''); setTest(null); setConsent(false); setMessage(''); setFormOpen(true);
  };
  const save = async () => {
    setMessage('');
    try {
      if (!group) throw new Error('請先開啟要記帳的帳本');
      if (!personal && mode === 'auto' && (!consent || test?.signature !== signature)) throw new Error('自動入帳前，請先測試通知，並勾選同意直接新增支出');
      let rule = newBankRule({ bank, last4, groupCode: group.code, payer, participants, category: personal ? 'other' : category, mode: personal ? 'auto' : mode, limit: personal ? 1e9 : Number(limit) });
      if (!group.members.includes(payer) || participants.some(name => !group.members.includes(name))) throw new Error('請選擇有效的群組成員');
      await update(current => {
        const previous = current.find(item => item.id === editing);
        if (editing && (!previous || previous.groupCode !== group.code)) throw new Error('原規則已變動，請重新開啟設定');
        if (previous && bankConfig([previous]) !== editingConfig.current) throw new Error('另一邊已修改這張卡的規則。你的輸入尚未覆蓋新設定，請重新開啟編輯後確認。');
        if (previous) rule = { ...rule, id: previous.id, channel: previous.channel, secret: previous.secret, enabled: previous.enabled, seen: previous.seen };
        if (current.some(item => item.id !== editing && item.enabled && item.bank.toLocaleLowerCase() === rule.bank.toLocaleLowerCase() && item.last4 === last4)) throw new Error('這張卡已有啟用的規則，請先停用舊規則，避免重複入帳');
        return previous ? current.map(item => item.id === editing ? rule : item) : [...current, rule];
      });
      setActiveLink(bankShortcutPrefix(rule, location.origin + import.meta.env.BASE_URL));
      setFormOpen(false); setEditing(''); setSample(''); setTest(null);
      setMessage(personal ? '銀行規則已儲存。捷徑傳入有效消費後會自動放入待確認，補好說明與分類後才加入帳本；已綁定的捷徑可繼續使用。' : '銀行規則已儲存。接著加入新版捷徑，再按「完成綁定」，設定會自動帶入，不用重填銀行與卡號。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '設定未保存，請確認裝置儲存空間'); }
  };
  const copyLink = async (rule: BankRule) => {
    const link = bankShortcutPrefix(rule, location.origin + import.meta.env.BASE_URL);
    setActiveLink(link);
    try { await navigator.clipboard.writeText(link); setMessage('已複製捷徑連結前綴，請勿公開分享'); }
    catch { setMessage('請長按下方連結前綴複製'); }
  };
  const openAutomationGuide = () => {
    const heading = document.getElementById('bank-automation-heading');
    const content = heading?.closest<HTMLElement>('.modal-content');
    if (heading && content) {
      content.scrollTo({ top: content.scrollTop + heading.getBoundingClientRect().top - content.getBoundingClientRect().top - 20 });
      heading.focus({ preventScroll: true });
    }
  };
  const bindShortcut = async () => {
    try {
      if (accountSync.getSnapshot().email) await accountSync.refresh();
      if (!group || !readBankRules(localStorage).some(rule => rule.enabled && rule.groupCode === group.code)) throw new Error('請先儲存並啟用這個帳本的銀行規則');
      const url = bankShortcutSetupUrl(localStorage, location.origin + import.meta.env.BASE_URL);
      setMessage('即將把銀行設定傳給「銀行通知記帳」。儲存後，請繼續第 3 步設定通知自動化，收到銀行通知時才會觸發。');
      location.assign(url);
    } catch (error) { setMessage(error instanceof Error ? error.message : '設定尚未傳出，請稍後重試'); }
  };
  return <section className="settings-section bank-shortcut-settings">
    <h3 className="settings-heading">iOS 銀行捷徑記帳</h3>
    <p className="text-sm text-ink-2 leading-relaxed">{personal ? '填好銀行與卡號末 4 碼，捷徑收到有效消費後先放入待確認，補好說明與分類後再確認入帳。' : '在 App 填好銀行、卡號末 4 碼與記帳帳本，再加入捷徑，不用到捷徑裡重填。'}</p>
    <button type="button" className="btn w-full mt-4" onClick={openAutomationGuide}>設定通知自動化</button>
    <div className="mt-4"><AccountSyncSettings compact /></div>
    <BankDeliveryStatus />
    <p className="text-xs text-ink-3 leading-relaxed mt-3">目前仍須開啟 Safari 才會保存通知，鎖定手機時可能需要解鎖。加入捷徑後，也須在 iOS 設定通知自動化；網站無法代替手機啟用它。</p>
    <details className="expense-more mt-3"><summary>使用前須知</summary><div className="text-xs text-ink-2 leading-relaxed py-3">
      <p>這是「捷徑開啟網站後記帳」，不是關閉 App 也持續監聽通知。開啟網站可能需要解鎖手機。</p>
      <p className="mt-2">捷徑通常會開啟 Safari。先在原本記帳的桌面 App 開啟「帳本同步」，再在 Safari 登入同一帳號，就能使用同一本帳本與銀行規則，不需要另建帳本。</p>
      <p className="mt-2">只處理新臺幣成功消費；不直接處理退款、驗證碼、外幣與不明金額。同張卡請只選一個自動化來源。</p>
    </div></details>
    {group && <p className="bank-setup-target mt-4">記帳帳本：<strong>{group.name}</strong><span>{personal ? '個人帳本 · 全額記為自己的支出' : '共用帳本 · 依規則分攤'}</span></p>}
    {personal && <div className="rounded-2xl border border-line bg-paper-2 p-4 mt-4 text-sm leading-relaxed"><strong>通知先收好，確認後入帳</strong><p className="text-ink-2 mt-2">金額與日期自動保存在「手機通知待確認」，不計入支出、分類統計或 CSV。補好說明並選擇分類，按「確認加入帳本」才成為正式帳目。</p><p className="text-xs text-ink-3 mt-2">通知沒有日期時，使用執行捷徑當天；重複通知不再新增。請先只接銀行通知，避免 LINE 錢包重複入帳。</p></div>}
    <h4 className="text-sm font-medium mt-5">1. 設定銀行與卡片</h4>
    {group && !formOpen && <button type="button" className="btn btn-primary w-full mt-4" onClick={() => openForm()}>新增銀行規則</button>}
    {group && formOpen ? <fieldset disabled={updating} className="bank-rule-form mt-4">
      <div><label className="field-label" htmlFor="bank-keyword">銀行關鍵字</label><input type="text" id="bank-keyword" value={bank} maxLength={40} placeholder="例如 Richart、台新、國泰" onChange={event => setBank(event.target.value)} autoComplete="off" /><p className="text-xs text-ink-3 mt-2">依通知文字填寫；台新與 Richart 可互相辨識。</p></div>
      <div><label className="field-label" htmlFor="bank-last4">卡號末 4 碼</label><input type="text" id="bank-last4" value={last4} maxLength={4} inputMode="numeric" pattern="[0-9]{4}" placeholder="例如 0123，不填完整卡號" onChange={event => setLast4(event.target.value.normalize('NFKC').replace(/\D/g,'').slice(0,4))} autoComplete="off" /></div>
      {!personal && <div className="grid grid-cols-2 gap-3">
        <div><label className="field-label" htmlFor="bank-category">入帳分類</label><select id="bank-category" value={category} onChange={event => setCategory(event.target.value as ExpenseCategory)}>{categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        {!personal && <div><label className="field-label" htmlFor="bank-payer">誰先付款</label><select id="bank-payer" value={payer} onChange={event => { setPayer(event.target.value); setParticipants([event.target.value]); }}>{group.members.map(name => <option key={name}>{name}</option>)}</select></div>}
      </div>}
      {!personal && <fieldset><legend className="field-label">分攤對象</legend><p className="text-xs text-ink-3 mb-2">預設僅付款人分攤；勾選多人時平均分攤。</p><div className="flex flex-wrap gap-2">{group.members.map(name => <label key={name} className="bank-choice"><input type="checkbox" checked={participants.includes(name)} onChange={event => setParticipants(value => event.target.checked ? [...value,name] : value.filter(item => item !== name))} />{name}</label>)}</div></fieldset>}
      {!personal && <><div><label className="field-label" htmlFor="bank-mode">入帳方式</label><select id="bank-mode" value={mode} onChange={event => { setMode(event.target.value as 'review'|'auto'); setConsent(false); }}><option value="review">先確認再新增</option><option value="auto">符合規則後自動新增</option></select></div>
      <div><label className="field-label" htmlFor="bank-limit">自動入帳單筆上限 (NT$)</label><input id="bank-limit" type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} /><p className="text-xs text-ink-3 mt-2">超過上限、缺少當日日期或疑似重複時，改為確認後新增。</p></div></>}
      <div><label className="field-label" htmlFor="bank-sample">測試通知文字（不會記帳）</label><textarea id="bank-sample" rows={3} maxLength={6000} value={sample} onChange={event => setSample(event.target.value)} placeholder="貼上遮蔽完整卡號後的通知；不要貼驗證碼" /><button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => { try { setTest({ entry: parseBankText(sample, { bank, last4 }), signature }); setMessage('辨識成功，測試不會新增帳目'); } catch (error) { setTest(null); setMessage((error as Error).message); } }}>測試辨識</button></div>
      {test?.signature === signature && <p className="text-sm bg-paper-2 p-3 rounded-xl">{test.entry.desc} · NT$ {utils.fmt(test.entry.amount)} · {test.entry.date}</p>}
      {!personal && mode === 'auto' && <label className="bank-choice items-start"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我同意符合這個規則的通知，開啟網站後直接新增支出。這不會代為付款或轉帳。</span></label>}
      <div className="flex gap-2"><button type="button" className="btn" onClick={() => { setFormOpen(false); setEditing(''); setSample(''); setTest(null); }}>取消</button><button type="button" className="btn btn-primary flex-1" onClick={save}>儲存銀行規則</button></div>
    </fieldset> : !group && <p className="text-sm text-ink-3 py-4">請先開啟要記帳的個人帳本，再從「資料與 App」設定銀行規則。</p>}
    <div className="mt-5 space-y-3">{rules.filter(rule => !group || rule.groupCode === group.code).map(rule => <div key={rule.id} className="rounded-2xl border border-line p-3">
      <p className="text-sm font-medium">{rule.bank} · {cardSuffixLabel(rule.last4)} {rule.last4} · {rule.enabled ? '啟用' : '停用'}</p><p className="text-xs text-ink-3 mt-1">{isPersonalLedger(group || storage.getGroup(rule.groupCode)) ? '自動收進待確認 · 填寫資料後入帳' : `${categoryLabel(rule.category)} · ${rule.mode === 'auto' ? '自動新增' : '先確認'} · 上限 NT$ ${utils.fmt(rule.limit)}`}</p>
      {rule.last4.length !== 4 && <p className="form-error mt-2">舊規則已停用，請編輯並改填卡號末 4 碼。</p>}
      <div className="flex flex-wrap gap-2 mt-3">{group && <button type="button" className="btn btn-sm" onClick={() => openForm(rule)}>編輯規則</button>}<button type="button" className="btn btn-sm" disabled={updating || rule.last4.length !== 4} onClick={async () => { try { await update(items => { const next = items.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item); if (!rule.enabled && next.some(item => item.id !== rule.id && item.enabled && item.bank.toLocaleLowerCase() === rule.bank.toLocaleLowerCase() && item.last4 === rule.last4)) throw new Error('同張卡已有啟用規則，請先停用另一個規則'); return next; }); setMessage('規則狀態已更新'); } catch (error) { setMessage((error as Error).message); } }}>{rule.enabled ? '停用' : '啟用'}</button><button type="button" className="btn btn-danger btn-sm" disabled={updating} onClick={async () => { try { await update(items => items.filter(item => item.id !== rule.id)); setActiveLink(''); if (editing === rule.id) setFormOpen(false); setMessage('規則已移除，舊捷徑連結已失效；既有帳目不變'); } catch (error) { setMessage((error as Error).message); } }}>移除規則</button></div>
    </div>)}</div>
    <h4 className="text-sm font-medium mt-6">2. 加入並綁定捷徑</h4>
    <p className="text-sm text-ink-2 leading-relaxed mt-2">先到 Apple 頁面確認加入新版，回到這裡按「完成綁定」，App 會自動傳入設定。只需填寫一次，不用複製連結或編輯捷徑動作。</p>
    <a className="btn btn-primary w-full mt-4" href="https://www.icloud.com/shortcuts/1e2ff51948f94e508a80098f7367b2f7" target="_blank" rel="noopener noreferrer">加入銀行通知捷徑</a>
    <button type="button" className="btn w-full mt-3" disabled={!group || !rules.some(rule => rule.enabled && rule.groupCode === group.code)} onClick={bindShortcut}>已加入，完成綁定</button>
    <p className="text-xs text-ink-3 mt-2 leading-relaxed">捷徑會保存此 App 的記帳連結。之後新增卡片、修改分類或入帳方式，直接在 App 儲存即可。同一個捷徑會依銀行與卡號末碼選擇帳本。</p>
    <p className="text-sm font-medium mt-3">完成綁定後，還要設定下方第 3 步，才能由銀行通知觸發。</p>
    <details className="expense-more mt-4"><summary>無法開啟安裝頁面？</summary>
      <p className="text-sm leading-relaxed py-3">請用 Safari 開啟安裝頁。也可下載 ZIP 備用檔，在「檔案 → 下載項目」點 ZIP 解壓，再點「銀行通知記帳.shortcut」加入捷徑。</p>
      <a className="btn w-full mb-3" href={import.meta.env.BASE_URL + 'shortcuts/bank-notification-shortcut.zip'} download="銀行通知記帳.zip">下載 ZIP 備用檔</a>
      <p className="text-xs text-ink-3 leading-relaxed pb-3">如果看到 AEA1 或大量亂碼，表示瀏覽器正在預覽捷徑原始檔。請返回此頁，改按上方安裝按鈕或使用 ZIP 備用檔。</p>
    </details>
    <section className="rounded-2xl border border-line bg-paper-2 p-4 mt-5" aria-labelledby="bank-automation-heading">
      <p className="text-xs text-ink-3 mb-2">首次需在 iPhone 完成</p>
      <h4 id="bank-automation-heading" tabIndex={-1} className="text-base font-medium">3. 加入 Richart 通知自動化</h4>
      <p className="text-sm text-ink-2 leading-relaxed mt-3">第二支捷徑已帶入「收到 Richart 通知」的觸發條件，也已接好銀行記帳。先完成上方綁定，再加入這支範本，不用從空白自動化重新設定。</p>
      <p className="text-sm font-medium mt-3">已預設：Richart → 銀行通知記帳</p>
      <a className="btn btn-primary w-full mt-4" href={bankNotificationShortcutInstallUrl} target="_blank" rel="noopener noreferrer">加入 Richart 通知自動化</a>
      <a className="btn w-full mt-3" href={'shortcuts://open-shortcut?name=' + encodeURIComponent(bankNotificationShortcutName)}>已加入，開啟啟用設定</a>
      <p className="text-xs text-ink-3 leading-relaxed mt-2">需要 iOS 27。匯入後仍要在這支 iPhone 開啟「自動化」，點安裝按鈕不代表已啟用。</p>
      <ol className="text-sm leading-relaxed space-y-3 pl-5 list-decimal mt-4">
        <li>按「加入 Richart 通知自動化」，到 Apple 頁面確認加入捷徑。</li>
        <li>回來按「已加入，開啟啟用設定」，在「Richart 通知自動化」按「編輯」。</li>
        <li>通知條件與 Richart 已填好。在觸發條件旁的展開選單，開啟「自動化」並儲存。Richart Life 不用另外設定。</li>
        <li>需要鎖定時執行，可在捷徑「編輯 → 資訊 → 隱私」檢查「允許鎖定時執行」。目前保存仍可能開啟 Safari，鎖定時仍需實機驗證。</li>
      </ol>
      <p className="text-sm leading-relaxed mt-4">設定後，請用下一次實際通知確認觸發。回到 Safari 查看上方「最近一次捷徑接收」，有新的接收時間才表示通知已送進網站。</p>
      <p className="text-xs text-ink-3 leading-relaxed mt-2">範本只將 Richart 通知內文傳給「銀行通知記帳」，由你已儲存的銀行與末 4 碼規則檢查。相同消費重送會略過。App 無法讀取手機上的啟用狀態，請以實際接收結果確認。</p>
      <details className="expense-more mt-3"><summary>安裝頁無法開啟？</summary><p className="text-xs text-ink-3 leading-relaxed py-3">可下載 ZIP 備用檔，在「檔案」解壓後開啟「Richart 通知自動化.shortcut」。加入後仍需依上方步驟開啟自動化。</p><a className="btn w-full mb-3" href={import.meta.env.BASE_URL + 'shortcuts/richart-notification-source.zip'} download="Richart 通知自動化.zip">下載通知來源 ZIP</a></details>
      <a className="inline-block text-sm underline mt-3" href="https://support.apple.com/en-ng/guide/shortcuts/apdfbdbd7123/ios" target="_blank" rel="noreferrer">Apple 自動化設定說明</a>
    </section>
    <details className="expense-more mt-4"><summary>通知入帳與資料保存方式</summary><p className="text-sm leading-relaxed py-3">{personal ? '個人帳本收到有效消費後先保存在待確認區；可稍後一次處理，補好說明與分類再確認加入帳本。可先用「測試辨識」核對通知格式，測試不會記帳。' : '先以「先確認再新增」試跑，核對帳本、日期和金額。啟用自動新增前需完成測試與同意設定。'}</p><p className="text-xs text-ink-3 leading-relaxed pb-3">開啟帳本同步後，銀行規則保存在自己的私人同步空間；未開啟時僅存在此瀏覽器。原始通知不保存或上傳。完全相同通知會去重；若確為另一筆相同交易，請手動新增。</p></details>
    {group && rules.some(rule => rule.groupCode === group.code) && <details className="expense-more mt-4"><summary>舊版捷徑手動設定</summary><p className="text-xs text-ink-3 py-3">僅供尚未更新的舊捷徑使用。新版請使用上方「完成綁定」。</p><div className="flex flex-wrap gap-2">{rules.filter(rule => rule.groupCode === group.code).map(rule => <button key={rule.id} type="button" className="btn btn-sm" onClick={() => copyLink(rule)}>{rule.bank} · {rule.last4} 連結</button>)}</div>{activeLink && <div className="mt-3"><label className="field-label" htmlFor="bank-shortcut-link">捷徑連結前綴（請勿分享）</label><textarea id="bank-shortcut-link" readOnly value={activeLink} rows={3} className="text-xs" /></div>}</details>}
    {message && <p role="status" className="text-sm mt-4 whitespace-pre-line">{message}</p>}
  </section>;
}
