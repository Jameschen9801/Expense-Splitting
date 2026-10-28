import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { bankExpenseIdentity, newBankRule } from '../../src/lib/bankShortcuts';
import { taipeiToday } from '../../src/lib/bankBackground';

// Deliberately fixed to the local demo namespace, never a production project.
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
const app = initializeApp({ projectId: 'demo-expense-splitting', databaseURL: 'https://demo-expense-splitting-default-rtdb.firebaseio.com' }, 'background-tests');
const db = getDatabase(app);
const base = 'http://127.0.0.1:5001/demo-expense-splitting/asia-east1/bankInboxApi';
const notice = '【信用卡消費通知】您的Richart卡(末四碼0123)於10/26-19:04刷卡消費約新臺幣58元，實際消費資訊以帳單為準，如有疑問請洽客服';
let uid: string, loginToken: string, key: string;
const rule = newBankRule({ bank: 'Richart', last4: '0123', groupCode: '123456', payer: 'A', participants: ['A'], category: 'food', mode: 'auto', limit: 1e9 });
const group = () => ({ kind: 'personal', code: '123456', name: '背景接收測試', createdAt: 1, members: { A: true }, security: { version: 1, ownerUid: uid, users: { [uid]: { name: 'A', nameKey: 'A', role: 'owner' } }, names: { A: uid } } });
const profile = (rules = [rule]) => ({ version: 1, books: { '123456': { kind: 'personal', code: '123456', name: '背景接收測試', myName: 'A' } }, bank: { rules: JSON.stringify(rules), bridge: 'b'.repeat(64), revision: 1 } });
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any, cache: response.headers.get('cache-control') };
}
const manage = (action: string) => post('/manage', { action }, { Authorization: 'Bearer ' + loginToken, ...(key ? { 'X-Expense-Key': key } : {}) });
const capture = (text = notice, token = key) => post('/capture', { mode: 'capture', text }, { 'X-Expense-Key': token });
before(async () => {
  assert.equal((await fetch(base + '/health')).status, 200, 'Start the auth/database/functions emulators first');
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `background-${Date.now()}@example.test`, password: 'local-test-only-123', returnSecureToken: true }) });
  const user = await response.json() as any;
  assert.ok(user.localId); uid = user.localId; loginToken = user.idToken;
});
beforeEach(async () => {
  key = '';
  await db.ref().set({ groups: { '123456': group() }, accountSync: { [uid]: profile() } });
  const result = await manage('create');
  assert.equal(result.status, 200, result.body.code + ': ' + result.body.message); key = result.body.token; assert.match(key, /^[a-f0-9]{64}$/);
});
after(async () => { await deleteApp(app); });

