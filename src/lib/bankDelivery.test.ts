import assert from 'node:assert/strict';
import test from 'node:test';
import { bankDeliveryKey, readBankDelivery, saveBankDelivery } from './bankDelivery';

test('接收診斷只保留最後結果，損壞或不可寫的儲存不阻擋記帳', () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readBankDelivery(store), null);
  saveBankDelivery(store, 'error', '通知中的卡號末碼不符合，未記帳', 10);
  saveBankDelivery(store, 'pending', '已保存在待確認', 20);
  assert.deepEqual(readBankDelivery(store), { at: 20, state: 'pending', message: '已保存在待確認' });
  assert.deepEqual([...values.keys()], [bankDeliveryKey]);
  saveBankDelivery(store, 'error', '訊'.repeat(300), 30);
  assert.equal(readBankDelivery(store)?.message.length, 240);
  values.set(bankDeliveryKey, '{broken'); assert.equal(readBankDelivery(store), null);
  values.set(bankDeliveryKey, JSON.stringify({ at: 1, state: 'unknown', message: '' })); assert.equal(readBankDelivery(store), null);
  assert.doesNotThrow(() => saveBankDelivery({ ...store, setItem: () => { throw new Error('quota'); } }, 'received', '已送達'));
});
