import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense, Group } from '../types';
import { Outbox, applyChange, overlayPending } from './outbox';
import { createSyncEngine } from './sync';
import { Drafts, type RecordDraft } from './drafts';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const group: Group = { code: '123456', name: '測試', members: ['A', 'B'], expenses: [], transfers: [], createdAt: 1 };
const expense: Expense = { id: 'e1', desc: '晚餐', amount: 100, payer: 'A', participants: ['A', 'B'], splitMode: 'equal', date: '2026-10-02', createdAt: 2 };

test('重開 App 後離線新增、編輯、刪除的順序仍保留，且不混入別的群組', () => {
  const store = memoryStorage();
  const before = new Outbox(store);
  before.enqueue(group.code, { type: 'expense.put', expense });
  before.enqueue(group.code, { type: 'expense.put', expense: { ...expense, amount: 200 } });
  before.enqueue('999999', { type: 'group.rename', name: '別組' });
  const after = new Outbox(store);
  assert.equal(overlayPending(group, after.list()).expenses[0].amount, 200);
  assert.equal(overlayPending(group, after.list()).name, '測試');
  after.enqueue(group.code, { type: 'expense.remove', id: expense.id });
  assert.equal(overlayPending(group, after.list()).expenses.length, 0);
});

test('上傳途中又編輯同一筆，較舊的上傳結果不會蓋掉新內容', async () => {
  const store = memoryStorage();
  let cloud = group;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  const cached: Group[] = [];
  const engine = createSyncEngine({ getStorage: () => store, saveGroup: (_, value) => cached.push(value), send: async (_, change) => {
    if (++count === 1) await gate;
    cloud = applyChange(cloud, change);
    return cloud;
  } });
  engine.enqueue(group.code, { type: 'expense.put', expense });
  engine.setConnected(true);
  engine.enqueue(group.code, { type: 'expense.put', expense: { ...expense, amount: 250 } });
  const running = engine.flush(group.code);
  release();
  assert.equal(await running, true);
  assert.equal(count, 2);
  assert.equal(cached[0].expenses[0].amount, 250);
  assert.equal(cloud.expenses[0].amount, 250);
  assert.equal(engine.getStatus(group.code).pending, 0);
});

test('伺服器已收到但回覆失敗時，重開後重試仍只產生一筆費用', async () => {
  const store = memoryStorage();
  let cloud = group;
  const first = createSyncEngine({ getStorage: () => store, saveGroup: () => {}, send: async (_, change) => {
    cloud = applyChange(cloud, change);
    throw new Error('回覆中斷');
  } });
  first.enqueue(group.code, { type: 'expense.put', expense });
  first.setConnected(true);
  assert.equal(await first.flush(group.code), false);
  assert.equal(first.getStatus(group.code).pending, 1);
  const reopened = createSyncEngine({ getStorage: () => store, saveGroup: () => {}, send: async (_, change) => {
    cloud = applyChange(cloud, change);
    return cloud;
  } });
  reopened.setConnected(true);
  assert.equal(await reopened.flush(group.code), true);
  assert.equal(cloud.expenses.length, 1);
  assert.equal(reopened.getStatus(group.code).pending, 0);
});

test('離線不送出操作；恢復連線才補傳各群組', async () => {
  const store = memoryStorage();
  const sent: string[] = [];
  const engine = createSyncEngine({ getStorage: () => store, saveGroup: () => {}, send: async (code, change) => {
    sent.push(code);
    return applyChange({ ...group, code }, change);
  } });
  engine.enqueue(group.code, { type: 'expense.put', expense });
  engine.enqueue('999999', { type: 'group.rename', name: '另一組' });
  assert.equal(await engine.flush(group.code), false);
  assert.equal(sent.length, 0);
  engine.setConnected(true);
  await Promise.all([engine.flush(group.code), engine.flush('999999')]);
  assert.deepEqual(sent.sort(), ['123456', '999999']);
});

test('儲存空間不足時，不將操作當成已保存或送到雲端', () => {
  const engine = createSyncEngine({ getStorage: () => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }), saveGroup: () => {}, send: async () => { throw new Error('不應送出'); } });
  assert.throws(() => engine.enqueue(group.code, { type: 'expense.put', expense }), /quota/);
  assert.equal(engine.getStatus(group.code).pending, 0);
});

test('草稿跨重開恢復，依群組及使用者隔離；保存成功後可清除', () => {
  const store = memoryStorage();
  const draft: RecordDraft = { recordType: 'expense', expense: { desc: '晚餐', amount: '123', date: '2026-10-02', payer: 'A', participants: ['A', 'B'], splitMode: 'equal', customShares: {} }, transfer: { from: 'A', to: 'B', amount: '', date: '2026-10-02', note: '' } };
  new Drafts(store).save(group.code, 'A', draft);
  const reopened = new Drafts(store);
  assert.deepEqual(reopened.read(group.code, 'A'), draft);
  assert.equal(reopened.read(group.code, 'B'), null);
  assert.equal(reopened.read('999999', 'A'), null);
  reopened.clear(group.code, 'A');
  assert.equal(reopened.read(group.code, 'A'), null);
});
