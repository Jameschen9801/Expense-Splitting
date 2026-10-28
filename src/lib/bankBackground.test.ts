import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBackgroundCapture, backgroundIdentity, matchBackgroundRule, taipeiToday } from './bankBackground';
import { newBankRule } from './bankShortcuts';
import { createBackup } from './backup';

const rule = newBankRule({ bank: 'Richart', last4: '0123', groupCode: '123456', payer: 'A', participants: ['A'], category: 'food', mode: 'auto', limit: 1e9 });
const raw = () => ({ kind: 'personal', code: '123456', name: '測試個人帳本', members: { A: true }, createdAt: 1, security: { version: 1, ownerUid: 'owner', users: { owner: { name: 'A', nameKey: 'A', role: 'owner' } }, names: { A: 'owner' } }, expenses: { manual: { id: 'manual', desc: '已入帳', amount: 500 } }, history: {} });
const text = '【信用卡消費通知】您的Richart卡(末四碼0123)刷卡消費約新臺幣58元，實際消費資訊以帳單為準';
test('背景服務跨台灣午夜與跨年仍用台灣日期，通知缺日期才補當天', () => {
  const now = Date.parse('2026-12-31T16:01:00Z');
  assert.equal(taipeiToday(now), '2027-01-01');
  assert.equal(taipeiToday(now - 120000), '2026-12-31');
  assert.equal(matchBackgroundRule([rule], text, now)?.entry.date, '2027-01-01');
  assert.equal(matchBackgroundRule([rule], text.replace('刷卡', '於12/31-19:04刷卡'), now)?.entry.date, '2026-12-31');
});
test('背景通知只進待確認，原有正式帳目與設定完整保留', async () => {
  const matched = matchBackgroundRule([rule], text, Date.now())!;
  const receipt = await backgroundIdentity(rule, text), before = raw();
  const saved = applyBackgroundCapture(before, 'owner', matched, receipt, Date.now()).value;
  assert.deepEqual(saved.expenses, before.expenses);
  assert.deepEqual(saved.security, before.security);
  assert.equal(saved.bankInbox[receipt.id].amount, 58);
  assert.equal(saved.bankInbox[receipt.id].category, 'other');
  assert.equal(saved.bankInbox[receipt.id].desc, '銀行消費（待補說明）');
  assert.equal(saved.history['m' + receipt.id].action, 'bankDraft.put');
  assert.doesNotMatch(JSON.stringify(saved), /實際消費資訊|信用卡消費通知/);
});
test('已確認、已忽略或舊版記過的通知，即使刪掉可見紀錄也不重建', async () => {
  const matched = matchBackgroundRule([rule], text, Date.now())!, receipt = await backgroundIdentity(rule, text);
  for (const field of ['bankInbox', 'expenses']) {
    const before = { ...raw(), [field]: { [receipt.equivalentIds.at(-1)!]: { _deleted: true } } };
    const result = applyBackgroundCapture(before, 'owner', matched, receipt, Date.now());
    assert.equal(result.duplicate, true); assert.equal(result.value, before);
  }
});
test('不使用規則中指定的名字冒用另一個帳本的本人身分', async () => {
  const matched = matchBackgroundRule([rule], text, Date.now())!, receipt = await backgroundIdentity(rule, text);
  assert.throws(() => applyBackgroundCapture(raw(), 'stranger', matched, receipt, Date.now()), /無權限/);
  assert.throws(() => applyBackgroundCapture({ ...raw(), kind: 'shared' }, 'owner', matched, receipt, Date.now()), /無權限/);
});
test('背景綁定憑證不會進一般帳本備份', () => {
  const values = new Map([['warikan_bank_background_v1', JSON.stringify({ uid: 'owner', token: 'a'.repeat(64), createdAt: 1 })]]);
  const store = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, key: (index: number) => [...values.keys()][index] || null, get length() { return values.size; } };
  assert.equal(createBackup(store).entries.warikan_bank_background_v1, undefined);
});
