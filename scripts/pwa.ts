import type { Plugin } from 'vite';

export function workerSource(version: string, files: string[]) {
  return `
const CACHE = 'warikan-app-' + ${JSON.stringify(version)};
const PREFIX = 'warikan-app-';
const BASE = new URL('./', self.registration.scope);
const SHELL = new URL('index.html', BASE).href;
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    FILES.map(file => new Request(new URL(file, BASE), { cache: 'reload' }))
  )));
});
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)
    || url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(request, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('app shell unavailable');
        // Never cache user data or Firebase calls: only this origin's app shell.
        return response;
      } catch {
        const cached = await cache.match(SHELL);
        return cached || Response.error();
      } finally { clearTimeout(timer); }
    })());
  } else if (FILES.some(file => new URL(file, BASE).pathname === url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(url.href)) || fetch(request);
    })());
  }
});`;
}

export function appShellPlugin(version: string): Plugin {
  return {
    name: 'warikan-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['index.html', 'favicon.png', 'manifest.webmanifest',
        ...Object.keys(bundle).filter(file => file.startsWith('assets/') && !file.endsWith('.map'))];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource(version, files) });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({
        id: './', name: '分帳小工具', short_name: '分帳', lang: 'zh-Hant',
        start_url: './', scope: './', display: 'standalone',
        background_color: '#f4f5f2', theme_color: '#f4f5f2',
        icons: [{ src: 'favicon.png', sizes: 'any', type: 'image/png', purpose: 'any' }],
      }) });
    },
  };
}
