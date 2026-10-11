import type { Group } from '../types';
import { storage } from './utils';
import { Outbox, overlayPending, type GroupChange, type PendingChange } from './outbox';
import { fingerprint, RecordConflictError } from './audit';
import { applyChangeInCloud } from './firebase';

export function createSyncEngine(dependencies: {
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  send: (code: string, change: GroupChange) => Promise<Group>;
  saveGroup: (code: string, group: Group) => void;
}) {
  const outbox = () => new Outbox(dependencies.getStorage());
  const listeners = new Set<() => void>();
  const active = new Map<string, Promise<boolean>>();
  const failures = new Map<string, string>();
  const conflicts = new Map<string, { cloud: Group; targetId: string; change: GroupChange }>();
  let connected = false;
  let version = 0;

  function notify() { version++; listeners.forEach(listener => listener()); }

  const sync = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion: () => version,
    getStatus(code: string) {
      return { connected, pending: outbox().list().filter(item => item.groupCode === code).length, syncing: active.has(code), error: failures.has(code), reason: failures.get(code), conflict: conflicts.get(code) };
    },
    merge(group: Group) { return overlayPending(group, outbox().list()); },
    setConnected(value: boolean) {
      connected = value;
      notify();
      if (value) sync.flushAll();
    },
    enqueue(code: string, change: GroupChange) {
      // Persist the intention BEFORE updating the UI or sending anything to Firebase.
      outbox().enqueue(code, change);
      failures.delete(code);
      notify();
      if (connected) void sync.flush(code);
    },
    flushAll() {
      for (const code of new Set(outbox().list().map(item => item.groupCode))) void sync.flush(code);
    },
    resolveConflict(code: string, keep: 'cloud' | 'mine') {
      const conflict = conflicts.get(code);
      if (!conflict) return;
      const entityId = (change: GroupChange) => change.type === 'expense.put' ? change.expense.id : change.type === 'transfer.put' ? change.transfer.id : 'id' in change ? change.id : '';
      const latest = outbox().list().filter(item => item.groupCode === code && entityId(item.change) === conflict.targetId).at(-1)?.change || conflict.change;
      const entries = outbox().list().filter(item => item.groupCode !== code || entityId(item.change) !== conflict.targetId);
      if (keep === 'mine') {
        const record = latest.type.startsWith('expense.') ? conflict.cloud.expenses.find(record => record.id === conflict.targetId) : conflict.cloud.transfers.find(record => record.id === conflict.targetId);
        // Persist the replacement before discarding old edits; a quota error keeps the original queue.
        entries.push({ id: crypto.randomUUID(), groupCode: code, change: { ...latest, meta: { ...(latest.meta || conflict.change.meta!), id: crypto.randomUUID(), at: Date.now(), expected: fingerprint(record) } } });
      }
      // A cache/quota failure must not erase the user's queued edit.
      dependencies.saveGroup(code, overlayPending(conflict.cloud, entries));
      dependencies.getStorage().setItem('warikan_outbox_v1', JSON.stringify(entries));
      conflicts.delete(code); failures.delete(code); notify();
      if (connected) void sync.flush(code);
    },
    flush(code: string): Promise<boolean> {
      const running = active.get(code);
      if (running) return running;
      if (!connected) return Promise.resolve(false);
      const run = async () => {
        // Defer so the active map is populated before this worker can finish.
        await Promise.resolve();
        failures.delete(code);
        notify();
        let sending: PendingChange | undefined;
        try {
          while (connected) {
            const item = outbox().list().find(item => item.groupCode === code);
            if (!item) return true;
            sending = item;
            const group = await dependencies.send(code, item.change);
            // Keep newer queued edits over the server acknowledgement.
            dependencies.saveGroup(code, overlayPending(group, outbox().list().filter(pending => pending.id !== item.id)));
            outbox().acknowledge(item.id);
            notify();
          }
          return false;
        } catch (error) {
          if (error instanceof RecordConflictError && sending) {
            conflicts.set(code, { cloud: error.cloud, targetId: error.targetId, change: sending.change });
            failures.set(code, error.message);
          } else {
            const message = error instanceof Error ? error.message : '';
            failures.set(code, /permission|denied/i.test(message) ? '雲端存取被拒絕，請確認成員權限；紀錄仍保留在此裝置' : '同步未完成，紀錄仍保留在此裝置');
          }
          return false;
        } finally {
          active.delete(code);
          notify();
        }
      };
      const promise = run();
      active.set(code, promise);
      notify();
      return promise;
    },
  };

  return sync;
}

export const sync = createSyncEngine({
  getStorage: () => localStorage, send: sendChange, saveGroup: storage.saveGroup,
});

function sendChange(code: string, change: GroupChange): Promise<Group> { return applyChangeInCloud(code, change); }
