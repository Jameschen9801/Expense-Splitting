import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankDraft } from '../types';
import { addLinePayBank, addLinePayPayment, linePayNotificationPattern, linePaySuggestions, parseLinePayNotification } from './linePay';

const received = Date.parse('2026-11-27T11:41:30+08:00');
const message = 'LINE 錢包\n\n付款完成。\nNT$ 1,234.50\n2026.11.27 11:41 (GMT+0800)\n商店名稱：測試商店';
const payment = parseLinePayNotification(message, received)!;
const draft = (id = 'first', overrides: Partial<BankDraft> = {}): BankDraft => ({
  id, desc: '銀行消費（待補說明）', amount: 1234.50, date: '2026-11-27', createdAt: received,
  bank: 'Richart', last4: '0123', payer: '測試', participants: ['測試'], splitMode: 'equal', ...overrides,
});
const bank = { book: '123456', cents: 123450, date: '2026-11-27', at: received - 6_000 };

test('只從 LINE 錢包付款通知取明確店名、臺幣金額與台灣時間', () => {
  assert.deepEqual(payment, { merchant: '測試商店', cents: 123450, date: '2026-11-27',
    at: Date.parse('2026-11-27T11:41:00+08:00'), receivedAt: received, explicitTime: true });
  assert.equal(parseLinePayNotification(message.replace('商店名稱：', '商店名稱\n'), received)?.merchant, '測試商店');
  assert.equal(parseLinePayNotification(message.replace('2026.11.27 11:41 (GMT+0800)\n', ''), received)?.explicitTime, false);
  assert.equal(parseLinePayNotification(message.replace('先前', '後來').replace('11:41', '11:41:20'), received)?.at, received - 10_000);
  for (const text of [
    '測試聊天\n' + message.split('\n').slice(1).join('\n'), 'LINE 錢包\n付款完成', 'LINE 錢包\n付款完成 NT$ 12 商店名稱',
    message + '\n退款', message + '\n驗證碼 123456', message.replace('2026.11.27', '2026.02.30'),
    message.replace('NT$ 1,234.50', 'USD 1.00'), message.replace('NT$ 1,234.50', 'NT$ -1'),
    message.replace('NT$ 1,234.50', 'NT$ 1e3'), message + '\nNT$ 50',
    message + '\n商家：另一家', message.replace('測試商店', '母親 0912345678'),
  ]) assert.equal(parseLinePayNotification(text, received), null, text);
  assert.doesNotMatch('普通聊天室\nNT$ 1 付款完成 商店名稱：測試', new RegExp(linePayNotificationPattern, 'i'));
});

test('LINE Pay 與 Richart 不論誰先到，都只在同一筆待確認顯示店名', () => {
  for (const index of [
    addLinePayBank(addLinePayPayment(null, 'line', payment), 'first', bank),
    addLinePayPayment(addLinePayBank(null, 'first', bank), 'line', payment),
  ]) {
    assert.deepEqual(linePaySuggestions(index, bank.book, [draft()]), { first: '測試商店' });
    assert.deepEqual(linePaySuggestions(index, '654321', [draft()]), {});
    assert.deepEqual(linePaySuggestions(index, bank.book, [draft('first', { desc: '銀行已有店名' })]), {});
    assert.deepEqual(linePaySuggestions(index, bank.book, [draft('first', { amount: 1 })]), {});
    assert.deepEqual(linePaySuggestions(index, bank.book, []), {});
    assert.equal(addLinePayPayment(index, 'line', { ...payment, receivedAt: received + 1000 }), index);
  }
});

test('清掉店名隱藏字元，已收通知重送也不增加第二個配對', () => {
  assert.deepEqual(parseLinePayNotification(message + '\u2069', received), payment);
  const earlier = { ...payment, merchant: '測試商店\u2069' };
  const index = addLinePayPayment(addLinePayBank(null, 'first', bank), 'old-id', earlier);
  assert.equal(addLinePayPayment(index, 'new-id', payment), index);
  assert.deepEqual(linePaySuggestions(index, bank.book, [draft()]), { first: '測試商店' });
});

test('多筆同額、錯日期和過遠的消費都不套用店名，已處理的競爭紀錄也不會移轉店名', () => {
  const index = addLinePayPayment(addLinePayBank(null, 'first', bank), 'line', payment);
  const ambiguous = addLinePayBank(index, 'second', { ...bank, at: received + 10_000 });
  assert.deepEqual(linePaySuggestions(ambiguous, bank.book, [draft(), draft('second')]), {});
  assert.deepEqual(linePaySuggestions(ambiguous, bank.book, [draft('second')]), {});
  const twoPayments = addLinePayPayment(index, 'newLine', { ...payment, merchant: '其他測試店' });
  assert.deepEqual(linePaySuggestions(twoPayments, bank.book, [draft()]), {});
  for (const other of [
    { ...bank, date: '2026-11-26' },
    { ...bank, at: received - 180_000 },
    { ...bank, at: received + 110_000 }, // Close to arrival, too far from the explicit transaction time.
  ]) assert.deepEqual(linePaySuggestions({ ...index, banks: { first: other } }, bank.book, [draft('first', { date: other.date })]), {});
});
