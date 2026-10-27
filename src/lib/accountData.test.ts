import assert from 'node:assert/strict';
import test from 'node:test';
import { bankBridgeKey, bankRulesKey, newBankRule } from './bankShortcuts';
import { bankConfig, bookChanges, installSyncedBank, overlayBooks, validateSyncedBank } from './accountData';

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
