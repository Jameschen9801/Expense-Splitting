import type { Group } from '../types';
import { storage } from './utils';
import { Outbox, overlayPending, type GroupChange } from './outbox';
import { addMemberToCloud, removeMemberFromCloud, removeExpenseFromCloud, removeTransferFromCloud, renameGroupInCloud, upsertExpenseInCloud, upsertTransferInCloud } from './firebase';

export function createSyncEngine(dependencies: {
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  send: (code: string, change: GroupChange) => Promise<Group>;
  saveGroup: (code: string, group: Group) => void;
}) {
  const outbox = () => new Outbox(dependencies.getStorage());
  const listeners = new Set<() => void>();
  const active = new Map<string, Promise<boolean>>();
  const failures = new Set<string>();
  let connected = false;
  let version = 0;

  function notify() { version++; listeners.forEach(listener => listener()); }

  const sync = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion: () => version,
    getStatus(code: string) {
      return { connected, pending: outbox().list().filter(item => item.groupCode === code).length, syncing: active.has(code), error: failures.has(code) };
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
    flush(code: string): Promise<boolean> {
      const running = active.get(code);
      if (running) return running;
      if (!connected) return Promise.resolve(false);
      const run = async () => {
        // Defer so the active map is populated before this worker can finish.
        await Promise.resolve();
        failures.delete(code);
        notify();
        try {
          while (connected) {
            const item = outbox().list().find(item => item.groupCode === code);
            if (!item) return true;
            const group = await dependencies.send(code, item.change);
            // Keep newer queued edits over the server acknowledgement.
            dependencies.saveGroup(code, sync.merge(group));
            outbox().acknowledge(item.id);
            notify();
          }
          return false;
        } catch {
          failures.add(code);
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

function sendChange(code: string, change: GroupChange): Promise<Group> {
  switch (change.type) {
    case 'expense.put': return upsertExpenseInCloud(code, change.expense);
    case 'expense.remove': return removeExpenseFromCloud(code, change.id);
    case 'transfer.put': return upsertTransferInCloud(code, change.transfer);
    case 'transfer.remove': return removeTransferFromCloud(code, change.id);
    case 'member.add': return addMemberToCloud(code, change.name);
    case 'member.remove': return removeMemberFromCloud(code, change.name);
    case 'group.rename': return renameGroupInCloud(code, change.name);
  }
}