test('真實 HTTP 綁定僅存雜湊，狀態與連線測試不新增帳目', async () => {
  const before = (await db.ref('groups/123456').get()).val();
  const tested = await post('/capture', { mode: 'test' }, { 'X-Expense-Key': key });
  assert.equal(tested.body.status, 'ready'); assert.equal(tested.cache, 'no-store');
  assert.deepEqual((await db.ref('groups/123456').get()).val(), before);
  const status = await manage('status');
  assert.equal(status.body.activeKeys, 1); assert.equal(status.body.currentKeyActive, true); assert.equal(status.body.lastDelivery.status, 'ready');
  assert.ok(!JSON.stringify((await db.ref().get()).val()).includes(key));
});
test('通知先進一筆待確認，沒有正式支出、原始通知或網址洩漏', async () => {
  const result = await capture();
  assert.equal(result.status, 200); assert.equal(result.body.status, 'pending');
  const saved = (await db.ref('groups/123456').get()).val();
  assert.equal(saved.expenses, undefined);
  const drafts = Object.values(saved.bankInbox) as any[];
  assert.equal(drafts.length, 1); assert.equal(drafts[0].amount, 58); assert.equal(drafts[0].category, 'other');
  assert.deepEqual(drafts[0].participants, ['A']); assert.equal(drafts[0].createdByUid, uid);
  assert.equal(Object.values(saved.history).length, 1);
  assert.ok(!JSON.stringify((await db.ref().get()).val()).includes(notice));
});
test('並行重送、換 Richart Life 標題或補送舊版格式，仍只新增一次', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => capture((i % 2 ? 'Richart Life ' : '') + notice)));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.status === 'pending').length, 1);
  assert.equal(Object.keys((await db.ref('groups/123456/bankInbox').get()).val()).length, 1);
});
test('不同交易時間的同金額消費不被合併', async () => {
  assert.equal((await capture()).body.status, 'pending');
  assert.equal((await capture(notice.replace('19:04', '19:05'))).body.status, 'pending');
  assert.equal(Object.keys((await db.ref('groups/123456/bankInbox').get()).val()).length, 2);
});
test('已忽略的草稿與舊正式帳目墓碑，不會被重送復活', async () => {
  const receipt = await bankExpenseIdentity(rule, { channel: rule.channel, text: notice });
  for (const path of ['bankInbox', 'expenses']) {
    await db.ref('groups/123456/' + path + '/' + receipt.equivalentIds.at(-1)).set({ id: receipt.equivalentIds.at(-1), _deleted: true });
    const before = (await db.ref('groups/123456').get()).val();
    assert.equal((await capture()).body.status, 'duplicate');
    assert.deepEqual((await db.ref('groups/123456').get()).val(), before);
    await db.ref('groups/123456/' + path).remove();
  }
});
test('即時讀取雲端停用或卡片修改，不沿用舊規則', async () => {
  await db.ref('accountSync/' + uid).set(profile([{ ...rule, enabled: false }]));
  assert.equal((await capture()).body.status, 'ignored');
  await db.ref('accountSync/' + uid).set(profile([{ ...rule, last4: '9999' }]));
  assert.equal((await capture()).body.status, 'ignored');
  assert.equal((await db.ref('groups/123456/bankInbox').get()).exists(), false);
});
test('不符合銀行、卡號、驗證碼、退款、失敗、外幣和帳單不新增', async () => {
  for (const text of [notice.replace('0123', '9999'), notice.replace('Richart', '無關銀行'), notice + ' OTP 123456', notice + '退款', notice + '交易失敗', notice.replace('新臺幣', 'USD'), 'Richart 卡號末四碼0123 信用卡帳單 NT$58']) {
    assert.equal((await capture(text)).body.status, 'ignored');
  }
  assert.equal((await db.ref('groups/123456/bankInbox').get()).exists(), false);
});
test('通知缺日期時採台灣執行日期', async () => {
  const result = await capture(notice.replace('於10/26-19:04', ''));
  assert.equal(result.body.status, 'pending');
  assert.equal((Object.values((await db.ref('groups/123456/bankInbox').get()).val())[0] as any).date, taipeiToday(Date.now()));
});
test('不允許其他人的個人帳本、共用帳本或已刪除帳本，刪除後不重建', async () => {
  for (const saved of [{ ...group(), security: { ...group().security, ownerUid: 'stranger' } }, { ...group(), kind: 'shared' }, null]) {
    await db.ref('groups/123456').set(saved);
    const result = await capture(); assert.equal(result.status, 403);
    assert.deepEqual((await db.ref('groups/123456').get()).val(), saved);
  }
  assert.equal((await manage('status')).body.lastDelivery.status, 'error');
});
test('重疊規則明確拒絕，不任意選錯帳本', async () => {
  await db.ref('accountSync/' + uid).set(profile([rule, newBankRule({ ...rule, bank: '台新' })]));
  const result = await capture(); assert.equal(result.status, 422); assert.equal(result.body.code, 'rules_overlap');
  assert.equal((await db.ref('groups/123456/bankInbox').get()).exists(), false);
});
test('錯誤、缺少或已停用的憑證均無法新增；憑證不能用來讀寫設定', async () => {
  assert.equal((await capture(notice, '')).status, 401);
  assert.equal((await capture(notice, 'a'.repeat(64))).status, 401);
  assert.equal((await post('/manage', { action: 'status' }, { 'X-Expense-Key': key })).status, 401);
  assert.equal((await manage('revoke')).status, 200);
  assert.equal((await capture()).status, 401);
  assert.equal((await db.ref('groups/123456/bankInbox').get()).exists(), false);
});
test('綁定管理拒絕無登入、假登入與未連結的匿名身分', async () => {
  assert.equal((await post('/manage', { action: 'create' })).status, 401);
  assert.equal((await post('/manage', { action: 'create' }, { Authorization: 'Bearer bogus' })).status, 401);
  const anonymous = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json() as any;
  assert.equal((await post('/manage', { action: 'create' }, { Authorization: 'Bearer ' + anonymous.idToken })).status, 422);
});
test('綁定節流與五組上限，避免連按產生無限憑證', async () => {
  assert.equal((await manage('create')).body.code, 'rate_limited');
  await db.ref('bankIngressUsers/' + uid).set({ keys: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i).repeat(64), { enabled: true, createdAt: 1 }])) });
  assert.equal((await manage('create')).body.code, 'key_limit');
});
test('拒絕把通知放網址、超長或帶額外操作的要求', async () => {
  for (const [path, body] of [['/capture?text=bad', { mode: 'capture', text: notice }], ['/capture', { mode: 'capture', text: notice, groupCode: '654321' }], ['/capture', { mode: 'capture', text: 'x'.repeat(6001) }], ['/capture', []], ['/capture', { mode: 'delete', text: notice }]] as const) {
    assert.equal((await post(path, body, { 'X-Expense-Key': key })).status, 400);
  }
  assert.equal((await post('/capture', { mode: 'capture', text: 'x'.repeat(33000) }, { 'X-Expense-Key': key })).status, 413);
  assert.equal((await fetch(base + '/capture')).status, 405);
  assert.equal((await db.ref('groups/123456/bankInbox').get()).exists(), false);
});
