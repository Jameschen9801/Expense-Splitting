import type { Group, PersonalLedgerLink } from '../types';
import { currentDeviceUid, fetchGroupOnce, firebaseSession, reconcilePersonalLedger, subscribeToGroup } from './firebase';
import { sync } from './sync';
import { storage } from './utils';
import { excludedOnTargetChange, reviewLink, validSyncDate } from './sharedInbox';

type State = { uid: string; ready: boolean; links: Record<string, PersonalLedgerLink>; errors: Record<string, string>; busy: string[] };
let state: State = { uid: '', ready: false, links: {}, errors: {}, busy: [] };
const listeners = new Set<() => void>();
let generation = 0;
let stopLinks: (() => void) | undefined;
let stopGroups: (() => void)[] = [];
let watchGeneration = 0;
let initialized = false;
const dirty = new Set<string>();
const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const announced = new Map<string, string>();

function notify(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
function cache(group: Group) {
  const merged = sync.merge(group);
  storage.saveGroup(group.code, merged);
  const signature = JSON.stringify(merged);
  if (announced.get(group.code) !== signature) {
    announced.set(group.code, signature);
    window.dispatchEvent(new CustomEvent('personal-ledger-updated', { detail: group.code }));
  }
}
function errorText(cause: unknown) {
  return /permission|denied/i.test(String(cause)) ? '無法存取帳本，請確認登入的是原本的帳號' : '分攤同步暫未完成，連線恢復後會再核對';
}
function queue(code: string) {
  dirty.add(code);
  if (running.has(code) || timers.has(code) || !sync.getStatus('').connected) return;
  timers.set(code, setTimeout(() => { timers.delete(code); void run(code); }, 180));
}
async function run(code: string) {
  if (running.has(code) || !sync.getStatus('').connected) return;
  const epoch = generation;
  let attemptedLink = '';
  running.add(code); notify({ busy: [...running] });
  try {
    while (epoch === generation && dirty.delete(code)) {
      const link = state.links[code];
      if (!link) break;
      if (!reviewLink(link)) break;
      attemptedLink = JSON.stringify(link);
      const group = await reconcilePersonalLedger(code, link);
      if (epoch !== generation) return;
      if (group) cache(group);
      const errors = { ...state.errors }; delete errors[code]; notify({ errors });
    }
  } catch (cause) {
    if (epoch === generation) {
      dirty.add(code);
      if (attemptedLink === JSON.stringify(state.links[code])) notify({ errors: { ...state.errors, [code]: errorText(cause) } });
      else { const errors = { ...state.errors }; delete errors[code]; notify({ errors }); }
    }
  } finally {
    running.delete(code); notify({ busy: [...running] });
    if (dirty.has(code) && !state.errors[code]) queue(code);
  }
}
async function watchGroups() {
  const epoch = ++watchGeneration;
  stopGroups.forEach(stop => stop()); stopGroups = [];
  const targets = new Set(Object.values(state.links).flatMap(link => [link.targetCode, ...Object.keys(link.formerTargets || {})]));
  const sources = new Set(Object.entries(state.links).filter(([, link]) => link.enabled).map(([code]) => code));
  for (const code of new Set([...targets, ...sources])) {
    try {
      const stop = await subscribeToGroup(code, group => {
        if (epoch !== watchGeneration) return;
        if (group && targets.has(code)) { try { cache(group); } catch { /* A failed cache must not stop cloud reconciliation. */ } }
        for (const [sourceCode, link] of Object.entries(state.links)) if (sourceCode === code || link.targetCode === code || link.formerTargets?.[code]) queue(sourceCode);
      }, cause => {
        if (epoch !== watchGeneration) return;
        for (const [sourceCode, link] of Object.entries(state.links)) if (sourceCode === code || link.targetCode === code) {
          notify({ errors: { ...state.errors, [sourceCode]: errorText(cause) } });
        }
      });
      if (epoch === watchGeneration) stopGroups.push(stop); else stop();
    } catch { /* Retried when the app returns to the foreground. */ }
  }
  for (const code of Object.keys(state.links)) queue(code);
}

export const personalLedgerSync = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  async start() {
    if (!initialized) {
      initialized = true;
      let wasConnected = false;
      sync.subscribe(() => {
        const connected = sync.getStatus('').connected;
        if (connected && !wasConnected) for (const code of Object.keys(state.links)) queue(code);
        wasConnected = connected;
      });
      const refresh = () => {
        if (document.visibilityState === 'visible') {
          void personalLedgerSync.start();
          for (const code of Object.keys(state.links)) queue(code);
        }
      };
      window.addEventListener('online', refresh); window.addEventListener('account-sync-updated', refresh);
      document.addEventListener('visibilitychange', refresh);
    }
    const { database } = await firebaseSession();
    const uid = currentDeviceUid();
    if (state.uid === uid) return;
    generation++; watchGeneration++; stopLinks?.(); stopGroups.forEach(stop => stop()); stopGroups = [];
    timers.forEach(timer => clearTimeout(timer)); timers.clear(); dirty.clear(); announced.clear();
    notify({ uid, ready: false, links: {}, errors: {} });
    const { ref, onValue } = await import('firebase/database');
    if (uid !== currentDeviceUid()) return;
    stopLinks = onValue(ref(database, 'personalLedgerLinks/' + uid), snapshot => {
      if (state.uid !== uid) return;
      notify({ ready: true, links: snapshot.val() || {} }); void watchGroups();
    }, cause => notify({ ready: false, errors: { settings: errorText(cause) } }));
  },
  retry(code: string) { queue(code); },
  async configure(sourceCode: string, memberName: string, targetCode: string, enabled: boolean, since: string, cleanupLegacy = true) {
    if (!validSyncDate(since)) throw new Error('請選擇有效的起始日期');
    if (!navigator.onLine || !sync.getStatus('').connected) throw new Error('請連線後再設定，原有帳目會保留');
    await personalLedgerSync.start();
    const { database } = await firebaseSession();
    const uid = currentDeviceUid();
    const { ref, get, runTransaction } = await import('firebase/database');
    const linkRef = ref(database, 'personalLedgerLinks/' + uid + '/' + sourceCode);
    const previous: PersonalLedgerLink | null = (await get(linkRef)).val();
    let excludedIds = previous?.excludedIds || {};
    const formerTargets = { ...previous?.formerTargets };
    if (previous && previous.targetCode !== targetCode) {
      const oldTarget = await fetchGroupOnce(previous.targetCode);
      if (oldTarget) excludedIds = excludedOnTargetChange({ ...previous, cleanupLegacy }, oldTarget);
      formerTargets[previous.targetCode] = true;
    }
    delete formerTargets[targetCode];
    const next: PersonalLedgerLink = { targetCode, memberName, enabled, mode: 'review', since, cleanupLegacy,
      ...(Object.keys(formerTargets).length ? { formerTargets } : {}), ...(Object.keys(excludedIds).length ? { excludedIds } : {}) };
    const result = await runTransaction(linkRef, current => JSON.stringify(current) === JSON.stringify(previous) ? next : undefined, { applyLocally: false });
    if (!result.committed) throw new Error('另一個畫面剛修改設定，請重新確認');
    notify({ links: { ...state.links, [sourceCode]: next } });
    queue(sourceCode);
  },
};
