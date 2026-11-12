import assert from 'node:assert/strict';
import test from 'node:test';
import { readFailure, readServerJson, storageFailure, withTimeout } from './syncFeedback';

test('讀取權限、連線與裝置暫存錯誤提供不同原因', () => {
  assert.match(readFailure({ code: 'PERMISSION_DENIED' }).message, /原本帳號/);
  assert.match(readFailure({ code: 'auth/session-changed' }).message, /原本帳號/);
  assert.doesNotMatch(readFailure({ code: 'auth/network-request-failed' }).message, /原本帳號/);
  assert.match(readFailure({ code: 'read/timeout' }).message, /逾時/);
  assert.match(storageFailure(new DOMException('Full', 'QuotaExceededError')), /空間不足/);
  assert.doesNotMatch(storageFailure(new DOMException('Blocked', 'SecurityError')), /空間不足/);
});

test('明確的雲端核對禁用 HTTP 快取，依原使用者權限讀取且不改寫資料', async () => {
  const url = new URL('https://example.test/groups/123456.json');
  const controller = new AbortController();
  const body = { code: '123456', bankInbox: { incoming: { amount: 100 } } };
  const data = await readServerJson(url, 'fictional-token', controller.signal, (async (input, options) => {
    assert.equal(new URL(String(input)).searchParams.get('auth'), 'fictional-token');
    assert.equal(options?.cache, 'no-store'); assert.equal(options?.redirect, 'error');
    assert.equal(options?.signal, controller.signal); assert.equal(options?.method, undefined);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(data, body); assert.equal(url.searchParams.has('auth'), false);
});

test('拒絕或失敗的雲端讀取不能被當作成功，錯誤不包含憑證', async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(readServerJson(new URL('https://example.test/groups/123456.json'), 'private-fictional-token', new AbortController().signal,
      (async () => new Response('unavailable', { status })) as typeof fetch), (error: any) => {
      assert.equal(error.code, status === 500 ? 'read/unavailable' : 'permission-denied');
      assert.doesNotMatch(error.message, /private-fictional-token|example.test/); return true;
    });
  }
});

test('離線讀取與格式錯誤不回傳舊快取；逾時後可結束重試', async () => {
  const url = new URL('https://example.test/groups/123456.json'), signal = new AbortController().signal;
  await assert.rejects(readServerJson(url, 'fictional-token', signal, (async () => { throw new TypeError('offline'); }) as typeof fetch));
  await assert.rejects(readServerJson(url, 'fictional-token', signal, (async () => new Response('invalid-json')) as typeof fetch));
  await assert.rejects(withTimeout(new Promise(() => {}), 5), (error: any) => error.code === 'read/timeout');
  assert.equal(await withTimeout(Promise.resolve('ready'), 100), 'ready');
});
