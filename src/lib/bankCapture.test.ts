import assert from 'node:assert/strict';
import test from 'node:test';
import type { Group } from '../types';
import { bankCapture } from './bankCapture';
import { newBankRule, type BankEntry } from './bankShortcuts';

const rule = newBankRule({ bank: '測試銀行', last4: '0123', groupCode: '123456', payer: '我', participants: ['我'], category: 'food', mode: 'review', limit: 10000 });
const personal: Group = { kind: 'personal', code: rule.groupCode, name: '日常', createdAt: 1, members: ['我'], expenses: [], transfers: [] };
const entry: BankEntry = { amount: 58, date: '2026-10-26', desc: '銀行刷卡消費', dateInMessage: true };
const now = Date.parse('2026-10-27T10:00:00Z');

test('既有個人帳本的確認模式改為自動先保存，分類留其他及待補說明', () => {
  const captured = bankCapture(rule, entry, 'ebank_one', personal, false, '2026-10-27', now);
  assert.equal(captured.automatic, true);
  assert.equal(captured.reviewReason, '');
  assert.equal(captured.expense.amount, 58);
  assert.equal(captured.expense.date, '2026-10-26');
  assert.equal(captured.expense.category, 'other');
  assert.equal(captured.expense.desc, '銀行消費（待補說明）');
  assert.deepEqual(captured.expense.participants, ['我']);
  assert.equal(rule.category, 'food');
  assert.equal(rule.mode, 'review');
});
test('個人帳本缺日期、較早通知、超過舊上限與相近支出都能先保存', () => {
  const similar = { ...personal, expenses: [{ id: 'old', ...entry, payer: '我', participants: ['我'], splitMode: 'equal' as const, createdAt: now }] };
  for (const sample of [{ ...entry, dateInMessage: false }, { ...entry, amount: 20001 }, entry]) {
    const result = bankCapture(rule, sample, 'different_notification', similar, false, '2026-10-27', now);
    assert.equal(result.automatic, true);
    assert.equal(result.reviewReason, '');
    assert.equal(result.expense.amount, sample.amount);
    assert.equal(result.expense.date, sample.date);
  }
});
test('通知已有店名就保留，直接記為個人全額支出，錯誤分攤仍被拒絕', () => {
  const result = bankCapture(rule, { ...entry, desc: '早餐店' }, 'merchant', personal, false);
  assert.equal(result.expense.desc, '早餐店');
  assert.equal(result.expense.category, 'other');
  assert.throws(() => bankCapture({ ...rule, participants: ['朋友'] }, entry, 'invalid', personal, false));
});
test('共用帳本維持原本確認模式、分類與自動上限，不被個人流程影響', () => {
  const shared = { ...personal, kind: 'shared' as const };
  const dated = { ...entry, date: '2026-10-27' };
  const review = bankCapture(rule, dated, 'shared', shared, false, '2026-10-27', now);
  assert.equal(review.automatic, false);
  assert.equal(review.expense.category, 'food');
  assert.equal(review.expense.desc, entry.desc);
  const automatic = { ...rule, mode: 'auto' as const };
  assert.equal(bankCapture(automatic, dated, 'auto', shared, false, '2026-10-27', now).automatic, true);
  for (const sample of [{ ...dated, dateInMessage: false }, { ...dated, amount: 20001 }, entry]) {
    const result = bankCapture(automatic, sample, 'protected', shared, false, '2026-10-27', now);
    assert.equal(result.automatic, false);
    assert.ok(result.reviewReason);
  }
  const existing = { ...bankCapture(automatic, dated, 'old', shared, false, '2026-10-27', now).expense };
  assert.match(bankCapture(automatic, dated, 'next', { ...shared, expenses: [existing] }, false, '2026-10-27', now).reviewReason, /相似/);
});
