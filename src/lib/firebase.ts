import type { Database, Unsubscribe } from 'firebase/database';
import { Expense, Group, Transfer, type AuditEntry, type BankDraft } from '../types';
import { withoutUndefined } from './firebaseData';
import { applyCloudChange, type GroupChange } from './outbox';
import { RecordConflictError, updatedRecord } from './audit';
import { isPersonalLedger } from './ledgers';
import { personalLedgerDeletionUpdate } from './ledgerDeletion';

const firebaseConfig = {
  apiKey: "AIzaSyBTPJD" + "4CLjBsU5yQqjuiwXi1rwAZNF_bo0",
  authDomain: "expense-splitting-a9b78.firebaseapp.com",
  databaseURL: "https://expense-splitting-a9b78-default-rtdb.firebaseio.com",
  projectId: "expense-splitting-a9b78",
  storageBucket: "expense-splitting-a9b78.firebasestorage.app",
  messagingSenderId: "259563826188",
  appId: "1:259563826188:web:aeab760813e231e2d85229",
  measurementId: "G-0P2867E9JD"
};
const useEmulator = (import.meta.env?.DEV || import.meta.env?.MODE === 'test') && import.meta.env?.VITE_USE_FIREBASE_EMULATOR === 'true';
let emulatorsConnected = false;

