import type { MyGroup } from '../types';
import { firebaseSession, fetchGroupOnce, currentDeviceUid, normalizeGroup, prepareAccountSignIn } from './firebase';
import { storage } from './utils';
import { Outbox } from './outbox';
import { bankBridgeKey, bankRulesKey, ensureBankBridge, readBankRules, saveBankRules, type BankRule } from './bankShortcuts';
import { accountBookQueueKey, assertAccountReconnect, bankConfig, bookChanges, installSyncedBank, needsAccountReconnect, overlayBooks, validateSyncedBank, type AccountProfile, type BookChanges, type SyncedBank } from './accountData';
import { sync } from './sync';
import { withTimeout } from './syncFeedback';

type AccountState = { initialized: boolean; email: string; ready: boolean; busy: boolean; needsReconnect: boolean; message: string };
let state: AccountState = { initialized: false, email: '', ready: false, busy: false, needsReconnect: false, message: '' };
let starting: Promise<void> | undefined;
let stopProfile: (() => void) | undefined;
let observedUid = '';
let applying = false;
let profile: AccountProfile | null = null;
let hydration = Promise.resolve();
let flushing: Promise<void> | undefined;
const listeners = new Set<() => void>();
function notify(patch: Partial<AccountState>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
function changed() { window.dispatchEvent(new Event('account-sync-updated')); }
function pendingBooks(): BookChanges {
  const saved = JSON.parse(localStorage.getItem(accountBookQueueKey) || 'null');
  return saved?.uid === currentDeviceUid() ? saved.changes : {};
}
function keepPending(changes: BookChanges) {
  localStorage.setItem(accountBookQueueKey, JSON.stringify({ uid: currentDeviceUid(), changes }));
}
async function flushBooks() {
  if (flushing) return flushing;
  flushing = (async () => {
    const { database } = await firebaseSession();
    const { ref, update } = await import('firebase/database');
    while (Object.keys(pendingBooks()).length) {
      const sent = pendingBooks();
      await update(ref(database, 'accountSync/' + currentDeviceUid() + '/books'), sent);
      const remaining = pendingBooks();
      for (const code of Object.keys(sent)) if (JSON.stringify(remaining[code]) === JSON.stringify(sent[code])) delete remaining[code];
      keepPending(remaining);
    }
  })().finally(() => { flushing = undefined; });
  return flushing;
}
async function hydrate(value: AccountProfile | null) {
  if (!value || value.version !== 1) throw new Error('尚未找到同步資料，請先在有原本帳目的桌面 App 開啟同步');
  validateSyncedBank(value.bank);
  const uid = currentDeviceUid();
  const books = overlayBooks(value.books, pendingBooks());
  const available = await Promise.all(books.map(async book => {
    if (!/^\d{6}$/.test(book.code)) throw new Error('帳本同步資料格式錯誤');
    const group = await fetchGroupOnce(book.code);
    if (!group) return null;
    if (group.security && group.security.users[uid]?.name !== book.myName) throw new Error('帳本身分不一致，已停止同步以保留原資料');
    return { book: { ...book, name: group.name, ...(group.kind ? { kind: group.kind } : {}) }, group };
  }));
  // Do not replace caches with an account from a superseded request.
  if (uid !== currentDeviceUid()) return;
  applying = true;
  try {
    for (const item of available) if (item) storage.saveGroup(item.group.code, sync.merge(item.group));
    storage.saveMyGroups(available.flatMap(item => item ? [item.book] : []));
    installSyncedBank(localStorage, value.bank);
    profile = value;
  } finally { applying = false; }
  window.dispatchEvent(new StorageEvent('storage', { key: bankRulesKey }));
  changed();
  notify({ ready: true, message: '帳本與銀行設定已同步' });
}
function queueHydration(value: AccountProfile | null) {
  const task = hydration.catch(() => {}).then(() => hydrate(value));
  hydration = task;
  return task;
}
function watch(uid: string, database: import('firebase/database').Database, onValue: typeof import('firebase/database').onValue, ref: typeof import('firebase/database').ref) {
  if (observedUid === uid) return;
  stopProfile?.(); observedUid = uid;
  stopProfile = onValue(ref(database, 'accountSync/' + uid), snapshot => {
    void queueHydration(snapshot.val()).catch(error => notify({ message: accountError(error) }));
  }, error => notify({ ready: false, message: accountError(error) }));
}
async function refresh() {
  const { auth, database } = await firebaseSession();
  const user = auth.currentUser!;
  const books = storage.getMyGroups();
  const cached = Object.fromEntries(books.map(book => [book.code, storage.getGroup(book.code)]));
  notify({ initialized: true, email: user.isAnonymous ? '' : user.email || '', needsReconnect: user.isAnonymous && needsAccountReconnect(user.uid, books, cached) });
  if (user.isAnonymous) return;
  await flushBooks();
  const { get, onValue, ref, runTransaction } = await import('firebase/database');
  const accountRef = ref(database, 'accountSync/' + user.uid);
  let value = (await get(accountRef)).val();
  // Linking the auth credential may succeed before a network interruption stops
  // the first profile upload. Let the original device finish that upload safely.
  if (!value && storage.getMyGroups().length && storage.getMyGroups().every(book => {
    const group = storage.getGroup(book.code);
    return group && (!group.security || group.security.users[user.uid]?.name === book.myName);
  })) {
    const initial = { version: 1, books: Object.fromEntries(storage.getMyGroups().map(book => [book.code, book])), bank: { rules: bankConfig(readBankRules(localStorage)), bridge: ensureBankBridge(localStorage), revision: 1 } };
    value = (await runTransaction(accountRef, current => current || initial, { applyLocally: false })).snapshot.val();
  }
  await queueHydration(value);
  watch(user.uid, database, onValue, ref);
}
function trackBooks(before: MyGroup[], after: MyGroup[]) {
  if (applying || !state.email || !state.ready) return;
  try {
    keepPending({ ...pendingBooks(), ...bookChanges(before, after) });
    void flushBooks().catch(error => notify({ message: accountError(error) }));
  } catch (error) { notify({ message: accountError(error) }); }
}
export function accountError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/email-already-in-use': '這個 Email 已設定過帳號。請用原先的密碼登入，系統會先核對帳本歸屬，原資料會保留。',
    'auth/credential-already-in-use': '這個 Email 已設定過帳號，請改用原先的密碼登入並核對帳本。',
    'account/reconnect-required': '這台裝置保留了原帳本，但需要重新登入。請使用原本 Email 與密碼，不需要重新綁定或更換 Email。',
    'auth/invalid-email': '請填寫有效的 Email',
    'auth/weak-password': '密碼至少需要 8 個字元',
    'auth/invalid-credential': 'Email 或密碼不正確，請再確認',
    'auth/user-not-found': 'Email 或密碼不正確，請再確認',
    'auth/wrong-password': 'Email 或密碼不正確，請再確認',
    'auth/too-many-requests': '嘗試次數過多，請稍後再試',
    'auth/network-request-failed': '暫時無法連線，原帳目保留，請稍後重試',
    'auth/operation-not-allowed': '帳號同步尚未啟用，原帳目保留，請聯絡管理者',
  };
  return messages[code || ''] || (error instanceof Error ? error.message : '同步未完成，原資料保留');
}

