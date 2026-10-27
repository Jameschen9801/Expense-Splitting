import { bankExpenseId, resolveBankRule, rememberBankReceipt, type BankRequest, type BankRule, type BankEntry } from './bankShortcuts';
import { ensureDeviceIdentity, fetchGroupOnce } from './firebase';
import { sync } from './sync';
import { storage } from './utils';
import type { Group } from '../types';
import { accountSync } from './accountSync';
import { bankCapture } from './bankCapture';

export type PreparedBankEntry = { request: BankRequest; rule: BankRule; entry: BankEntry; id: string; group: Group; myName: string; duplicate: boolean } & ReturnType<typeof bankCapture>;
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
  if (typeof navigator === 'undefined' || navigator.onLine) {
    await accountSync.start();
    if (accountSync.getSnapshot().email) await accountSync.refresh();
  }
  const {rule,entry} = resolveBankRule(localStorage, request);
  const [id, uid] = await Promise.all([bankExpenseId(rule, request), ensureDeviceIdentity()]);
  const group = await availableGroup(rule.groupCode);
  const myName = localMembership(group, uid);
  const duplicate = rule.seen.includes(id) || group.expenses.some(item => item.id === id) || group.bankReceiptIds?.includes(id) || (group.bankInbox || []).some(item => item.id === id) || !!group.history?.['m' + id];
  return { request, rule, entry, id, group, myName, duplicate, ...bankCapture(rule, entry, id, group, duplicate) };
}
export async function saveBankEntry(prepared: PreparedBankEntry, confirmed = false) {
  const current = await prepareBankEntry(prepared.request);
  if (current.duplicate) return { group: current.group, myName: current.myName, message: '這份通知已處理，未重複新增' };
  const config = (rule: BankRule) => JSON.stringify({ ...rule, seen: [] });
  if (JSON.stringify(current.entry) !== JSON.stringify(prepared.entry) || config(current.rule) !== config(prepared.rule)) throw new Error('規則或日期已更新，請重新開啟捷徑並確認');
  if (!confirmed && !current.automatic) throw new Error(current.reviewReason || '此規則需要確認後新增');
  const expense = current.expense;
  const uid = await ensureDeviceIdentity();
  const change = current.captureFirst ? { type: 'bankDraft.put' as const, draft: { ...expense, bank: current.rule.bank, last4: current.rule.last4 } } : { type: 'expense.put' as const, expense };
  sync.enqueue(current.group.code, { ...change, meta: { id: 'm' + current.id, actor: current.myName, actorUid: uid, at: Date.now(), expected: null } });
  const merged = sync.merge(current.group);
  let warning = '';
  try { storage.saveGroup(merged.code, merged); rememberBankReceipt(localStorage, current.rule.id, current.id); }
  catch { warning = '紀錄已保存在待同步佇列，但顯示快取或通知防重複設定暫時無法更新。請勿清除網站資料。'; }
  const message = sync.getStatus(merged.code).connected ? '已保存，正在同步至帳本' : '已離線保存，連線後自動同步';
  return { group: merged, myName: current.myName, message: current.captureFirst ? '已放入待確認；補好說明與分類後再加入帳本' + (!sync.getStatus(merged.code).connected ? '，連線後自動同步' : '') : message, warning };
}