let databasePromise: Promise<Database> | null = null;
let deviceUid = '';
export const currentDeviceUid = () => deviceUid;
export const memberNameKey = (name: string) => name;
export const validMemberName = (name: string) => !!name.trim() && name.length <= 12 && !/[.#$\[\]/]/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name);
export const ensureDeviceIdentity = async () => { await getDatabaseInstance(); return deviceUid; };
export const firebaseSession = async () => {
  const database = await getDatabaseInstance();
  const { getAuth } = await import('firebase/auth');
  const auth = getAuth();
  deviceUid = auth.currentUser?.uid || '';
  return { database, auth };
};

const getDatabaseInstance = () => {
  if (!databasePromise) {
    databasePromise = Promise.all([
      import('firebase/app'),
      import('firebase/database'),
      import('firebase/auth'),
    ]).then(async ([appModule, databaseModule, authModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(useEmulator ? { ...firebaseConfig, apiKey: 'demo-key', projectId: 'demo-expense-splitting', authDomain: 'localhost', databaseURL: 'https://demo-expense-splitting-default-rtdb.firebaseio.com' } : firebaseConfig);
      const auth = authModule.getAuth(app);
      const database = databaseModule.getDatabase(app);
      if (useEmulator && !emulatorsConnected) {
        authModule.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        databaseModule.connectDatabaseEmulator(database, '127.0.0.1', 9000);
        emulatorsConnected = true;
      }
      await auth.authStateReady();
      const user = auth.currentUser || (await authModule.signInAnonymously(auth)).user;
      deviceUid = user.uid;
      return database;
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
};

// 即時監聽群組雲端資料
const publicRecord = <T extends Expense | Transfer>(record: T & { _deleted?: boolean; _lastAudit?: AuditEntry }): T => {
  const { _deleted, _lastAudit, ...visible } = record;
  return visible as T;
};
export const normalizeGroup = (data: any): Group => {
  const rows = (value: any) => Object.values(value || {}).filter((record: any) => record && !record._deleted).map((record: any) => publicRecord(record));
  const members: string[] = Array.isArray(data.members) ? data.members.filter(Boolean) : Object.keys(data.members || {});
  const ownerName = data.security?.users?.[data.security.ownerUid]?.name;
  const history = Object.fromEntries(Object.entries(data.history || {})
    .sort(([, a]: [string, any], [, b]: [string, any]) => b.at - a.at).slice(0, 300)
    .map(([id, entry]: [string, any]) => [id, { ...entry, changes: Object.values(entry.changes || {}) }]));
  return { ...data, expenses: rows(data.expenses), transfers: rows(data.transfers),
    ...(data.bankInbox ? { bankInbox: rows(data.bankInbox) as BankDraft[], bankReceiptIds: Object.keys(data.bankInbox) } : {}),
    ...(data.history ? { history } : {}),
    members: ownerName && members.includes(ownerName) ? [ownerName, ...members.filter(name => name !== ownerName)] : members };
};
export const cloudGroup = (group: Group, previous?: any) => {
  if (!group.security) return withoutUndefined(group);
  const records = (rows: (Expense | Transfer)[], old: any) => {
    const deleted = Object.fromEntries(Object.entries(old || {}).filter(([, record]: [string, any]) => record?._deleted));
    return { ...deleted, ...Object.fromEntries(rows.map(record => [record.id, { ...record,
      ...((group.history?.[record.lastMutationId!] || old?.[record.id]?._lastAudit) ? { _lastAudit: group.history?.[record.lastMutationId!] || old?.[record.id]?._lastAudit } : {}),
    }])) };
  };
  const { bankReceiptIds, ...visibleGroup } = group;
  const bankInbox = records(group.bankInbox || [], previous?.bankInbox);
  for (const [id, draft] of Object.entries(previous?.bankInbox || {}) as [string, any][]) {
    if (!bankReceiptIds?.includes(id) || group.bankInbox?.some(item => item.id === id) || draft._deleted) continue;
    const entry = Object.values(group.history || {}).find(item => item.target === id && ['bankDraft.confirm','bankDraft.remove'].includes(item.action));
    bankInbox[id] = { ...draft, _deleted: true, ...(entry ? { _lastAudit: entry, lastMutationId: entry.id, updatedAt: entry.at, updatedBy: entry.actor, updatedByUid: entry.actorUid } : {}) };
  }
  return withoutUndefined({ ...visibleGroup, members: Object.fromEntries(group.members.map(name => [name, true])),
    ...(group.bankInbox || previous?.bankInbox ? { bankInbox } : {}),
    expenses: records(group.expenses, previous?.expenses), transfers: records(group.transfers, previous?.transfers) });
};

export const subscribeToConnection = async (onChange: (connected: boolean) => void): Promise<Unsubscribe> => {
  const [database, { ref, onValue }] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
  return onValue(ref(database, '.info/connected'), snapshot => onChange(snapshot.val() === true), () => onChange(false));
};

export const subscribeToBankInbox = async (code: string, onUpdate: (data: Pick<Group,'bankInbox'|'bankReceiptIds'>) => void, onExpenseCount?: (count: number) => void): Promise<Unsubscribe> => {
  const [database, { ref, onValue }] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
  const stopInbox = onValue(ref(database, 'groups/' + code + '/bankInbox'), snapshot => {
    const rows = snapshot.val() || {};
    onUpdate({ bankInbox: Object.values(rows).filter((row: any) => row && !row._deleted).map((row: any) => publicRecord(row)) as BankDraft[], bankReceiptIds: Object.keys(rows) });
  });
  const stopExpenses = onExpenseCount ? onValue(ref(database, 'groups/' + code + '/expenses'), snapshot => {
    onExpenseCount(Object.values(snapshot.val() || {}).filter((row: any) => row && !row._deleted).length);
  }) : undefined;
  return () => { stopInbox(); stopExpenses?.(); };
};

export const subscribeToGroup = (
  groupCode: string,
  onUpdate: (data: Group | null) => void,
  onError?: (error: Error) => void,
  onDeleted?: () => void,
): Promise<Unsubscribe> => Promise.all([
  getDatabaseInstance(),
  import('firebase/database'),
]).then(([database, { ref, onValue, get }]) => {
  const groupRef = ref(database, 'groups/' + groupCode);
  let stopped = false;
  const stop = onValue(groupRef, (snapshot) => {
    const data = snapshot.val();
    if (!data && onDeleted) {
      void get(ref(database, 'deletedPersonalLedgers/' + groupCode)).then(marker => {
        if (stopped) return;
        if (marker.val()?.ownerUid === deviceUid) onDeleted(); else onUpdate(null);
      }).catch(() => { if (!stopped) onUpdate(null); });
      return;
    }
    onUpdate(data ? normalizeGroup(data as Group) : null);
  }, error => onError?.(error));
  return () => { stopped = true; stop(); };
});

export const deletePersonalLedgerInCloud = async (code: string): Promise<void> => {
  if (!/^\d{6}$/.test(code)) throw new Error('帳本代碼格式錯誤');
  const [database, { ref, get, update, serverTimestamp }] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
  const markerRef = ref(database, 'deletedPersonalLedgers/' + code);
  const group = await fetchGroupOnce(code);
  if (!group) {
    if ((await get(markerRef)).val()?.ownerUid === deviceUid) return;
    throw new Error('這本帳本不存在，未執行刪除');
  }
  const changes = personalLedgerDeletionUpdate(group, deviceUid, serverTimestamp());
  try { await update(ref(database), changes); }
  catch (error) {
    // An acknowledgement may be lost or another tab may finish the deletion first.
    if ((await get(markerRef)).val()?.ownerUid === deviceUid) return;
    throw error;
  }
};

export const personalLedgerWasDeleted = async (code: string): Promise<boolean> => {
  if (!/^\d{6}$/.test(code)) return false;
  const [database, {ref,get}] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
  return (await get(ref(database, 'deletedPersonalLedgers/' + code))).val()?.ownerUid === deviceUid;
};

// 一次性讀取群組資料（遠端加入用）
export const fetchGroupOnce = async (groupCode: string): Promise<Group | null> => {
  const [database, { ref, get, child }] = await Promise.all([
    getDatabaseInstance(),
    import('firebase/database'),
  ]);
  const dbRef = ref(database);
  const snapshot = await get(child(dbRef, `groups/${groupCode}`));
  if (snapshot.exists()) {
    return normalizeGroup(snapshot.val() as Group);
  }
  return null;
}

const updateGroup = async (
  groupCode: string,
  updater: (current: Group) => Group,
): Promise<Group> => {
  const [database, { ref, runTransaction }] = await Promise.all([
    getDatabaseInstance(),
    import('firebase/database'),
  ]);
  const groupRef = ref(database, 'groups/' + groupCode);
  // Populate the transaction's local cache before checking an existing group.
  const { get } = await import('firebase/database');
  if (!(await get(groupRef)).exists()) throw new Error('群組不存在');
  const result = await runTransaction(groupRef, current => {
    if (!current) return;
    return cloudGroup(updater(normalizeGroup(current)), current);
  });
  if (!result.committed || !result.snapshot.exists()) {
    throw new Error('群組不存在或雲端更新失敗');
  }
  return normalizeGroup(result.snapshot.val() as Group);
};

export const applyChangeInCloud = async (groupCode: string, change: GroupChange): Promise<Group> => {
  const group = await fetchGroupOnce(groupCode);
  if (!group) throw new Error('群組不存在');
  if (group.security && (change.type.startsWith('expense.') || change.type.startsWith('transfer.'))) {
    const user = group.security.users[deviceUid];
    if (!user) throw new Error('permission_denied：此裝置尚未加入群組');
    const meta = { ...change.meta, id: change.meta?.id || crypto.randomUUID(), actor: user.name, actorUid: deviceUid, at: change.meta?.at || Date.now() };
    change = { ...change, meta };
    if (Object.hasOwn(group.history || {}, meta.id)) return group;
    const target = change.type === 'expense.put' ? change.expense.id : change.type === 'transfer.put' ? change.transfer.id : 'id' in change ? change.id : '';
    const expenseChange = change.type.startsWith('expense.');
    const [database, { ref, get, runTransaction }] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
    const recordRef = ref(database, 'groups/' + groupCode + '/' + (expenseChange ? 'expenses/' : 'transfers/') + target);
    await get(recordRef);
    let entry: AuditEntry | undefined;
    try {
      await runTransaction(recordRef, current => {
        if (current?.lastMutationId === meta.id) { entry = current._lastAudit; return; }
        const before = current && !current._deleted ? publicRecord(current) : undefined;
        const live = { ...group,
          expenses: expenseChange ? [...group.expenses.filter(record => record.id !== target), ...(before ? [before as Expense] : [])] : group.expenses,
          transfers: !expenseChange ? [...group.transfers.filter(record => record.id !== target), ...(before ? [before as Transfer] : [])] : group.transfers };
        const next = applyCloudChange(live, change);
        entry = next.history?.[meta.id];
        if (!entry) return; // Identical record from a backup is already present.
        const record = (expenseChange ? next.expenses : next.transfers).find(record => record.id === target);
        if (record) return withoutUndefined({ ...updatedRecord(record, current ? publicRecord(current) : undefined, meta), _lastAudit: entry });
        // Keep a tombstone so an acknowledgement lost after deletion can be retried safely.
        if (!current) return; // An old pre-versioning deletion is already absent.
        return withoutUndefined({ ...current, _deleted: true, lastMutationId: meta.id, updatedAt: meta.at, updatedBy: user.name, updatedByUid: deviceUid, _lastAudit: entry });
      });
    } catch (error) {
      if (error instanceof RecordConflictError) throw new RecordConflictError((await fetchGroupOnce(groupCode)) || error.cloud, target);
      throw error;
    }
    if (entry) {
      // On another-device recovery, the person completing the upload is the authenticated actor.
      entry = { ...entry, actor: user.name, actorUid: deviceUid };
      const auditRef = ref(database, 'groups/' + groupCode + '/history/' + entry.id);
      await get(auditRef);
      await runTransaction(auditRef, existing => existing ? undefined : withoutUndefined(entry));
    }
    return (await fetchGroupOnce(groupCode))!;
  }
  return updateGroup(groupCode, group => {
    if (group.security) {
      const user = group.security.users[deviceUid];
      if (!user) throw new Error('permission_denied：此裝置尚未加入群組');
      if (change.type.startsWith('bankDraft.')) {
        if (!isPersonalLedger(group) || user.role !== 'owner') throw new Error('permission_denied：只有個人帳本本人可處理通知');
        change = { ...change, meta: { ...change.meta, id: change.meta?.id || crypto.randomUUID(), actor: user.name, actorUid: deviceUid, at: change.meta?.at || Date.now() } };
      }
      if ((change.type.startsWith('member.') || change.type === 'group.rename') && user.role !== 'owner') throw new Error('permission_denied：只有群主可修改管理設定');
      // A restored queue must use the current authenticated identity, never the backup's UID.
      if (change.meta) change = { ...change, meta: { ...change.meta, actor: user.name, actorUid: deviceUid } };
    }
    const result = applyCloudChange(group, change);
    if (group.security && change.type === 'member.remove') {
      const uid = group.security.names[memberNameKey(change.name)];
      const users = { ...group.security.users }, names = { ...group.security.names };
      if (uid === group.security.ownerUid) throw new Error('不能移除群主');
      if (uid) delete users[uid];
      delete names[memberNameKey(change.name)];
      result.security = { ...group.security, users, names };
    }
    return result;
  });
};

export const createGroupInCloud = async (groupData: Group): Promise<boolean> => {
  const [database, { ref, runTransaction }] = await Promise.all([
    getDatabaseInstance(),
    import('firebase/database'),
  ]);
  const groupRef = ref(database, 'groups/' + groupData.code);
  const name = groupData.members[0];
  if (!validMemberName(name)) throw new Error('名字請勿使用 . # $ / [ ] 或保留字');
  const nameKey = memberNameKey(name);
  groupData.security = { version: 1, ownerUid: deviceUid,
    users: { [deviceUid]: { name, nameKey, role: 'owner' } }, names: { [nameKey]: deviceUid } };
  try {
    const result = await runTransaction(groupRef, current => current ? undefined : cloudGroup(groupData));
    return result.committed;
  } catch (error) {
    // An occupied personal code is unreadable to this device; try another code.
    if (/permission[_ -]?denied/i.test(String(error))) return false;
    throw error;
  }
};

export const addMemberToCloud = (groupCode: string, name: string) =>
  updateGroup(groupCode, group => {
    if (isPersonalLedger(group)) throw new Error('個人帳本無法加入其他成員');
    return { ...group, members: group.members.includes(name) ? group.members : [...group.members, name] };
  });

export const joinGroupInCloud = async (groupCode: string, name: string) => {
  const group = await fetchGroupOnce(groupCode);
  if (!group) throw new Error('群組不存在');
  if (isPersonalLedger(group)) throw new Error('個人帳本無法透過邀請碼加入');
  if (!group.security) {
    return addMemberToCloud(groupCode, name);
  }
  if (!validMemberName(name)) throw new Error('名字請勿使用 . # $ / [ ] 或保留字');
  const existing = group.security.users[deviceUid];
  if (existing) {
    if (existing.name !== name) throw new Error('此裝置已使用另一個名字加入這個群組');
  } else {
    const nameKey = memberNameKey(name);
    if (group.security.names[nameKey]) throw new Error('此名稱已綁定其他裝置，請使用不同的顯示名稱');
    const [database, { ref, update }] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
    await update(ref(database, 'groups/' + groupCode + '/security'), {
      ['users/' + deviceUid]: { name, nameKey, role: 'member' }, ['names/' + nameKey]: deviceUid,
    });
  }
  const [database, { ref, set }] = await Promise.all([getDatabaseInstance(), import('firebase/database')]);
  await set(ref(database, 'groups/' + groupCode + '/members/' + memberNameKey(name)), true);
  return (await fetchGroupOnce(groupCode))!;
};

export const removeMemberFromCloud = (groupCode: string, name: string) =>
  updateGroup(groupCode, group => ({
    ...group,
    members: group.members.filter(member => member !== name),
  }));

export const renameGroupInCloud = (groupCode: string, name: string) =>
  updateGroup(groupCode, group => ({ ...group, name }));

export const upsertExpenseInCloud = (groupCode: string, expense: Expense) =>
  updateGroup(groupCode, group => {
    const exists = group.expenses.some(item => item.id === expense.id);
    return {
      ...group,
      expenses: exists
        ? group.expenses.map(item => item.id === expense.id ? expense : item)
        : [...group.expenses, expense],
    };
  });

export const removeExpenseFromCloud = (groupCode: string, expenseId: string) =>
  updateGroup(groupCode, group => ({
    ...group,
    expenses: group.expenses.filter(item => item.id !== expenseId),
  }));

export const upsertTransferInCloud = (groupCode: string, transfer: Transfer) =>
  updateGroup(groupCode, group => {
    const exists = group.transfers.some(item => item.id === transfer.id);
    return {
      ...group,
      transfers: exists
        ? group.transfers.map(item => item.id === transfer.id ? transfer : item)
        : [...group.transfers, transfer],
    };
  });

export const removeTransferFromCloud = (groupCode: string, transferId: string) =>
  updateGroup(groupCode, group => ({
    ...group,
    transfers: group.transfers.filter(item => item.id !== transferId),
  }));
