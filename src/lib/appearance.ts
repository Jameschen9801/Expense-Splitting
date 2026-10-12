export type AppearanceMode = 'system' | 'light' | 'dark';
export const appearanceKey = 'warikan_appearance_v1';
export const parseAppearance = (value: unknown): AppearanceMode => value === 'light' || value === 'dark' ? value : 'system';
export const resolveAppearance = (mode: AppearanceMode, systemDark: boolean) => mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

let state: { mode: AppearanceMode; message: string } = { mode: 'system', message: '' };
let started = false;
let media: MediaQueryList;
const listeners = new Set<() => void>();
const apply = () => {
  const theme = resolveAppearance(state.mode, media.matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171d1a' : '#f4f5f2');
};
const notify = () => listeners.forEach(listener => listener());

export const appearance = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  start() {
    if (started) return;
    started = true;
    media = window.matchMedia('(prefers-color-scheme: dark)');
    try { state = { mode: parseAppearance(localStorage.getItem(appearanceKey)), message: '' }; } catch {}
    apply();
    media.addEventListener('change', apply);
    window.addEventListener('storage', event => {
      if (event.key === appearanceKey || event.key === null) {
        state = { mode: parseAppearance(event.newValue), message: '' };
        apply(); notify();
      }
    });
  },
  set(mode: AppearanceMode) {
    let message = '';
    try { localStorage.setItem(appearanceKey, mode); }
    catch { message = '本次外觀已套用，但裝置暫時無法保存偏好'; }
    state = { mode, message }; apply(); notify();
  },
};
