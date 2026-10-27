import type { Expense, ExpenseCategory, Group } from '../types';
import { categories, defaultExpenseCategory } from './categories';
import { utils } from './utils';
import { assertLedgerChange } from './ledgers';

export const bankRulesKey = 'warikan_bank_rules_v1';
export const bankBridgeKey = 'warikan_bank_bridge_v1';
export const bankShortcutName = '銀行通知記帳';
export const bankSetupMarker = 'expense-bank-setup:';
export const cardSuffixLabel = (suffix: string) => `末${suffix.length}碼`;
export type BankRule = {
  id: string; channel: string; secret: string; bank: string; last4: string;
  groupCode: string; payer: string; participants: string[]; category: ExpenseCategory;
  mode: 'review' | 'auto'; limit: number; enabled: boolean; seen: string[];
};
export type BankRequest = { channel: string; text: string; scope?: 'browser' };
export type BankSetup = { needsLink: boolean };
export type BankInput = { request?: BankRequest; setup?: BankSetup; error?: string };
export type BankEntry = { amount: number; desc: string; date: string; dateInMessage: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const norm = (text: string) => text.normalize('NFKC').replace(/\u200b|\u200e|\u200f/g, '').trim();
const key = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validStoredRule = (rule: any): rule is BankRule => rule && key(rule.id) && key(rule.channel) && key(rule.secret)
  && typeof rule.bank === 'string' && norm(rule.bank).length >= 2 && rule.bank.length <= 40
  && typeof rule.last4 === 'string' && /^\d{4,5}$/.test(rule.last4) && typeof rule.groupCode === 'string' && /^\d{6}$/.test(rule.groupCode)
  && typeof rule.payer === 'string' && rule.payer.length > 0 && rule.payer.length <= 100
  && Array.isArray(rule.participants) && rule.participants.length > 0 && rule.participants.length <= 1000
  && rule.participants.every((name: any) => typeof name === 'string' && name.length > 0 && name.length <= 100)
  && new Set(rule.participants).size === rule.participants.length
  && categories.some(category => category.id === rule.category)
  && ['review','auto'].includes(rule.mode) && typeof rule.enabled === 'boolean'
  && Number.isFinite(rule.limit) && rule.limit > 0 && rule.limit <= 1e9
  && Array.isArray(rule.seen) && rule.seen.length <= 500 && rule.seen.every((id: any) => typeof id === 'string' && /^ebank_[a-f0-9]{64}$/.test(id));
const validRule = (rule: any): boolean => validStoredRule(rule) && /^\d{4}$/.test(rule.last4);

export function readBankRules(store: Store): BankRule[] {
  const raw = store.getItem(bankRulesKey);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 30 || !value.every(validStoredRule)) throw new Error();
    // Preserve an old five-digit rule for correction without ever using it to book.
    return value.map(rule => rule.last4.length === 4 ? rule : { ...rule, enabled: false });
  } catch { throw new Error('銀行捷徑設定格式錯誤，請重新設定；未執行自動記帳'); }
}
export function saveBankRules(store: Store, rules: BankRule[]) {
  if (rules.length > 30 || !rules.every(rule => validRule(rule) || (validStoredRule(rule) && !rule.enabled)) || new Set(rules.map(rule => rule.channel)).size !== rules.length) throw new Error('銀行捷徑設定不完整，卡號須為末 4 碼');
  store.setItem(bankRulesKey, JSON.stringify(rules));
}
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2,'0')).join('');
export function newBankRule(input: Pick<BankRule, 'bank' | 'last4' | 'groupCode' | 'payer' | 'participants' | 'category' | 'mode' | 'limit'>): BankRule {
  const rule = { ...input, bank: norm(input.bank), id: randomKey(), channel: randomKey(), secret: randomKey(), enabled: true, seen: [] };
  if (!validRule(rule)) throw new Error('請填寫銀行關鍵字、卡號末 4 碼與記帳對象');
  return rule;
}
export const defaultBankCategory = defaultExpenseCategory;