export const accountSync = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  start() {
    starting ||= (async () => {
      window.addEventListener('ledger-memberships-changed', event => {
        const { before, after } = (event as CustomEvent<{ before: MyGroup[]; after: MyGroup[] }>).detail;
        trackBooks(before, after);
      });
      const retry = () => { if (state.email && document.visibilityState === 'visible') void refresh().catch(error => notify({ message: accountError(error) })); };
      window.addEventListener('online', retry);
      document.addEventListener('visibilitychange', retry);
      await refresh();
    })().catch(error => { notify({ initialized: true, message: accountError(error) }); });
    return starting;
  },
  refresh,
  async link(email: string, password: string) {
    if (password.length < 8) throw new Error('請設定至少 8 個字元的密碼');
    notify({ busy: true, message: '' });
    try {
      const { auth, database } = await firebaseSession();
      const { EmailAuthProvider, linkWithCredential } = await import('firebase/auth');
      const originalUid = auth.currentUser!.uid;
      const localBooks = storage.getMyGroups();
      if (needsAccountReconnect(originalUid, localBooks, Object.fromEntries(localBooks.map(book => [book.code, storage.getGroup(book.code)])))) {
        throw Object.assign(new Error('Reconnect required'), { code: 'account/reconnect-required' });
      }
      if (auth.currentUser!.isAnonymous) await linkWithCredential(auth.currentUser!, EmailAuthProvider.credential(email.trim(), password));
      if (auth.currentUser!.uid !== originalUid) throw new Error('身分異常，已停止設定');
      await auth.currentUser!.getIdToken(true);
      await firebaseSession();
      const { ref, runTransaction } = await import('firebase/database');
      const bank = { rules: bankConfig(readBankRules(localStorage)), bridge: ensureBankBridge(localStorage), revision: 1 };
      const books = Object.fromEntries(storage.getMyGroups().map(book => [book.code, book]));
      await runTransaction(ref(database, 'accountSync/' + originalUid), value => value || { version: 1, books, bank }, { applyLocally: false });
      await refresh();
    } finally { notify({ busy: false }); }
  },
  async login(email: string, password: string) {
    if (state.busy) throw new Error('正在處理帳本同步，請稍候');
    notify({ busy: true, message: '' });
    try {
      const { auth } = await firebaseSession();
      if (!auth.currentUser!.isAnonymous) {
        if (auth.currentUser!.email?.toLowerCase() !== email.trim().toLowerCase()) throw new Error('此處已登入另一個同步帳號，原資料仍保留。');
        await refresh(); return;
      }
      const rawBooks = localStorage.getItem('warikan_my_groups');
      const books: MyGroup[] = JSON.parse(rawBooks || '[]');
      if (!Array.isArray(books) || books.some(book => !book || !/^\d{6}$/.test(book.code))) throw new Error('本機帳本清單無法核對，原資料仍保留，請先匯出備份。');
      const keys = ['warikan_my_groups', 'warikan_outbox_v1', 'warikan_last_group', accountBookQueueKey, bankRulesKey, bankBridgeKey, ...books.map(book => 'warikan_group_' + book.code)];
      const before = new Map(keys.map(key => [key, localStorage.getItem(key)]));
      before.set('warikan_my_groups', rawBooks);
      const cached = Object.fromEntries(books.map(book => [book.code, JSON.parse(before.get('warikan_group_' + book.code) || 'null')]));
      const pending = new Outbox({ getItem: key => before.get(key) ?? null, setItem: () => { throw new Error('Read only'); } }).list();
      const memberships = JSON.parse(before.get(accountBookQueueKey) || 'null');
      const candidate = await prepareAccountSignIn(email, password);
      try {
        const account = await withTimeout(candidate.read('accountSync/' + candidate.uid), 15000) as AccountProfile;
        if (!account || account.version !== 1) throw new Error('這個帳號尚未設定帳本同步，請確認使用原本的 Email；原資料仍保留。');
        validateSyncedBank(account.bank);
        const registered = overlayBooks(account.books, memberships?.uid === candidate.uid ? memberships.changes : {});
        const cloud = Object.fromEntries(await Promise.all(registered.map(async book => {
          if (!/^\d{6}$/.test(book.code)) throw new Error('帳本同步資料格式錯誤');
          const raw = await withTimeout(candidate.read('groups/' + book.code), 15000);
          const group = raw ? normalizeGroup(raw) : null;
          return [book.code, group];
        })));
        assertAccountReconnect({ uid: candidate.uid, books, cached, profile: account, cloud, pending, memberships });
        if (keys.some(key => localStorage.getItem(key) !== before.get(key))) throw new Error('核對期間本機資料已更新，請再次登入；變更與草稿仍保留。');
        await candidate.activate();
        stopProfile?.(); stopProfile = undefined; observedUid = ''; profile = null;
        notify({ ready: false, needsReconnect: false, email: auth.currentUser?.email || '' });
        changed();
        await refresh();
        sync.flushAll();
      } finally { await candidate.dispose(); }
    } finally { notify({ busy: false }); }
  },
  async resetPassword(email: string) {
    const { auth } = await firebaseSession();
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(auth, email.trim());
  },
  async saveRules(next: BankRule[], expected: BankRule[]) {
    const { auth, database } = await firebaseSession();
    if (auth.currentUser!.isAnonymous) { saveBankRules(localStorage, next); return; }
    if (!navigator.onLine) throw new Error('銀行規則需要連線才能同步，這次變更尚未儲存');
    // Validate before sending; an empty list is a valid intentional removal.
    saveBankRules({ getItem: () => null, setItem: () => {} }, next);
    const { ref, runTransaction } = await import('firebase/database');
    const result = await runTransaction(ref(database, 'accountSync/' + auth.currentUser!.uid + '/bank'), value => {
      const current = validateSyncedBank(value);
      if (bankConfig(readBankRules({ getItem: () => current.rules, setItem: () => {} })) !== bankConfig(expected)) return;
      return { ...current, rules: bankConfig(next), revision: current.revision + 1 };
    }, { applyLocally: false });
    if (!result.committed) { await refresh(); throw new Error('另一邊剛更新銀行設定，已載入最新版，請重新操作'); }
    installSyncedBank(localStorage, result.snapshot.val() as SyncedBank);
    window.dispatchEvent(new StorageEvent('storage', { key: bankRulesKey }));
  },
  async forgetLedger(code: string) {
    if (!state.email) return;
    const before = profile ? overlayBooks(profile.books) : [];
    trackBooks(before, before.filter(book => book.code !== code));
    const rules = readBankRules(localStorage);
    if (profile) {
      const { auth, database } = await firebaseSession();
      const { ref, runTransaction } = await import('firebase/database');
      await runTransaction(ref(database, 'accountSync/' + auth.currentUser!.uid + '/bank'), value => {
        const current = validateSyncedBank(value);
        const remaining = readBankRules({ getItem: () => current.rules, setItem: () => {} }).filter(rule => rule.groupCode !== code);
        return { ...current, rules: bankConfig(remaining), revision: current.revision + 1 };
      }, { applyLocally: false });
    } else saveBankRules(localStorage, rules.filter(rule => rule.groupCode !== code));
  },
};
