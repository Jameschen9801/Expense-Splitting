import { useEffect, useState } from 'react';
import type { ExpenseCategory, Group } from '../types';
import { categories, categoryLabel, defaultExpenseCategory } from '../lib/categories';
import { bankRulesKey, bankShortcutPrefix, newBankRule, parseBankText, readBankRules, saveBankRules, type BankRule, type BankEntry } from '../lib/bankShortcuts';
import { storage, utils } from '../lib/utils';

export function BankShortcutSettings({ group }: { group: Group | null }) {
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
  const signature = JSON.stringify([bank, last4, sample]);
  useEffect(() => {
    const refresh = () => { try { setRules(readBankRules(localStorage)); } catch (error) { setMessage((error as Error).message); } };
    refresh();
    const changed = (event: StorageEvent) => { if (event.key === bankRulesKey) refresh(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const update = (transform: (rules: BankRule[]) => BankRule[]) => {
    const next = transform(readBankRules(localStorage));
    saveBankRules(localStorage, next); setRules(next); return next;
  };
  const openForm = (rule?: BankRule) => {
    setEditing(rule?.id || ''); setBank(rule?.bank || ''); setLast4(rule?.last4 || '');
    const name = rule?.payer || myName || group?.members[0] || '';
    setPayer(name); setParticipants(rule?.participants || (name ? [name] : []));
    setCategory(rule?.category || defaultExpenseCategory); setMode(rule?.mode || 'review'); setLimit(String(rule?.limit || 10000));
    setSample(''); setTest(null); setConsent(false); setMessage(''); setFormOpen(true);
  };
  const save = () => {
    setMessage('');
    try {
      if (!group) throw new Error('請先開啟要記帳的群組');
      if (mode === 'auto' && (!consent || test?.signature !== signature)) throw new Error('自動入帳前，請先測試通知，並勾選同意直接新增支出');
      let rule = newBankRule({ bank, last4, groupCode: group.code, payer, participants, category, mode, limit: Number(limit) });
      if (!group.members.includes(payer) || participants.some(name => !group.members.includes(name))) throw new Error('請選擇有效的群組成員');
      update(current => {
        const previous = current.find(item => item.id === editing);
        if (editing && (!previous || previous.groupCode !== group.code)) throw new Error('原規則已變動，請重新開啟設定');
        if (previous) rule = { ...rule, id: previous.id, channel: previous.channel, secret: previous.secret, enabled: previous.enabled, seen: previous.seen };
        if (current.some(item => item.id !== editing && item.enabled && item.bank.toLocaleLowerCase() === rule.bank.toLocaleLowerCase() && item.last4 === last4)) throw new Error('這張卡已有啟用的規則，請先停用舊規則，避免重複入帳');
        return previous ? current.map(item => item.id === editing ? rule : item) : [...current, rule];
      });
      setActiveLink(bankShortcutPrefix(rule, location.origin + import.meta.env.BASE_URL));
      setFormOpen(false); setEditing(''); setSample(''); setTest(null);
      setMessage('規則已儲存在這個瀏覽器。下一步把下方連結前綴填入捷徑。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '設定未保存，請確認裝置儲存空間'); }
  };
  const copyLink = async (rule: BankRule) => {
    const link = bankShortcutPrefix(rule, location.origin + import.meta.env.BASE_URL);
    setActiveLink(link);
    try { await navigator.clipboard.writeText(link); setMessage('已複製捷徑連結前綴，請勿公開分享'); }
    catch { setMessage('請長按下方連結前綴複製'); }
  };
  return <section className="settings-section bank-shortcut-settings">
    <h3 className="settings-heading">iOS 銀行捷徑記帳</h3>
    <p className="text-sm text-ink-2 leading-relaxed">設定銀行關鍵字與卡號末四碼，讓捷徑轉入消費文字。預設先確認，也可測試後啟用符合條件自動入帳。</p>
    <div className="rounded-2xl border border-line bg-paper-2 p-3 text-xs text-ink-2 leading-relaxed mt-3">
      <p>這是「捷徑開啟網站後記帳」，不是關閉 App 也持續監聽通知。開啟網站可能需要解鎖手機。</p>
      <p className="mt-2">主畫面 App 與 Safari 可能使用不同儲存與裝置身分。請在捷徑會開啟的同一個 Safari 加入群組、設定規則。不要清除原 App 資料。</p>
      <p className="mt-2">只處理新臺幣成功消費；不直接處理退款、驗證碼、外幣與不明金額。同張卡請只選一個自動化來源。</p>
    </div>
    {group && !formOpen && <button type="button" className="btn btn-primary w-full mt-4" onClick={() => openForm()}>新增銀行規則</button>}
    {group && formOpen ? <div className="bank-rule-form mt-4">
      <p className="text-sm font-medium">記帳群組：{group.name}</p>
      <div><label className="field-label" htmlFor="bank-keyword">銀行關鍵字</label><input id="bank-keyword" value={bank} maxLength={40} placeholder="通知中會出現的銀行名稱" onChange={event => setBank(event.target.value)} autoComplete="off" /></div>
      <div><label className="field-label" htmlFor="bank-last4">卡號末四碼</label><input id="bank-last4" value={last4} maxLength={4} inputMode="numeric" pattern="[0-9]{4}" placeholder="只填末四碼，不填完整卡號" onChange={event => setLast4(event.target.value.normalize('NFKC').replace(/\D/g,''))} autoComplete="off" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="field-label" htmlFor="bank-category">入帳分類</label><select id="bank-category" value={category} onChange={event => setCategory(event.target.value as ExpenseCategory)}>{categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
        <div><label className="field-label" htmlFor="bank-payer">誰先付款</label><select id="bank-payer" value={payer} onChange={event => { setPayer(event.target.value); setParticipants([event.target.value]); }}>{group.members.map(name => <option key={name}>{name}</option>)}</select></div>
      </div>
      <fieldset><legend className="field-label">分攤對象</legend><p className="text-xs text-ink-3 mb-2">預設僅付款人分攤；勾選多人時平均分攤。</p><div className="flex flex-wrap gap-2">{group.members.map(name => <label key={name} className="bank-choice"><input type="checkbox" checked={participants.includes(name)} onChange={event => setParticipants(value => event.target.checked ? [...value,name] : value.filter(item => item !== name))} />{name}</label>)}</div></fieldset>
      <div><label className="field-label" htmlFor="bank-mode">入帳方式</label><select id="bank-mode" value={mode} onChange={event => { setMode(event.target.value as 'review'|'auto'); setConsent(false); }}><option value="review">先確認再新增</option><option value="auto">符合規則後自動新增</option></select></div>
      <div><label className="field-label" htmlFor="bank-limit">自動入帳單筆上限 (NT$)</label><input id="bank-limit" type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} /><p className="text-xs text-ink-3 mt-2">超過上限、缺少當日日期或疑似重複時，改為確認後新增。</p></div>
      <div><label className="field-label" htmlFor="bank-sample">測試通知文字（不會記帳）</label><textarea id="bank-sample" rows={3} maxLength={6000} value={sample} onChange={event => setSample(event.target.value)} placeholder="貼上遮蔽完整卡號後的通知；不要貼驗證碼" /><button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => { try { setTest({ entry: parseBankText(sample, { bank, last4 }), signature }); setMessage('辨識成功，測試不會新增帳目'); } catch (error) { setTest(null); setMessage((error as Error).message); } }}>測試辨識</button></div>
      {test?.signature === signature && <p className="text-sm bg-paper-2 p-3 rounded-xl">{test.entry.desc} · NT$ {utils.fmt(test.entry.amount)} · {test.entry.date}</p>}
      {mode === 'auto' && <label className="bank-choice items-start"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我同意符合這個規則的通知，開啟網站後直接新增支出。這不會代為付款或轉帳。</span></label>}
      <div className="flex gap-2"><button type="button" className="btn" onClick={() => { setFormOpen(false); setEditing(''); setSample(''); setTest(null); }}>取消</button><button type="button" className="btn btn-primary flex-1" onClick={save}>儲存銀行規則</button></div>
    </div> : !group && <p className="text-sm text-ink-3 py-4">請先開啟要記帳的群組，再從「資料與 App」設定規則。</p>}
    <div className="mt-5 space-y-3">{rules.filter(rule => !group || rule.groupCode === group.code).map(rule => <div key={rule.id} className="rounded-2xl border border-line p-3">
      <p className="text-sm font-medium">{rule.bank} · 末四碼 {rule.last4} · {rule.enabled ? '啟用' : '停用'}</p><p className="text-xs text-ink-3 mt-1">{categoryLabel(rule.category)} · {rule.mode === 'auto' ? '自動新增' : '先確認'} · 上限 NT$ {utils.fmt(rule.limit)}</p>
      <div className="flex flex-wrap gap-2 mt-3"><button type="button" className="btn btn-sm" onClick={() => copyLink(rule)}>複製捷徑連結</button>{group && <button type="button" className="btn btn-sm" onClick={() => openForm(rule)}>編輯規則</button>}<button type="button" className="btn btn-sm" onClick={() => { try { update(items => { const next = items.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item); if (!rule.enabled && next.some(item => item.id !== rule.id && item.enabled && item.bank.toLocaleLowerCase() === rule.bank.toLocaleLowerCase() && item.last4 === rule.last4)) throw new Error('同張卡已有啟用規則，請先停用另一個規則'); return next; }); setMessage('規則狀態已更新'); } catch (error) { setMessage((error as Error).message); } }}>{rule.enabled ? '停用' : '啟用'}</button><button type="button" className="btn btn-danger btn-sm" onClick={() => { try { update(items => items.filter(item => item.id !== rule.id)); setActiveLink(''); if (editing === rule.id) setFormOpen(false); setMessage('規則已移除，舊捷徑連結已失效；既有帳目不變'); } catch (error) { setMessage((error as Error).message); } }}>移除規則</button></div>
    </div>)}</div>
    {activeLink && <div className="mt-4"><label className="field-label" htmlFor="bank-shortcut-link">捷徑連結前綴（請勿分享）</label><textarea id="bank-shortcut-link" readOnly value={activeLink} rows={3} className="text-xs" /></div>}
    <a className="btn w-full mt-4" href={import.meta.env.BASE_URL + 'shortcuts/銀行通知記帳.shortcut'} target="_blank" rel="noreferrer">下載銀行通知捷徑</a>
    <p className="text-xs text-ink-3 mt-2">需連網下載。安裝時貼上你的捷徑連結前綴；下載檔本身不含任何帳目或私人設定。</p>
    <details className="expense-more mt-5"><summary>設定 iOS 捷徑</summary><ol className="text-sm leading-relaxed space-y-3 pl-5 list-decimal py-3">
      <li>先儲存銀行規則、複製連結，再用 Safari 下載並加入「銀行通知記帳」捷徑，依安裝問題貼上連結前綴。</li>
      <li>在 iOS 27「捷徑 → 自動化」新增「通知」，選銀行 App、篩選消費通知。把通知的標題、副標題、訊息合併成文字，需包含銀行名稱、卡號末四碼與新臺幣金額。</li>
      <li>加入「執行捷徑」，選「銀行通知記帳」，將合併後的文字傳給它。捷徑會編碼文字並開啟網站；請依系統提供的選項設定執行方式，鎖屏時可能需要解鎖。</li>
      <li>先以「先確認再新增」試跑，核對群組、付款人、分攤、日期和金額。啟用自動新增前需完成測試與同意設定。</li>
    </ol><p className="text-xs text-ink-3 leading-relaxed pb-3">規則僅存此瀏覽器，不包含在一般備份；原始通知不保存或上傳。完全相同通知會去重；若確為另一筆相同交易，請手動新增。</p><a className="text-sm underline" href="https://support.apple.com/en-ng/guide/shortcuts/apd932ff833f/10.0/ios/27" target="_blank" rel="noreferrer">Apple iOS 27 通知自動化說明</a></details>
    {message && <p role="status" className="text-sm mt-4 whitespace-pre-line">{message}</p>}
  </section>;
}