// This is a URL fragment, not a query parameter: notification text is not sent
// to GitHub Pages. The bootstrap removes it before loading Firebase or the app.
export function bankShortcutPrefix(rule: BankRule, base: string) {
  const url = new URL(base); url.hash = ''; url.search = '';
  return url.href + '#bank-entry?channel=' + rule.channel + '&text=';
}
export function ensureBankBridge(store: Store) {
  let channel = store.getItem(bankBridgeKey);
  if (!key(channel)) { channel = randomKey(); store.setItem(bankBridgeKey, channel); }
  return channel!;
}
export function bankShortcutSetupUrl(store: Store, base: string) {
  const channel = ensureBankBridge(store);
  const url = new URL(base); url.hash = ''; url.search = '';
  const prefix = url.href + '#bank-entry?channel=' + channel + '&scope=browser&text=';
  const setup = new URL('shortcuts://run-shortcut');
  setup.searchParams.set('name', bankShortcutName);
  setup.searchParams.set('input', 'text');
  setup.searchParams.set('text', bankSetupMarker + prefix);
  return setup.href;
}
export function parseBankRequest(hash: string): BankRequest | null {
  if (!hash.startsWith('#bank-entry?')) return null;
  if (hash.length > 24000) throw new Error('捷徑訊息過長，未匯入');
  const params = new URLSearchParams(hash.slice('#bank-entry?'.length));
  const channel = params.get('channel'), text = params.get('text');
  if (!key(channel) || !text || text.length > 6000) throw new Error('捷徑資料不完整，請重新產生連結');
  const scope = params.get('scope');
  if (scope !== null && scope !== 'browser') throw new Error('捷徑資料格式不正確，請從 App 重新綁定');
  return {channel:channel!,text,...(scope === 'browser' ? {scope} : {})};
}
export function takeBankRequest(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState' | 'state'>): BankInput {
  if (!location.hash.startsWith('#bank-entry?')) return {};
  const hash = location.hash;
  try { history.replaceState(history.state, '', location.pathname + location.search); }
  catch { return { error: '無法清除網址中的通知資料，已停止自動記帳；請關閉此頁後重試' }; }
  try {
    if (hash.length > 24000) throw new Error('捷徑訊息過長，未匯入');
    const params = new URLSearchParams(hash.slice('#bank-entry?'.length));
    const channel = params.get('channel'), text = params.get('text');
    if (channel !== 'NOT_CONFIGURED' && !key(channel)) throw new Error('捷徑資料不完整，請重新產生連結');
    if (channel === 'NOT_CONFIGURED' || !text?.trim()) {
      return { setup: { needsLink: channel === 'NOT_CONFIGURED' } };
    }
    return { request: parseBankRequest(hash)! };
  }
  catch (error) { return { error: error instanceof Error ? error.message : '無法讀取捷徑資料' }; }
}

export function resolveBankRule(store: Store, request: BankRequest): { rule: BankRule; entry: BankEntry } {
  const enabled = readBankRules(store).filter(rule => rule.enabled);
  if (request.scope === 'browser') {
    if (!key(store.getItem(bankBridgeKey)) || store.getItem(bankBridgeKey) !== request.channel) throw new Error('這裡尚未連到原本的銀行設定。請先在桌面 App 開啟「帳本同步」，再於此登入同一帳號；已登入時請回原 App 重新完成捷徑綁定');
    const matching = enabled.flatMap(rule => {
      try { return [{rule,entry:parseBankText(request.text,rule)}]; }
      catch { return []; }
    });
    if (matching.length > 1) throw new Error('通知符合多個銀行規則，尚未記帳。請在 App 調整銀行關鍵字，避免規則重疊');
    if (!matching.length) throw new Error('沒有符合的成功消費通知，尚未記帳。請在 App 核對銀行關鍵字與卡號末碼，或使用測試辨識查看原因');
    return matching[0];
  }
  const rule = enabled.find(rule => rule.channel === request.channel);
  if (!rule) throw new Error('找不到有效的銀行規則。請先同步原本的帳號與銀行設定，不需要建立新帳本');
  return {rule,entry:parseBankText(request.text,rule)};
}

