import { bankExpense, bankExpenseId, parseBankText, readBankRules, rememberBankReceipt, type BankRequest, type BankRule, type BankEntry } from './bankShortcuts';
import { ensureDeviceIdentity, fetchGroupOnce } from './firebase';
import { sync } from './sync';
import { storage, utils } from './utils';
import type { Group } from '../types';

export type PreparedBankEntry = { request: BankRequest; rule: BankRule; entry: BankEntry; id: string; group: Group; myName: string; duplicate: boolean; reviewReason: string };
async function availableGroup(code: string) {
  const cached = storage.getGroup(code);
  if (typeof navigator !== 'undefined' && !navigator.onLine && cached) return sync.merge(cached);
  try {
    const cloud = await fetchGroupOnce(code);
    if (!cloud) throw new Error('群組已不存在，未記帳');
    return sync.merge(cloud);
  } catch (error) {
    if (!cached || /permission|權限|不存在|denied/i.test(String(error))) throw error;
    return sync.merge(cached);
  }
}
function localMembership(group: Group, uid: string) {
  const local = storage.getMyGroups().find(item => item.code === group.code);
  if (!local || !group.members.includes(local.myName)) throw new Error('請先在這個瀏覽器加入指定群組，再設定捷徑；主畫面 App 與 Safari 可能有不同裝置身分');
  if (group.security && group.security.users[uid]?.name !== local.myName) throw new Error('這個瀏覽器沒有對應的群組身分，請重新加入群組；不要清除原 App 資料');
  return local.myName;
}
export async function prepareBankEntry(request: BankRequest): Promise<PreparedBankEntry> {
  const rule = readBankRules(localStorage).find(item => item.channel === request.channel && item.enabled);
  if (!rule) throw new Error('找不到有效的銀行捷徑規則。請在捷徑開啟的同一個 Safari 設定規則；不要清除主畫面 App 資料');
  const entry = parseBankText(request.text, rule);
  const [id, uid] = await Promise.all([bankExpenseId(rule, request), ensureDeviceIdentity()]);
  const group = await availableGroup(rule.groupCode);
  const myName = localMembership(group, uid);
  bankExpense(rule, entry, id, group);
  const duplicate = rule.seen.includes(id) || group.expenses.some(item => item.id === id) || !!group.history?.['m' + id];
  const nearDuplicate = group.expenses.some(item => item.amount === entry.amount && item.desc === entry.desc && item.date === entry.date && item.payer === rule.payer && Math.abs(Date.now() - item.createdAt) < 120000);
  const reviewReason = !entry.dateInMessage ? '通知未含消費日期，請核對日期後新增'
    : entry.date !== utils.todayStr() ? '通知不是今天的消費，請核對日期後新增'
    : entry.amount > rule.limit ? '超過自動入帳上限，請確認後新增'
    : nearDuplicate && !duplicate ? '短時間內已有相似費用，請確認是否為另一筆消費' : '';
  return { request, rule, entry, id, group, myName, duplicate, reviewReason };
}
export async function saveBankEntry(prepared: PreparedBankEntry, confirmed = false) {
  const current = await prepareBankEntry(prepared.request);
  if (current.duplicate) return { group: current.group, myName: current.myName, message: '這份通知已處理，未重複新增' };
  const config = (rule: BankRule) => JSON.stringify({ ...rule, seen: [] });
  if (JSON.stringify(current.entry) !== JSON.stringify(prepared.entry) || config(current.rule) !== config(prepared.rule)) throw new Error('規則或日期已更新，請重新開啟捷徑並確認');
  if (!confirmed && (current.rule.mode !== 'auto' || current.reviewReason)) throw new Error(current.reviewReason || '此規則需要確認後新增');
  const expense = bankExpense(current.rule, current.entry, current.id, current.group);
  const uid = await ensureDeviceIdentity();
  sync.enqueue(current.group.code, { type: 'expense.put', expense, meta: { id: 'm' + current.id, actor: current.myName, actorUid: uid, at: Date.now(), expected: null } });
  const merged = sync.merge(current.group);
  let warning = '';
  try { storage.saveGroup(merged.code, merged); rememberBankReceipt(localStorage, current.rule.id, current.id); }
  catch { warning = '紀錄已保存在待同步佇列，但顯示快取或通知防重複設定暫時無法更新。請勿清除網站資料。'; }
  return { group: merged, myName: current.myName, message: sync.getStatus(merged.code).connected ? '已儲存，將自動同步至帳本' : '已離線保存，重新連線後自動同步', warning };
}
