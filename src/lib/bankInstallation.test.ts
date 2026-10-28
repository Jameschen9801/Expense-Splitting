import test from 'node:test';
import assert from 'node:assert/strict';
import { freshInstallation, installationChecks, installationReceipt, readInstallation, saveInstallation } from './bankInstallation';
import type { BackgroundStatus } from './bankBackgroundClient';
const status = (): BackgroundStatus => ({ eligibleRules: 1, eligibleGroupCodes: ['123456'], activeKeys: 1, currentKeyActive: true, currentKey: { testedAt: 500, lastDelivery: null, lastMatchedDelivery: null }, lastDelivery: { at: 500, status: 'ready', message: '舊裝置已連線' } });
test('舊連線與點開安裝連結不能直接完成，必須有本次綁定後的新測試', () => {
  const saved = freshInstallation(), before = status();
  assert.deepEqual(installationChecks(true, '123456', before, saved), [true, false, false]);
  const attempt = { ...saved, testBaselineAt: 500 };
  assert.deepEqual(installationChecks(true, '123456', before, attempt), [true, false, false]);
  before.currentKey!.testedAt = 501;
  assert.deepEqual(installationChecks(true, '123456', before, attempt), [true, true, false]);
  assert.deepEqual(installationChecks(true, '123456', before, { ...attempt, automationConfirmed: true }), [true, true, true]);
  assert.deepEqual(installationChecks(true, '123456', before, freshInstallation()), [true, false, false]);
});
test('切帳號、其他帳本、停用的憑證或未同步時，不會沿用完成勾選', () => {
  const progress = { ...freshInstallation(), testBaselineAt: 100, automationConfirmed: true };
  assert.deepEqual(installationChecks(false, '123456', status(), progress), [false, false, false]);
  assert.deepEqual(installationChecks(true, '654321', status(), progress), [false, false, false]);
  assert.deepEqual(installationChecks(true, '123456', { ...status(), currentKeyActive: false }, progress), [true, false, false]);
  const memory = new Map<string, string>(), store = { getItem: (key: string) => memory.get(key) || null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  saveInstallation(store, 'owner', '123456', progress);
  assert.deepEqual(readInstallation(store, 'owner', '123456'), progress);
  assert.equal(readInstallation(store, 'girlfriend', '123456').testBaselineAt, null);
  assert.equal(readInstallation(store, 'owner', '654321').automationConfirmed, false);
});
test('損壞或舊範本的進度安全重設，儲存失敗要顯示錯誤', () => {
  for (const value of ['invalid', JSON.stringify({ ...freshInstallation(), revision: 'old' }), JSON.stringify({ ...freshInstallation(), testBaselineAt: '500' })]) assert.deepEqual(readInstallation({ getItem: () => value, setItem() {} }, 'owner', '123456'), freshInstallation());
  assert.throws(() => saveInstallation({ getItem: () => null, setItem() { throw new Error('quota'); } }, 'owner', '123456', freshInstallation()), /無法保存設定進度/);
});
test('只有目前綁定在本次連線後送進選定帳本的有效通知才顯示接收勾選', () => {
  const current = status(), progress = { ...freshInstallation(), testBaselineAt: 100 };
  assert.equal(installationReceipt('123456', current, progress), null);
  current.currentKey!.lastMatchedDelivery = { at: 501, status: 'pending', message: '已收到', groupCode: '123456' };
  assert.equal(installationReceipt('123456', current, progress)?.status, 'pending');
  assert.equal(installationReceipt('654321', current, progress), null);
  assert.equal(installationReceipt('123456', current, freshInstallation()), null);
  assert.equal(installationReceipt('123456', { ...current, currentKeyActive: false }, progress), null);
  current.currentKey!.lastMatchedDelivery.at = 499;
  assert.equal(installationReceipt('123456', current, progress), null);
  current.currentKey!.lastMatchedDelivery = { at: 501, status: 'ignored', message: '略過', groupCode: '123456' };
  assert.equal(installationReceipt('123456', current, progress), null);
});
