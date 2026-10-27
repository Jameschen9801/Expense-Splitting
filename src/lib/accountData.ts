import type { MyGroup } from '../types';
import { bankBridgeKey, bankRulesKey, readBankRules, type BankRule } from './bankShortcuts';

export type SyncedBank = { rules: string; bridge: string; revision: number };
export type AccountProfile = { version: 1; books?: Record<string, MyGroup>; bank: SyncedBank };
export type BookChanges = Record<string, MyGroup | null>;
export const accountBookQueueKey = 'warikan_account_books_pending_v1';

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