function checkedDate(year: number, month: number, day: number) {
  const value = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('消費日期無法辨識，請手動記帳');
  return value;
}
export function parseBankText(text: string, rule: Pick<BankRule,'bank'|'last4'>, today = utils.todayStr()): BankEntry {
  const message = norm(text);
  if (!message || message.length > 6000) throw new Error('請提供銀行消費通知文字');
  if (!message.toLocaleLowerCase().includes(norm(rule.bank).toLocaleLowerCase())) throw new Error('銀行關鍵字不符合，未記帳');
  if (!/^\d{4}$/.test(rule.last4)) throw new Error('請設定卡號末 4 碼');
  const card = new RegExp(`(?:(?:卡號|卡片|信用卡)(?:末四碼|末4碼|末碼)?|尾號|末四碼|末4碼|末碼|ending\\s*(?:in)?)[\\s:：()（）「」【】\\[\\]#＊*xX•●·-]{0,24}(?:為|是)?\\s*${rule.last4}(?!\\d)`, 'i');
  if (!card.test(message)) throw new Error('通知中的卡號末碼不符合，未記帳');
  if (/驗證碼|一次性密碼|動態密碼|\bOTP\b|取消|退款|退貨|失敗|未成功|不成功|未完成|尚未|婉拒|拒絕|預授權|預借現金|繳款|繳費通知|帳單|還款|匯款|轉帳|提款|提領|累計|累積|分期|昨日|昨天|refund|declined|verification|pending/i.test(message)) throw new Error('這不是可直接入帳的成功消費通知，請手動確認');
  if (/(?:USD|US\$|JPY|HKD|CNY|RMB|EUR|GBP|AUD|CAD|SGD|KRW|THB|VND|CHF|NZD|INR|PHP|美元|美金|日圓|日幣|港幣|人民幣|歐元|英鎊|外幣|外匯)/i.test(message)) throw new Error('外幣通知不自動換算，請手動記帳');
  if (!/消費|刷卡|交易|扣款|purchase|spent/i.test(message)) throw new Error('找不到成功消費資訊，未記帳');
  const number = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
  const currency = '(?:NT\\s*\\$|NTD|TWD|新[臺台]幣|[臺台]幣)';
  if (new RegExp(`${currency}\\s*[-−]|[-−]\\s*${currency}|[-−]\\s*${number}\\s*元`, 'i').test(message)) throw new Error('負數金額不自動記為支出');
  const boundary = "(?![\\deE_]|[.,'’]\\d|[ \\t]+\\d)";
  const anchored = new RegExp(`(?:消費(?:金額)?|交易(?:金額)?|刷卡(?:金額)?|扣款(?:金額)?|purchase|spent)[^\\d\\n]{0,16}(?:${currency}\\s*(${number})${boundary}|(${number})\\s*元)`, 'gi');
  const money = new RegExp(`${currency}\\s*(${number})${boundary}`, 'gi');
  const explicitMatches = [...message.matchAll(anchored)];
  const explicit = explicitMatches.map(match => match[1] || match[2]);
  if (explicit.length > 1) throw new Error('通知包含多筆消費金額，未自動記帳');
  const moneyMatches = [...message.matchAll(money)];
  const extra = moneyMatches.filter(match => !explicitMatches.some(item => match.index! >= item.index! && match.index! < item.index! + item[0].length));
  if (explicit.length && extra.some(match => !/(?:餘額|可用額度|剩餘額度)[^\d\n]{0,12}$/.test(message.slice(0,match.index)))) throw new Error('通知包含其他不明金額，請手動記帳');
  const fallback = moneyMatches.map(match => match[1]);
  if (!explicit.length && (fallback.length > 1 || /餘額|可用額度|剩餘額度/.test(message))) throw new Error('無法區分消費金額與餘額，請手動記帳');
  const values = explicit.length ? explicit : fallback;
  const amounts = [...new Set(values.map(value => Number(value.replaceAll(',',''))))];
  if (amounts.length !== 1 || !Number.isFinite(amounts[0]) || amounts[0] <= 0 || amounts[0] > 1e9) throw new Error('消費金額不唯一或無效，未記帳');
  // Never accept a naked date/card/phone number as an amount.
  if (!new RegExp(`${currency}\\s*${number}|${number}\\s*元`, 'i').test(message)) throw new Error('通知缺少新臺幣金額標示，未記帳');
  const fullDate = message.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?/);
  const shortDate = fullDate ? null : message.match(/(?:於|在|\s)(\d{1,2})\/(\d{1,2})(?!\d)/);
  const date = fullDate ? checkedDate(+fullDate[1], +fullDate[2], +fullDate[3])
    : shortDate ? checkedDate(+today.slice(0,4), +shortDate[1], +shortDate[2]) : today;
  const merchant = message.match(/(?:於|在)\s*[「『"]([^」』"\n]{1,60})[」』"]/)
    || message.match(/(?:於|在)\s*([^，,。；;\n]{1,40}?)\s*(?:消費|刷卡|交易)/)
    || message.match(/(?:商店|商家|店家|交易商店|消費店家)[：:]\s*([^，,。；;\n]{1,40})/);
  const desc = merchant && !/\d{1,2}[/:年]/.test(merchant[1]) ? merchant[1].trim().slice(0,30) : '銀行刷卡消費';
  return { amount: utils.fromCents(utils.toCents(amounts[0])), desc, date, dateInMessage: !!(fullDate || shortDate) };
}

export async function bankExpenseId(rule: BankRule, request: BankRequest) {
  const secret = Uint8Array.from(rule.secret.match(/../g)!, value => parseInt(value,16));
  const hmac = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(norm(request.text).replace(/\s+/g,' ')));
  return 'ebank_' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
export function bankExpense(rule: BankRule, entry: BankEntry, id: string, group: Group): Expense {
  if (!group.members.includes(rule.payer) || !rule.participants.length || rule.participants.some(name => !group.members.includes(name))) throw new Error('群組成員已變動，請重新設定捷徑規則');
  const expense: Expense = { id, amount: entry.amount, desc: entry.desc, date: entry.date, category: rule.category,
    payer: rule.payer, participants: [...rule.participants], splitMode: 'equal', shares: [], createdAt: Date.now() };
  assertLedgerChange(group, { type: 'expense.put', expense });
  return expense;
}
export function rememberBankReceipt(store: Store, ruleId: string, id: string) {
  const rules = readBankRules(store);
  saveBankRules(store, rules.map(rule => rule.id === ruleId ? { ...rule, seen: [...new Set([id, ...rule.seen])].slice(0,500) } : rule));
}
