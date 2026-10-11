import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense, Group } from '../types';
import { applyChange, applyCloudChange } from './outbox';
import { fingerprint, RecordConflictError } from './audit';
import { createSyncEngine } from './sync';
import { summarizeExpenses } from './categories';
import { DraftWriter } from './drafts';
import { readTemplates, saveTemplates } from './templates';
import { commitRestore, createBackup, groupCsv, planRestore, readBackup } from './backup';
import { cloudGroup, normalizeGroup } from './firebase';

function memory() {
  const data = new Map<string, string>();
  return { data, get length() { return data.size; }, key: (index: number) => [...data.keys()][index] || null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const empty: Group = { code: '123456', name: '測試', members: ['A','B','C'], expenses: [], transfers: [], createdAt: 1 };
const expense: Expense = { id: 'e1', desc: '晚餐', amount: 100, payer: 'A', participants: ['A','B','C'], splitMode: 'equal', date: '2026-10-02', createdAt: 2 };
const meta = { id: 'm1', actor: 'A', actorUid: 'uid-A', at: 3, expected: null };
const filled = { ...empty, expenses: [expense] };

test('修改歷史與修訂版號在重試及樂觀覆蓋後不重複增加', () => {
  const change = { type: 'expense.put' as const, expense, meta };
  const cloud = applyCloudChange(empty, change);
  assert.equal(cloud.expenses[0].revision, 1);
  assert.equal(cloud.expenses[0].createdByUid, 'uid-A');
  assert.equal(Object.keys(cloud.history!).length, 1);
  assert.deepEqual(applyCloudChange(cloud, change), cloud);
  assert.deepEqual(applyChange(cloud, change), cloud);
  const updated = applyCloudChange(cloud, { ...change, expense: { ...expense, amount: 200 }, meta: { ...meta, id: 'm2', actor: 'B', actorUid: 'uid-B', expected: fingerprint(cloud.expenses[0]) } });
  assert.equal(updated.expenses[0].revision, 2);
  assert.equal(updated.expenses[0].createdByUid, 'uid-A');
  assert.equal(updated.expenses[0].updatedByUid, 'uid-B');
  assert.ok(updated.history!.m2.changes.some(change => change.label === '金額'));
});
test('Firebase 移除空陣列、舊資料缺少分類時，指紋仍一致', () => {
  assert.equal(fingerprint({ ...expense, shares: [], category: 'other' }), fingerprint(expense));
  assert.notEqual(fingerprint({ ...expense, amount: 101 }), fingerprint(expense));
  assert.equal(fingerprint({ ...expense, type: 'expense' } as Expense), fingerprint(expense));
});
test('帳目先上傳、歷史稍後追加時，監聽回覆不產生額外修訂版', () => {
  const change = { type: 'expense.put' as const, expense, meta };
  const saved = applyCloudChange(empty, change);
  const partial = { ...saved, history: undefined };
  assert.deepEqual(applyChange(partial, change), partial);
  assert.equal(applyChange(partial, change).expenses[0].revision, 1);
  const edit = { type: 'expense.put' as const, expense: { ...expense, amount: 200 }, meta: { ...meta, id: 'm2', expected: fingerprint(partial.expenses[0]) } };
  assert.equal(applyCloudChange(saved, edit).expenses[0].revision, 2);
});
test('新增、編輯及刪除遭遇其他人的更新時，不直接覆盖', () => {
  const conflict = { ...filled, expenses: [{ ...expense, amount: 101 }] };
  assert.throws(() => applyCloudChange(conflict, { type: 'expense.put', expense, meta: { ...meta, expected: fingerprint(expense) } }), RecordConflictError);
  assert.throws(() => applyCloudChange(conflict, { type: 'expense.remove', id: expense.id, meta: { ...meta, expected: fingerprint(expense) } }), RecordConflictError);
  assert.throws(() => applyCloudChange(conflict, { type: 'expense.put', expense, meta }), RecordConflictError);
  assert.deepEqual(applyCloudChange(filled, { type: 'expense.put', expense, meta }), filled);
});
test('同步確認不會把剛上傳的版本再算一次，離線連續修改保留正確順序', async () => {
  const store = memory();
  let cloud = empty, cached = empty;
  const engine = createSyncEngine({ getStorage: () => store, saveGroup: (_, group) => { cached = group; }, send: async (_, change) => (cloud = applyCloudChange(cloud, change)) });
  engine.enqueue(empty.code, { type: 'expense.put', expense, meta });
  const optimistic = engine.merge(empty);
  engine.enqueue(empty.code, { type: 'expense.put', expense: { ...expense, amount: 200 }, meta: { ...meta, id: 'm2', expected: fingerprint(optimistic.expenses[0]) } });
  engine.setConnected(true);
  assert.equal(await engine.flush(empty.code), true);
  assert.equal(cloud.expenses[0].revision, 2);
  assert.deepEqual(cached, cloud);
});
test('衝突先保留待同步內容，選擇雲端版本只放棄這筆的修改', async () => {
  const store = memory();
  const cloud = { ...filled, expenses: [{ ...expense, amount: 120 }] };
  let cache: Group | undefined;
  const engine = createSyncEngine({ getStorage: () => store, saveGroup: (_, group) => { cache = group; }, send: async (_, change) => applyCloudChange(cloud, change) });
  engine.enqueue(empty.code, { type: 'expense.put', expense: { ...expense, amount: 200 }, meta: { ...meta, expected: fingerprint(expense) } });
  engine.enqueue('999999', { type: 'group.rename', name: '別组' });
  engine.setConnected(true);
  assert.equal(await engine.flush(empty.code), false);
  assert.equal(engine.getStatus(empty.code).pending, 1);
  engine.setConnected(false);
  engine.resolveConflict(empty.code, 'cloud');
  assert.equal(cache!.expenses[0].amount, 120);
  assert.equal(engine.getStatus(empty.code).pending, 0);
});
test('分類統計以分為單位，月份篩選不影響其他月份，舊紀錄為其他', () => {
  const summary = summarizeExpenses([expense, { ...expense, id: 'e2', amount: 10, category: 'food', date: '2026-09-02' }], 'A', '2026-10');
  assert.equal(summary.total, 100); assert.equal(summary.mine, 33.34); assert.equal(summary.paid, 100);
  assert.equal(summary.count, 1); assert.equal(summary.categories[0].id, 'other');
  const all = ['A','B','C'].reduce((sum, name) => sum + Math.round(summarizeExpenses([expense], name).mine * 100), 0);
  assert.equal(all, 10000);
});
test('手機連續輸入合併草稿寫入，關閉前立即保存最新值', async () => {
  let writes = 0, value = '';
  const writer = new DraftWriter(() => assert.fail(), 20);
  writer.schedule(() => { value = '1'; writes++; });
  writer.schedule(() => { value = '12'; writes++; });
  writer.schedule(() => { value = '123'; writes++; });
  assert.equal(writes, 0);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(writes, 1); assert.equal(value, '123');
  writer.schedule(() => { value = '1234'; writes++; });
  assert.equal(writer.flush(), true); assert.equal(writes, 2);
});
test('草稿儲存失敗會保留待寫內容，取消已儲存表單不重新建立草稿', () => {
  let fail = true, errors = 0, written = 0;
  const writer = new DraftWriter(() => errors++);
  writer.schedule(() => { if (fail) throw new Error('quota'); written++; });
  assert.equal(writer.flush(), false); assert.equal(errors, 1);
  fail = false; assert.equal(writer.flush(), true); assert.equal(written, 1);
  writer.schedule(() => written++); writer.cancel(); writer.flush(); assert.equal(written, 1);
});
test('備份包含草稿、範本及待同步紀錄，不含身分憑證或其他網站資料', () => {
  const store = memory();
  store.setItem('warikan_group_123456', JSON.stringify(filled));
  store.setItem('warikan_my_groups', JSON.stringify([{ code: empty.code, name: empty.name, myName: 'A' }]));
  store.setItem('firebase:authUser:key', 'secret');
  store.setItem('other-app', 'secret2');
  store.setItem('warikan_outbox_v1', JSON.stringify([{ id: 'p1', groupCode: empty.code, change: { type: 'expense.put', expense, meta } }]));
  const backup = readBackup(JSON.stringify(createBackup(store)));
  assert.equal(Object.keys(backup.entries).length, 3);
  assert.equal(JSON.stringify(backup).includes('secret'), false);
  const target = memory(); target.setItem('warikan_group_123456', JSON.stringify({ ...filled, expenses: [{ ...expense, amount: 300 }] }));
  const plan = planRestore(target, backup);
  assert.equal(plan.records, 0); assert.equal(plan.pending, 0);
  commitRestore(target, plan);
  assert.equal(JSON.parse(target.getItem('warikan_group_123456')!).expenses[0].amount, 300);
});
test('備份新增紀錄使用原有 ID，重複還原不重複，也不自動重建雲端群組', () => {
  const from = memory(); from.setItem('warikan_group_123456', JSON.stringify(filled));
  const to = memory(), backup = createBackup(from);
  const plan = planRestore(to, backup);
  assert.equal(plan.records, 1); assert.equal(plan.pending, 1);
  commitRestore(to, plan);
  assert.equal(JSON.parse(to.getItem('warikan_group_123456')!).expenses[0].id, expense.id);
  const again = planRestore(to, backup); assert.equal(again.records, 0); assert.equal(again.pending, 0);
});
test('還原儲存空間不足時回復原值，不碰其他資料', () => {
  const store = memory(); store.setItem('warikan_my_groups', '[]'); store.setItem('other', 'keep');
  let writes = 0;
  const unreliable = { ...store, setItem: (key: string, value: string) => { if (++writes === 2) throw new Error('quota'); store.setItem(key, value); } };
  const backup = memory(); backup.setItem('warikan_group_123456', JSON.stringify(filled));
  assert.throws(() => commitRestore(unreliable, planRestore(store, createBackup(backup))), /原有資料/);
  assert.equal(store.getItem('warikan_group_123456'), null);
  assert.equal(store.getItem('warikan_my_groups'), '[]'); assert.equal(store.getItem('other'), 'keep');
});
test('還原拒絕錯誤格式、原型汙染及非分帳儲存鍵', () => {
  const from = memory(); from.setItem('warikan_group_123456', JSON.stringify(filled));
  const backup = createBackup(from);
  assert.throws(() => readBackup(JSON.stringify({ ...backup, entries: { secret: 'steal' } })));
  assert.throws(() => readBackup('{"app":"Expense-Splitting","version":1,"entries":{"__proto__":{}}}'));
  assert.throws(() => readBackup(JSON.stringify({ ...backup, entries: { warikan_group_123456: JSON.stringify({ ...filled, expenses: [{ ...expense, amount: -1 }] }) } })));
  assert.throws(() => readBackup(JSON.stringify({ ...backup, entries: { warikan_group_123456: JSON.stringify({ ...filled, expenses: [{ ...expense, date: '2026-99-99' }] }) } })));
  assert.throws(() => readBackup(JSON.stringify({ ...backup, entries: { warikan_group_123456: JSON.stringify({ ...filled, expenses: [{ ...expense, id: 'e1/invalid' }] }) } })));
  assert.throws(() => readBackup(JSON.stringify({ ...backup, entries: { warikan_group_123456: JSON.stringify({ ...filled, expenses: [{ ...expense, _deleted: true }] }) } })));
});
test('CSV 保留中文、引號與換行，避免將文字當成試算表公式', () => {
  const csv = groupCsv({ ...filled, name: '=HYPERLINK("bad")', expenses: [{ ...expense, desc: '  @SUM(1+1)\n"晚餐"' }] });
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'  @SUM"));
  assert.ok(csv.includes('""晚餐""')); assert.ok(csv.includes('A:33.34；B:33.33；C:33.33'));
});
test('範本依群組及使用者隔離，最多20份，錯誤 JSON 不影響記帳', () => {
  const store = memory();
  const template = { id: 't1', name: '晚餐', updatedAt: 1, form: { desc: '晚餐', amount: '100', payer: 'A', participants: ['A'], splitMode: 'equal' as const, customShares: {} } };
  saveTemplates(store, empty.code, 'A', Array.from({ length: 25 }, (_, index) => ({ ...template, id: 't' + index })));
  assert.equal(readTemplates(store, empty.code, 'A').length, 20);
  assert.equal(readTemplates(store, empty.code, 'B').length, 0);
  store.setItem('warikan_templates_v1_123456_A', '{oops'); assert.equal(readTemplates(store, empty.code, 'A').length, 0);
});
test('新群組雲端逐筆儲存，刪除標記不顯示，備份歷史限制300筆', () => {
  const protectedGroup = { ...filled, security: { version: 1 as const, ownerUid: 'owner',
    users: { owner: { name: 'C', nameKey: 'C', role: 'owner' as const } }, names: { C: 'owner' } },
    history: Object.fromEntries(Array.from({ length: 305 }, (_, at) => ['h' + at, { id: 'h' + at, at, actor: 'C', action: 'expense.put' as const, target: 'e1', changes: [] }])) };
  const raw = cloudGroup(protectedGroup) as any;
  assert.equal(raw.members.A, true); assert.equal(raw.expenses.e1.id, 'e1');
  raw.expenses.deleted = { ...expense, id: 'deleted', _deleted: true };
  raw.expenses.e1._lastAudit = { privateField: true };
  delete raw.history.h304.changes; // Realtime Database omits empty arrays.
  const normalized = normalizeGroup(raw);
  assert.deepEqual(normalized.members, ['C','A','B']);
  assert.equal(normalized.expenses.length, 1);
  assert.equal('_lastAudit' in normalized.expenses[0], false);
  assert.equal(Object.keys(normalized.history!).length, 300);
  assert.equal(normalized.history!.h0, undefined);
  assert.ok(normalized.history!.h304);
  assert.deepEqual(normalized.history!.h304.changes, []);
  assert.ok((cloudGroup(normalized, raw) as any).expenses.deleted._deleted);
});
