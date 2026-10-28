import type { BankDraft, Group, MutationMeta } from '../types';
import { bankExpenseIdentity, parseBankText, readBankRules, type BankEntry, type BankRule } from './bankShortcuts';
import { bankCapture } from './bankCapture';
import { auditEntry, updatedRecord } from './audit';
import { withoutUndefined } from './firebaseData';

export class BankBackgroundError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function taipeiToday(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const value = (name: string) => parts.find(part => part.type === name)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function syncedBackgroundRules(profile: any): BankRule[] {
  if (!profile || profile.version !== 1 || typeof profile.bank?.rules !== 'string') throw new BankBackgroundError('sync_required', '請先在 App 開啟帳本同步並儲存銀行規則', 422);
  try { return readBankRules({ getItem: () => profile.bank.rules, setItem: () => {} }).filter(rule => rule.enabled); }
  catch { throw new BankBackgroundError('rules_invalid', '銀行規則無法讀取，請回 App 檢查設定', 422); }
}
export function matchBackgroundRule(rules: BankRule[], text: string, now: number): { rule: BankRule; entry: BankEntry } | null {
  const matches = rules.flatMap(rule => {
    try { return [{ rule, entry: parseBankText(text, rule, taipeiToday(now)) }]; } catch { return []; }
  });
  if (matches.length > 1) throw new BankBackgroundError('rules_overlap', '通知符合多個銀行規則，請回 App 調整重疊的設定', 422);
  return matches[0] || null;
}
export function personalBackgroundOwner(raw: any, uid: string): string | null {
  const name = raw?.security?.users?.[uid]?.name;
  const members = Array.isArray(raw?.members) ? raw.members : Object.keys(raw?.members || {});
  if (typeof name !== 'string' || raw?.kind !== 'personal' || raw.security?.version !== 1 || raw.security.ownerUid !== uid) return null;
  return raw.security.users[uid].role === 'owner' && Object.keys(raw.security.users).length === 1
    && raw.security.names?.[name] === uid && Object.keys(raw.security.names).length === 1
    && members.length === 1 && members[0] === name ? name : null;
}

export async function backgroundIdentity(rule: BankRule, text: string) {
  return bankExpenseIdentity(rule, { channel: rule.channel, text });
}
export function applyBackgroundCapture(raw: any, uid: string, matched: { rule: BankRule; entry: BankEntry }, receipt: { id: string; equivalentIds: string[] }, now: number) {
  const owner = personalBackgroundOwner(raw, uid);
  if (!owner || raw.code !== matched.rule.groupCode) throw new BankBackgroundError('ledger_unavailable', '個人帳本不存在或已無權限，請回 App 檢查', 403);
  if (matched.rule.payer !== owner || matched.rule.participants.length !== 1 || matched.rule.participants[0] !== owner) throw new BankBackgroundError('rule_invalid', '銀行規則與個人帳本身分不符，請回 App 檢查', 422);
  // Include tombstones and old browser-created IDs. Never revive a processed
  // receipt, even after the visible audit history has been pruned.
  const known = new Set([...Object.keys(raw.bankInbox || {}), ...Object.keys(raw.expenses || {}), ...Object.values(raw.expenses || {}).map((record: any) => record?.id)]);
  if (receipt.equivalentIds.some(id => known.has(id) || raw.history?.['m' + id])) return { value: raw, duplicate: true };
  const group: Group = { code: raw.code, name: raw.name, kind: 'personal', members: [owner], expenses: [], transfers: [], createdAt: raw.createdAt, security: raw.security };
  const captured = bankCapture(matched.rule, matched.entry, receipt.id, group, false, taipeiToday(now), now);
  const meta: MutationMeta = { id: 'm' + receipt.id, actor: owner, actorUid: uid, at: now, expected: null };
  const draft: BankDraft = updatedRecord({ ...captured.expense, bank: matched.rule.bank, last4: matched.rule.last4 }, undefined, meta);
  const audit = auditEntry('bankDraft.put', receipt.id, undefined, draft, meta);
  const history = Object.fromEntries(Object.values({ ...raw.history, [audit.id]: audit }).sort((a: any, b: any) => b.at - a.at).slice(0, 300).map((entry: any) => [entry.id, entry]));
  return { value: withoutUndefined({ ...raw, bankInbox: { ...raw.bankInbox, [receipt.id]: { ...draft, _lastAudit: audit } }, history }), duplicate: false };
}
