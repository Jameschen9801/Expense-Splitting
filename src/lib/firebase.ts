import type { Database, Unsubscribe } from 'firebase/database';
import { Expense, Group, Transfer } from '../types';
import { withoutUndefined } from './firebaseData';

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

let databasePromise: Promise<Database> | null = null;

const getDatabaseInstance = () => {
  if (!databasePromise) {
    databasePromise = Promise.all([
      import('firebase/app'),
      import('firebase/database'),
    ]).then(([appModule, databaseModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(firebaseConfig);
      return databaseModule.getDatabase(app);
    });
  }
  return databasePromise;
};

// 即時監聽群組雲端資料
const normalizeGroup = (data: Group): Group => ({
  ...data,
  expenses: data.expenses || [],
  transfers: data.transfers || [],
  members: data.members || [],
});

export const subscribeToGroup = (
  groupCode: string,
  onUpdate: (data: Group | null) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> => Promise.all([
  getDatabaseInstance(),
  import('firebase/database'),
]).then(([database, { ref, onValue }]) => {
  const groupRef = ref(database, 'groups/' + groupCode);
  return onValue(groupRef, (snapshot) => {
    const data = snapshot.val();
    onUpdate(data ? normalizeGroup(data as Group) : null);
  }, error => onError?.(error));
});

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
  const result = await runTransaction(groupRef, current => {
    if (!current) return;
    return withoutUndefined(updater(normalizeGroup(current as Group)));
  });
  if (!result.committed || !result.snapshot.exists()) {
    throw new Error('群組不存在或雲端更新失敗');
  }
  return normalizeGroup(result.snapshot.val() as Group);
};

export const createGroupInCloud = async (groupData: Group): Promise<boolean> => {
  const [database, { ref, runTransaction }] = await Promise.all([
    getDatabaseInstance(),
    import('firebase/database'),
  ]);
  const groupRef = ref(database, 'groups/' + groupData.code);
  const result = await runTransaction(groupRef, current => current ? undefined : withoutUndefined(groupData));
  return result.committed;
};

export const addMemberToCloud = (groupCode: string, name: string) =>
  updateGroup(groupCode, group => ({
    ...group,
    members: group.members.includes(name) ? group.members : [...group.members, name],
  }));

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
