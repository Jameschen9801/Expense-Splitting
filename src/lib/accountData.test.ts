import assert from 'node:assert/strict';
import test from 'node:test';
import { bankBridgeKey, bankRulesKey, newBankRule } from './bankShortcuts';
import { bankConfig, bookChanges, installSyncedBank, overlayBooks, validateSyncedBank } from './accountData';
import { assertAccountReconnect, needsAccountReconnect } from './accountData';
import type { Group } from '../types';

const book = { code: '123456', name: '日常', myName: '我', kind: 'personal' as const };
const rule = () => newBankRule({ bank: '測試銀行', last4: '0123', groupCode: book.code, payer: '我', participants: ['我'], category: 'food', mode: 'review', limit: 10000 });
const memory = () => {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
};
test('同步帳本使用明確增刪變更，舊裝置不會覆蓋另一邊新建帳本', () => {
  const other = { ...book, code: '654321' };
  assert.deepEqual(bookChanges([book], []), { '123456': null });
  assert.deepEqual(overlayBooks({ '123456': book, '654321': other }, bookChanges([book], [{ ...book, name: '新名稱' }])), [{ ...book, name: '新名稱' }, other]);
  assert.deepEqual(overlayBooks({ '123456': book }, { '123456': null }), []);
});
test('同步銀行設定保留私人捷徑橋接與防重複金鑰，通知紀錄只在本機', () => {
  const store = memory(), bankRule = rule(), receipt = 'ebank_' + 'a'.repeat(64);
  store.setItem(bankRulesKey, JSON.stringify([{ ...bankRule, seen: [receipt] }]));
  const bank = { rules: bankConfig([bankRule]), bridge: 'b'.repeat(64), revision: 1 };
  const installed = installSyncedBank(store, bank);
  assert.equal(installed[0].secret, bankRule.secret);
  assert.deepEqual(installed[0].seen, [receipt]);
  assert.equal(store.getItem(bankBridgeKey), bank.bridge);
  assert.equal(bank.rules.includes(receipt), false);
  const fresh = memory();
  assert.deepEqual(installSyncedBank(fresh, bank), [bankRule]);
});
test('損壞或不完整的雲端設定不會清空原銀行規則', () => {
  const store = memory(); store.setItem(bankRulesKey, '["original"]'); store.setItem(bankBridgeKey, 'b'.repeat(64));
  for (const value of [null, { rules: '[]', bridge: 'bad', revision: 1 }, { rules: '[{}]', bridge: 'a'.repeat(64), revision: 1 }, { rules: '[]', bridge: 'a'.repeat(64), revision: 1.5 }]) {
    assert.throws(() => installSyncedBank(store, value));
    assert.equal(store.getItem(bankRulesKey), '["original"]');
    assert.equal(store.getItem(bankBridgeKey), 'b'.repeat(64));
  }
  assert.doesNotThrow(() => validateSyncedBank({ rules: '[]', bridge: 'a'.repeat(64), revision: 2 }));
});

const originalUid = 'original-account';
const original: Group = { code: book.code, kind: 'personal', name: book.name, members: [book.myName], expenses: [], transfers: [], createdAt: 1,
  security: { version: 1, ownerUid: originalUid, users: { [originalUid]: { name: book.myName, nameKey: book.myName, role: 'owner' } }, names: { [book.myName]: originalUid } } };
const reconnect = () => ({ uid: originalUid, books: [book], cached: { [book.code]: original }, cloud: { [book.code]: original }, pending: [],
  profile: { version: 1 as const, books: { [book.code]: book }, bank: { rules: '[]', bridge: 'b'.repeat(64), revision: 1 } } });

test('登入中斷但保有原帳本快取時，可辨認需要重新登入並核對同帳號歸屬', () => {
  const data = reconnect(), before = JSON.stringify(data);
  assert.equal(needsAccountReconnect('temporary-device', data.books, data.cached), true);
  assert.equal(needsAccountReconnect(originalUid, data.books, data.cached), false);
  assert.doesNotThrow(() => assertAccountReconnect(data));
  assert.equal(JSON.stringify(data), before);
});
test('不允許把獨立帳本或同名但不同歸屬的帳本自動併入登入帳號', () => {
  const data = reconnect();
  assert.throws(() => assertAccountReconnect({ ...data, uid: 'other-account' }), /身分不一致|不屬於此帳號/);
  assert.throws(() => assertAccountReconnect({ ...data, cached: { [book.code]: { ...original, security: { ...original.security!, users: {} } } } }), /不屬於此帳號/);
  assert.throws(() => assertAccountReconnect({ ...data, profile: { ...data.profile, books: {} } }), /不屬於此帳號/);
  assert.throws(() => assertAccountReconnect({ ...data, cloud: { [book.code]: null } }), /不屬於此帳號/);
  assert.throws(() => assertAccountReconnect({ ...data, books: [{ ...book, myName: '同名以外的人' }] }), /不屬於此帳號/);
});
test('保留同帳號待同步操作，阻擋其他或未核對身分的操作，不改寫佇列', () => {
  const data = reconnect();
  const pending = [{ id: 'pending-1', groupCode: book.code, change: { type: 'group.rename' as const, name: '新名稱', meta: { id: 'change-1', actor: book.myName, actorUid: originalUid, at: 2 } } }];
  const before = JSON.stringify(pending);
  assert.doesNotThrow(() => assertAccountReconnect({ ...data, pending }));
  assert.equal(JSON.stringify(pending), before);
  for (const actorUid of ['temporary-device', undefined]) {
    assert.throws(() => assertAccountReconnect({ ...data, pending: [{ ...pending[0], change: { ...pending[0].change, meta: { ...pending[0].change.meta, actorUid } } }] }), /待同步內容/);
  }
  assert.throws(() => assertAccountReconnect({ ...data, pending: [{ ...pending[0], groupCode: '654321' }] }), /待同步內容/);
});
test('雲端銀行設定與待同步帳本設定也須先通過核對', () => {
  const data = reconnect();
  assert.throws(() => assertAccountReconnect({ ...data, profile: { ...data.profile, bank: { ...data.profile.bank, bridge: 'invalid' } } }), /銀行設定格式錯誤/);
  assert.throws(() => assertAccountReconnect({ ...data, memberships: { uid: 'other', changes: { '654321': null } } }), /另一個身分/);
  assert.doesNotThrow(() => assertAccountReconnect({ ...data, memberships: { uid: originalUid, changes: {} } }));
});
