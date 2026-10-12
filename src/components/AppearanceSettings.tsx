import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { appearance } from '../lib/appearance';

export function AppearanceSettings() {
  const state = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
  return <section className="settings-section">
    <h3 className="settings-heading">外觀</h3>
    <div className="appearance-options" aria-label="外觀模式">
      {([{ mode: 'system', label: '跟隨系統', icon: Monitor }, { mode: 'light', label: '淺色', icon: Sun }, { mode: 'dark', label: '深色', icon: Moon }] as const).map(option =>
        <button type="button" className="appearance-option" key={option.mode} aria-pressed={state.mode === option.mode} onClick={() => appearance.set(option.mode)}>
          <option.icon size={20} aria-hidden="true" /><span>{option.label}</span>
        </button>
      )}
    </div>
    {state.message && <p role="status" className="text-sm text-ink-2 mt-3">{state.message}</p>}
  </section>;
}
