import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { workerSource } from './pwa';

const base = 'https://example.test/Expense-Splitting/';
function worker() {
  const listeners: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const added: Request[] = [], deleted: string[] = [];
  let skipped = 0, claimed = 0, requests = 0;
  let network = async () => new Response('network');
  const cache = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name)!;
    return { addAll: async (files: Request[]) => { added.push(...files); },
      match: async (url: string) => entries.get(url)?.clone() };
  };
  runInNewContext(workerSource('v2', ['index.html','favicon.png','manifest.webmanifest','assets/app.js']), {
    URL, Request, Response, AbortController, setTimeout, clearTimeout,
    self: { registration: { scope: base }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; },
      skipWaiting: () => { skipped++; }, clients: { claim: async () => { claimed++; } } },
    caches: { open: cache, keys: async () => [...stores.keys()], delete: async (key: string) => { deleted.push(key); return stores.delete(key); } },
    fetch: async () => { requests++; return network(); },
  });
  const lifecycle = async (name: string) => {
    let pending: Promise<void> | undefined;
    listeners[name]({ waitUntil: (value: Promise<void>) => { pending = value; } });
    await pending;
  };
  const request = (url: string, mode = 'cors', method = 'GET') => {
    let pending: Promise<Response> | undefined;
    listeners.fetch({ request: { url, mode, method }, respondWith: (value: Promise<Response>) => { pending = value; } });
    return pending;
  };
  return { stores, added, deleted, cache, lifecycle, request,
    offline: () => { network = async () => { throw new Error('offline'); }; },
    unavailable: () => { network = async () => new Response('unavailable', { status: 503 }); },
    message: (data: string) => listeners.message({ data }),
    counts: () => ({ skipped, claimed, requests }) };
}
test('離線預載僅包含本站程式，不自動強制切換版本', async () => {
  const sw = worker(); await sw.lifecycle('install');
  assert.deepEqual(sw.added.map(file => file.url), ['index.html','favicon.png','manifest.webmanifest','assets/app.js'].map(file => base + file));
  assert.ok(sw.added.every(file => file.cache === 'reload'));
  assert.equal(sw.counts().skipped, 0);
  sw.message('OTHER'); assert.equal(sw.counts().skipped, 0);
  sw.message('SKIP_WAITING'); assert.equal(sw.counts().skipped, 1);
});
test('清理旧版只影響自己的程式快取，不碰其他網站或帳目儲存', async () => {
  const sw = worker();
  await sw.cache('warikan-app-v1'); await sw.cache('warikan-app-v2'); await sw.cache('another-app');
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['warikan-app-v1']); assert.equal(sw.counts().claimed, 1);
  assert.ok(sw.stores.has('another-app')); assert.ok(sw.stores.has('warikan-app-v2'));
});
test('斷網與網頁暫時失效時，可從本次版本快取開啟記帳程式', async () => {
  const sw = worker(); await sw.cache('warikan-app-v2');
  sw.stores.get('warikan-app-v2')!.set(base + 'index.html', new Response('offline shell'));
  sw.offline(); assert.equal(await (await sw.request(base, 'navigate'))!.text(), 'offline shell');
  sw.unavailable(); assert.equal(await (await sw.request(base, 'navigate'))!.text(), 'offline shell');
});
test('Firebase、其他路徑、寫入與版本檢查不經過離線快取', () => {
  const sw = worker();
  for (const url of ['https://project.firebaseio.com/groups/123456.json', 'https://example.test/another-app/', base + 'version.json', base + 'sw.js']) {
    assert.equal(sw.request(url, 'navigate'), undefined);
  }
  assert.equal(sw.request(base + 'assets/app.js', 'cors', 'POST'), undefined);
  assert.equal(sw.request(base + 'unknown.json'), undefined);
});
test('已預載的程式檔案斷網仍可載入，線上首頁不覆寫固定版本快取', async () => {
  const sw = worker(); await sw.cache('warikan-app-v2');
  sw.stores.get('warikan-app-v2')!.set(base + 'assets/app.js', new Response('cached js'));
  sw.stores.get('warikan-app-v2')!.set(base + 'index.html', new Response('fixed shell'));
  assert.equal(await (await sw.request(base, 'navigate'))!.text(), 'network');
  assert.equal(await sw.stores.get('warikan-app-v2')!.get(base + 'index.html')!.text(), 'fixed shell');
  sw.offline(); assert.equal(await (await sw.request(base + 'assets/app.js'))!.text(), 'cached js');
});
