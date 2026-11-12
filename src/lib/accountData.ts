import type { Group, MyGroup } from '../types';
import type { PendingChange } from './outbox';
import { bankBridgeKey, bankRulesKey, readBankRules, type BankRule } from './bankShortcuts';

export type SyncedBank = { rules: string; bridge: string; revision: number };
export type AccountProfile = { version: 1; books?: Record<string, MyGroup>; bank: SyncedBank };
export type BookChanges = Record<string, MyGroup | null>;
export const accountBookQueueKey = 'warikan_account_books_pending_v1';

export function needsAccountReconnect(uid: string, books: MyGroup[], cached: Record<string, Group | null>) {
  return books.some(book => cached[book.code]?.security && cached[book.code]?.security?.users?.[uid]?.name !== book.myName);
}

// Cached copies of this account's books are safe to reconnect. Independently
// owned books and pending work from another identity must remain untouched.
export function assertAccountReconnect(input: {
  uid: string; books: MyGroup[]; cached: Record<string, Group | null>;
  profile: AccountProfile; cloud: Record<string, Group | null>; pending: PendingChange[];
  memberships?: { uid?: string; changes?: BookChanges } | null;
}) {
  const { uid, books, cached, profile, cloud, pending, memberships } = input;
  if (!profile || profile.version !== 1) throw new Error('這個帳號尚未設定帳本同步，原本資料仍保留。請確認登入的是原本帳號。');
  validateSyncedBank(profile.bank);
  const ownChanges = memberships?.uid === uid ? memberships.changes : {};
  const registered = overlayBooks(profile.books, ownChanges);
  for (const book of registered) {
    const remote = cloud[book.code];
    if (remote?.security && remote.security.users?.[uid]?.name !== book.myName) throw new Error('帳本身分不一致，已停止登入並保留原資料。');
  }
  for (const book of books) {
    const saved = cached[book.code], remote = cloud[book.code];
    const membership = registered.find(item => item.code === book.code);
    if (!saved || !remote || !membership || membership.myName !== book.myName
      || saved.security && saved.security.users?.[uid]?.name !== book.myName
      || remote.security && remote.security.users?.[uid]?.name !== book.myName) {
      throw new Error('這裡還有不屬於此帳號的帳本，已停止登入並保留原資料。請確認使用原本帳號；不會自動合併或刪除帳本。');
    }
  }
  for (const item of pending) {
    const membership = registered.find(book => book.code === item.groupCode);
    if (!membership || !cloud[item.groupCode] || item.change.meta?.actorUid !== uid || item.change.meta.actor !== membership.myName) {
      throw new Error('待同步內容尚未確認屬於此帳號，已停止登入並保留所有變更與草稿。請先匯出備份，再核對原本帳號。');
    }
  }
  if (memberships?.uid !== uid && Object.keys(memberships?.changes || {}).length) {
    throw new Error('這裡仍有另一個身分的帳本設定待同步，已停止登入並保留原資料。');
  }
}

export function bookChanges(before: MyGroup[], after: MyGroup[]): BookChanges {
  const changes: BookChanges = {};
  for (const book of after) {
    if (JSON.stringify(before.find(item => item.code === book.code)) !== JSON.stringify(book)) changes[book.code] = book;
  }
  for (const book of before) if (!after.some(item => item.code === book.code)) changes[book.code] = null;
  return changes;
}
export function overlayBooks(books: Record<string, MyGroup> = {}, changes: BookChanges = {}) {
  const merged = { ...books };
  for (const [code, book] of Object.entries(changes)) { if (book) merged[code] = book; else delete merged[code]; }
  return Object.values(merged);
}
export function bankConfig(rules: BankRule[]) {
  // Receipt IDs remain local; the cloud expense ID also prevents duplicates.
  return JSON.stringify(rules.map(rule => ({ ...rule, seen: [] })));
}
export function validateSyncedBank(value: unknown): SyncedBank {
  const bank = value as SyncedBank;
  if (!bank || typeof bank.rules !== 'string' || bank.rules.length > 200000 || !/^[a-f0-9]{64}$/.test(bank.bridge)
    || !Number.isSafeInteger(bank.revision) || bank.revision < 1) throw new Error('雲端銀行設定格式錯誤，本機設定保留');
  readBankRules({ getItem: () => bank.rules, setItem: () => {} });
  return bank;
}
export function installSyncedBank(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, value: unknown) {
  const bank = validateSyncedBank(value);
  let previous: BankRule[] = [];
  try { previous = readBankRules(store); } catch { /* A valid private cloud copy can repair a broken local configuration. */ }
  const rules = readBankRules({ getItem: () => bank.rules, setItem: () => {} }).map(rule => ({ ...rule,
    seen: previous.find(item => item.id === rule.id && item.secret === rule.secret)?.seen || [],
  }));
  const oldRules = store.getItem(bankRulesKey), oldBridge = store.getItem(bankBridgeKey);
  try { store.setItem(bankRulesKey, JSON.stringify(rules)); store.setItem(bankBridgeKey, bank.bridge); }
  catch (error) {
    if (oldRules === null) store.removeItem(bankRulesKey); else store.setItem(bankRulesKey, oldRules);
    if (oldBridge === null) store.removeItem(bankBridgeKey); else store.setItem(bankBridgeKey, oldBridge);
    throw error;
  }
  return rules;
}
