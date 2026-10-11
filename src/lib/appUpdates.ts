const listeners = new Set<() => void>();
let state = { available: false, checking: false, offlineReady: false, message: '', version: __APP_VERSION__ };
let registration: ServiceWorkerRegistration | undefined;
let reloadRequested = false;
let started = false;
const emit = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};
export function flushDraftBeforeNavigation() {
  const detail = { failed: false };
  window.dispatchEvent(new CustomEvent('warikan:flush-draft', { detail }));
  return !detail.failed;
}
export const appUpdates = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  async check() {
    if (state.checking) return;
    emit({ checking: true, message: '' });
    try {
      await registration?.update();
      const response = await fetch(new URL(import.meta.env.BASE_URL + 'version.json', location.origin), { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (typeof data.version !== 'string') throw new Error();
      const available = data.version !== __APP_VERSION__ || !!registration?.waiting;
      emit({ available, message: available ? '有新版可更新' : '目前已是最新版本' });
    } catch { emit({ message: '暫時無法檢查更新，請稍後再試；本機紀錄不受影響' }); }
    finally { emit({ checking: false }); }
  },
  async update() {
    if (!flushDraftBeforeNavigation()) { emit({ message: '草稿尚未保存，請先確認裝置儲存空間，暫不重新載入' }); return; }
    if (!navigator.onLine) { emit({ message: '請連上網路後更新；待同步紀錄會繼續保留' }); return; }
    try {
      await registration?.update();
      if (registration?.waiting) {
        reloadRequested = true;
        registration.waiting.postMessage('SKIP_WAITING');
      } else location.reload();
    } catch { emit({ message: '更新暫時未完成，紀錄與草稿仍保留在此裝置' }); }
  },
  start() {
    if (started || !import.meta.env.PROD) return;
    started = true;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadRequested) { reloadRequested = false; location.reload(); }
      });
      navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { updateViaCache: 'none' }).then(reg => {
        registration = reg;
        if (reg.waiting) emit({ available: true });
        reg.addEventListener('updatefound', () => {
          reg.installing?.addEventListener('statechange', () => {
            if (reg.waiting && navigator.serviceWorker.controller) emit({ available: true });
          });
        });
        navigator.serviceWorker.ready.then(() => emit({ offlineReady: true }));
      }).catch(() => emit({ message: '離線啟動尚未準備完成，仍可正常記帳' }));
    }
    void appUpdates.check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void appUpdates.check();
    });
    window.addEventListener('online', () => void appUpdates.check());
    window.setInterval(() => { if (document.visibilityState === 'visible') void appUpdates.check(); }, 10 * 60 * 1000);
  },
};
