/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  Plus,
  MoreHorizontal,
  X,
  Copy,
  ArrowRight,
  Trash2,
  RotateCcw,
  RefreshCw,
  List,
  Wallet,
  ChartPie,
  Users,
  ChevronRight,
  Search,
  SlidersHorizontal,
  NotebookPen,
  LockKeyhole
} from 'lucide-react';
import { Group, MyGroup, Expense, Income, LedgerRecord, Saving, Transfer, Share, Settlement } from './types';
import { storage, utils } from './lib/utils';
import { sync } from './lib/sync';
import { changeEntityId, changeRecord, type GroupChange } from './lib/outbox';
import { Drafts } from './lib/drafts';
import { RecordsList, type RecordItem } from './components/RecordsList';
import { Modal } from './components/Modal';
import { RecordEditor } from './components/RecordEditor';
import { Statistics } from './components/Statistics';
import { CashflowEditor, EntryKindTabs } from './components/CashflowEditor';
import { RecordProvenance } from './components/RecordProvenance';
import { FinanceTotals } from './components/PersonalStatistics';
import { cashflowValue, personalPeriodLabel, type CashflowForm, type CashflowKind } from './lib/personalFinance';
import { HistoryLog } from './components/HistoryLog';
import { DataSettings } from './components/DataSettings';
import { BankImport } from './components/BankImport';
import { BankInbox, BankInboxCard } from './components/BankInbox';
import { BankSetup } from './components/BankSetup';
import { BankInstallation } from './components/BankInstallation';
import { bankInstallationHash } from './lib/bankInstallation';
import { BankShortcutSettings } from './components/BankShortcutSettings';
import { AccountSyncSettings } from './components/AccountSyncSettings';
import { accountSync } from './lib/accountSync';
import { personalLedgerSync } from './lib/personalLedgerSync';
import { PersonalLedgerSyncSettings } from './components/PersonalLedgerSyncSettings';
import { possibleBankMatches } from './lib/sharedExpenses';
import { DeleteLedgerDialog } from './components/DeleteLedgerDialog';
import { takeBankRequest, type BankInput } from './lib/bankShortcuts';
import { fingerprint } from './lib/audit';
import { categories, categoryLabel, categoryOf, defaultExpenseCategory } from './lib/categories';
import { appUpdates } from './lib/appUpdates';
import { isPersonalLedger, expenseFormForLedger } from './lib/ledgers';
import { cleanupDeletedLedger } from './lib/ledgerDeletion';
import type { ExpenseForm, TransferForm } from './lib/drafts';
import {
  joinGroupInCloud,
  ensureDeviceIdentity,
  currentDeviceUid,
  memberNameKey,
  validMemberName,
  createGroupInCloud,
  fetchGroupOnce,
  deletePersonalLedgerInCloud,
  personalLedgerWasDeleted,
  subscribeToConnection,
  subscribeToGroup,
  subscribeToBankInbox,
} from './lib/firebase';

type ToastState = { message: string; actionLabel?: string; onAction?: () => void };
const groupTabs = [
  { id: 'records', label: '明細', icon: List },
  { id: 'balance', label: '結算', icon: Wallet },
  { id: 'stats', label: '統計', icon: ChartPie },
  { id: 'members', label: '成員', icon: Users },
] as const;

const FAILED_EXPENSE_RECOVERY_START = Date.parse('2026-09-22T09:28:00Z');
const FAILED_EXPENSE_RECOVERY_END = Date.parse('2026-09-22T10:15:00Z');

const editableShares = (expense: Expense) => {
  if (expense.splitMode === 'percent') {
    if (expense.percentages?.length) return expense.percentages;
    if (expense.amount <= 0 || !expense.shares?.length) return [];
    const percentages = expense.shares.map(share => ({
      name: share.name,
      amount: utils.round2((share.amount / expense.amount) * 100),
    }));
    const difference = utils.round2(100 - percentages.reduce((sum, share) => sum + share.amount, 0));
    percentages[percentages.length - 1].amount = utils.round2(percentages[percentages.length - 1].amount + difference);
    return percentages;
  }
  return expense.shares || [];
};

export default function App({ initialBankInput = {} }: { initialBankInput?: BankInput } = {}) {
  const [bankInputs, setBankInputs] = useState<(BankInput & { key: string })[]>(initialBankInput.request || initialBankInput.setup || initialBankInput.error ? [{ ...initialBankInput, key: 'initial' }] : []);
  useEffect(() => {
    const receive = () => {
      const input = takeBankRequest(location, history);
      if (input.request || input.setup || input.error) setBankInputs(queue => [...queue, { ...input, key: crypto.randomUUID() }]);
    };
    // Safari may reuse the current tab when a Shortcut opens the next fragment.
    window.addEventListener('hashchange', receive);
    receive();
    return () => window.removeEventListener('hashchange', receive);
  }, []);
  const [currentPage, setCurrentPage] = useState<'home' | 'group'>('home');
  const [myGroups, setMyGroups] = useState<MyGroup[]>([]);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [myName, setMyName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'records' | 'balance' | 'members' | 'stats'>('records');
  const [recordType, setRecordType] = useState<'expense' | 'transfer'>('expense');
  const [recordSearch, setRecordSearch] = useState('');
  const [recordFilter, setRecordFilter] = useState<'all' | 'mine' | 'paid'>('all');
  const [recordMonth, setRecordMonth] = useState('');
  const [recordCategory, setRecordCategory] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dataSettings, setDataSettings] = useState(false);
  const [bankSettings, setBankSettings] = useState(false);
  const [bankInstallationOpen, setBankInstallationOpen] = useState(() => location.hash === bankInstallationHash);
  const [bankInboxOpen, setBankInboxOpen] = useState(false);
  const [homeInboxSelect, setHomeInboxSelect] = useState(false);
  const [homeInboxData, setHomeInboxData] = useState<Record<string, Pick<Group,'bankInbox'|'bankReceiptIds'>>>({});
  const [homeExpenseCounts, setHomeExpenseCounts] = useState<Record<string, number>>({});
  const [accountSettings, setAccountSettings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [isDeletingLedger, setIsDeletingLedger] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteLock = useRef(false);
  const [deviceUid, setDeviceUid] = useState('');
  const updates = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot);
  useEffect(() => {
    const changed = () => setBankInstallationOpen(location.hash === bankInstallationHash);
    window.addEventListener('hashchange', changed); window.addEventListener('popstate', changed);
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed); };
  }, []);

  // Modals state
  const [modals, setModals] = useState({
    createGroup: false,
    joinGroup: false,
    addRecord: false,
    groupSettings: false,
    expenseDetail: false,
    transferDetail: false
  });

  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [bankMergeId, setBankMergeId] = useState('');
  const [cashflowEditor,setCashflowEditor]=useState<{kind:CashflowKind;record?:Income|Saving}|null>(null);
  const [selectedCashflow,setSelectedCashflow]=useState<{kind:CashflowKind;record:Income|Saving}|null>(null);
  const [isEditingExpense, setIsEditingExpense] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [isEditingTransfer, setIsEditingTransfer] = useState(false);
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | 'error' | ''>('');
  const [syncRetryKey, setSyncRetryKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Form states
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMyName, setNewGroupMyName] = useState('');
  const [newGroupKind, setNewGroupKind] = useState<'personal' | 'shared'>('personal');
  const [joinCode, setJoinCode] = useState('');
  const [joinMyName, setJoinMyName] = useState('');

  const [expForm, setExpForm] = useState<ExpenseForm>({
    desc: '',
    amount: '',
    date: utils.todayStr(),
    payer: '',
    participants: [] as string[],
    splitMode: 'equal' as 'equal' | 'custom' | 'percent',
    customShares: {} as Record<string, string>,
    category: defaultExpenseCategory
  });

  const [tfForm, setTfForm] = useState({
    from: '',
    to: '',
    amount: '',
    date: utils.todayStr(),
    note: ''
  });

  const [settingsGroupName, setSettingsGroupName] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const syncVersion = useSyncExternalStore(sync.subscribe, sync.getVersion);
  const syncStatus = sync.getStatus(currentGroup?.code || '');
  const groupCodeRef = useRef(currentGroup?.code);
  groupCodeRef.current = currentGroup?.code;
  const isOwner = currentGroup?.security ? deviceUid === currentGroup.security.ownerUid : myName === currentGroup?.members[0];
  const personal = isPersonalLedger(currentGroup);
  const personalSyncState = useSyncExternalStore(personalLedgerSync.subscribe, personalLedgerSync.getSnapshot);
  const personalLink = personalSyncState.links[currentGroup?.code || ''];
  const inboxBooks = useMemo(() => myGroups.flatMap(book => {
    const cached = storage.getGroup(book.code);
    if (!cached || !isPersonalLedger(cached)) return [];
    return [{ book, group: sync.merge({ ...cached, ...(currentPage === 'home' ? homeInboxData[book.code] : {}) }) }];
  }), [myGroups, homeInboxData, syncVersion, currentPage]);
  const homeBankDrafts = inboxBooks.flatMap(item => item.group.bankInbox || []);
  const inboxCodes = myGroups.filter(book => isPersonalLedger(storage.getGroup(book.code) || book)).map(book => book.code).join(',');
  useEffect(() => {
    if (currentPage !== 'home') return;
    let disposed = false;
    const stops: (() => void)[] = [];
    for (const code of inboxCodes.split(',').filter(Boolean)) {
      subscribeToBankInbox(code, data => {
        if (disposed) return;
        const cached = storage.getGroup(code);
        if (cached) { try { storage.saveGroup(code, { ...cached, ...data }); } catch { /* The live inbox remains visible below. */ } }
        setHomeInboxData(previous => ({ ...previous, [code]: data }));
      }, count => { if (!disposed) setHomeExpenseCounts(previous => ({ ...previous, [code]: count })); }).then(stop => { if (disposed) stop(); else stops.push(stop); }).catch(() => {});
    }
    return () => { disposed = true; stops.forEach(stop => stop()); };
  }, [currentPage, inboxCodes]);
  const memberMonths = useMemo(() => [...new Set([...(personal ? [utils.todayStr().slice(0,7)] : []), ...[...(currentGroup?.expenses || []), ...(currentGroup?.transfers || []),...(currentGroup?.incomes || []),...(currentGroup?.savings || [])].map(record => record.date?.slice(0, 7)).filter(Boolean)])].sort().reverse(), [currentGroup?.expenses, currentGroup?.transfers,currentGroup?.incomes,currentGroup?.savings, personal]);
  const personalTotal = useMemo(() => (currentGroup?.expenses || []).filter(record => !recordMonth || record.date?.startsWith(recordMonth + '-')).reduce((sum, record) => sum + utils.toCents(record.amount), 0), [currentGroup?.expenses, recordMonth]);
  const personalIncomeTotal=useMemo(()=>(currentGroup?.incomes||[]).filter(record=>!recordMonth||record.date.startsWith(recordMonth+'-')).reduce((sum,record)=>sum+utils.toCents(record.amount),0),[currentGroup?.incomes,recordMonth]);
  useEffect(() => { ensureDeviceIdentity().then(setDeviceUid).catch(() => {}); }, []);
  useEffect(() => {
    void personalLedgerSync.start().catch(() => {});
    const receive = () => {
      const code = groupCodeRef.current;
      const cached = code ? storage.getGroup(code) : null;
      if (cached) setCurrentGroup(sync.merge(cached));
      setMyGroups(storage.getMyGroups());
    };
    window.addEventListener('personal-ledger-updated', receive);
    return () => window.removeEventListener('personal-ledger-updated', receive);
  }, []);
  useEffect(() => {
    if (!selectedExpense || !modals.expenseDetail || !currentGroup) return;
    const live = currentGroup.expenses.find(expense => expense.id === selectedExpense.id);
    if (live) setSelectedExpense(live);
    else { setSelectedExpense(null); setModals(previous => ({ ...previous, expenseDetail: false })); }
  }, [currentGroup?.expenses]);
  useEffect(() => {
    const receive = () => { setMyGroups(storage.getMyGroups()); setDeviceUid(currentDeviceUid()); };
    window.addEventListener('account-sync-updated', receive);
    void accountSync.start();
    return () => window.removeEventListener('account-sync-updated', receive);
  }, []);

  const clearRecordDraft = () => {
    if (currentGroup) {
      try { new Drafts(localStorage).clear(currentGroup.code, myName); }
      catch { showToast('紀錄已保存，但草稿未能清除'); }
    }
  };

  const showExpenseDetail = useCallback((expense: Expense) => {
    setSelectedExpense(expense);
    setBankMergeId('');
    setFormError('');
    setModals(previous => ({ ...previous, expenseDetail: true }));
  }, []);
  const showTransferDetail = useCallback((transfer: Transfer) => {
    setSelectedTransfer(transfer);
    setFormError('');
    setModals(previous => ({ ...previous, transferDetail: true }));
  }, []);
  const showCashflowDetail=useCallback((record:Income|Saving,kind:CashflowKind)=>{setSelectedCashflow({record,kind});setFormError('');},[]);
  useEffect(()=>{
    if(!selectedCashflow||!currentGroup)return;
    const live=(selectedCashflow.kind==='income'?currentGroup.incomes:currentGroup.savings)?.find(record=>record.id===selectedCashflow.record.id);
    if(live)setSelectedCashflow(previous=>previous?{...previous,record:live}:null);else setSelectedCashflow(null);
  },[currentGroup?.incomes,currentGroup?.savings]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    subscribeToConnection(sync.setConnected).then(unsubscribe => {
      if (disposed) unsubscribe();
      else stop = unsubscribe;
    }).catch(() => sync.setConnected(false));
    const retry = () => { if (document.visibilityState === 'visible') sync.flushAll(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, []);

  useEffect(() => sync.subscribe(() => {
    const code = groupCodeRef.current;
    if (!code) return;
    const cached = storage.getGroup(code);
    if (cached) setCurrentGroup(sync.merge(cached));
  }), []);

  useEffect(() => {
    const groups = storage.getMyGroups();
    setMyGroups(groups);
    const lastCode = storage.getLastGroup();
    if (lastCode && groups.find(g => g.code === lastCode)) {
      const data = storage.getGroup(lastCode);
      const mg = groups.find(g => g.code === lastCode);
      if (data && mg) {
        setCurrentGroup(sync.merge(data));
        setMyName(mg.myName);
        setSettingsGroupName(data.name);
        setCurrentPage('group');
        setActiveTab('records');
        setRecordMonth(isPersonalLedger(data) ? utils.todayStr().slice(0,7) : '');
      }
    }
  }, []);

  // 當使用者停留在群組頁面時，自動開啟 Firebase 監聽雙向綁定
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    if (currentPage === 'group' && currentGroup?.code) {
      setSyncState('syncing');
      subscribeToGroup(currentGroup.code, (cloudData) => {
          if (disposed) return;
          if (cloudData) {
            const cachedData = storage.getGroup(currentGroup.code);
            const recoveryKey = `warikan_recovery_v2_${currentGroup.code}`;
            const recoverableExpenses = cachedData?.expenses.filter(expense =>
              expense.createdAt >= FAILED_EXPENSE_RECOVERY_START
              && expense.createdAt <= FAILED_EXPENSE_RECOVERY_END
              && !cloudData.expenses.some(cloudExpense => cloudExpense.id === expense.id)
            ) || [];

            if (!localStorage.getItem(recoveryKey)) {
              try {
                for (const expense of recoverableExpenses) {
                  sync.enqueue(currentGroup.code, { type: 'expense.put', expense });
                }
                localStorage.setItem(recoveryKey, '1');
              } catch {
                setSyncState('error');
                return;
              }
            }
            const merged = sync.merge(cloudData);
            setCurrentGroup(merged);
            try {
              storage.saveGroup(currentGroup.code, merged);
              setSyncState('synced');
            } catch { setSyncState('error'); }
          } else {
            setSyncState('error');
          }
        }, () => { if (!disposed) setSyncState('error'); }, () => {
          // Firebase may emit this tab's optimistic deletion before the server
          // accepts it. The local delete handler waits for the acknowledgement.
          if (!disposed && !deleteLock.current) finishLedgerRemoval(currentGroup.code);
        })
        .then(stopListening => {
          if (disposed) stopListening();
          else unsubscribe = stopListening;
        })
        .catch(() => { if (!disposed) setSyncState('error'); });
    }
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }, [currentPage, currentGroup?.code, syncRetryKey]);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = (message: string, action?: Omit<ToastState, 'message'>) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, ...action });
    toastTimerRef.current = window.setTimeout(() => setToast(null), action ? 5000 : 2600);
  };

  const enterGroup = (data: Group, name: string, recordDate?: string) => {
    setCurrentGroup(sync.merge(data));
    setMyName(name);
    setSettingsGroupName(data.name);
    setCurrentPage('group');
    setActiveTab('records');
    setRecordMonth(isPersonalLedger(data) ? (recordDate || utils.todayStr()).slice(0,7) : ''); setRecordCategory(''); setRecordSearch(''); setRecordFilter('all');
    setFiltersOpen(false);
    storage.setLastGroup(data.code);
  };

  const persistGroupMutation = async (
    optimisticGroup: Group,
    change: GroupChange,
    successMessage?: string,
  ) => {
    try {
      const base = storage.getGroup(optimisticGroup.code) || currentGroup || optimisticGroup;
      const target = changeEntityId(change);
      const before = change.type.startsWith('expense.') ? (isEditingExpense && selectedExpense?.id === target ? selectedExpense : base.expenses.find(record => record.id === target))
        : change.type.startsWith('transfer.') ? (isEditingTransfer && selectedTransfer?.id === target ? selectedTransfer : base.transfers.find(record => record.id === target))
        : change.type.startsWith('income.')||change.type.startsWith('saving.') ? cashflowEditor?.record?.id===target ? cashflowEditor.record : change.type.endsWith('.remove')&&selectedCashflow?.record.id===target ? selectedCashflow.record : changeRecord(base,change) : undefined;
      const meta = { id: crypto.randomUUID(), actor: myName, actorUid: currentDeviceUid(), at: Date.now(), ...(target ? { expected: fingerprint(before) } : {}) };
      sync.enqueue(optimisticGroup.code, { ...change, meta });
      const merged = sync.merge(storage.getGroup(optimisticGroup.code) || optimisticGroup);
      setCurrentGroup(merged);
      // The outbox is already durable even if writing the display cache fails.
      try { storage.saveGroup(merged.code, merged); }
      catch { showToast('紀錄已保存，顯示快取暫時無法更新'); }
      if (successMessage) showToast(successMessage);
      return true;
    } catch {
      setFormError('此裝置無法保存資料，請確認儲存空間後再試；草稿尚未清除');
      showToast('儲存未完成，請保留輸入內容');
      return false;
    }
  };

  const retryPendingMutations = async () => {
    if (!currentGroup) return;
    setSyncRetryKey(key => key + 1);
    if (!syncStatus.connected) { showToast('目前離線，已保存的紀錄會在連線恢復後自動同步'); return; }
    const success = await sync.flush(currentGroup.code);
    showToast(success ? '所有待同步變更已上傳' : '仍有待同步紀錄，會保留在此裝置');
  };

  const toggleModal = (key: keyof typeof modals, open: boolean) => {
    setModals(prev => ({ ...prev, [key]: open }));
    setFormError('');
    if (key === 'addRecord' && open && currentGroup) {
      const draft = new Drafts(localStorage).read(currentGroup.code, myName);
      if (draft) {
        const expense = currentGroup.expenses.find(item => item.id === draft.expenseId);
        const transfer = currentGroup.transfers.find(item => item.id === draft.transferId);
        if ((!draft.expenseId || expense) && (!draft.transferId || transfer)) {
          setExpForm({ ...draft.expense,
            payer: currentGroup.members.includes(draft.expense.payer) ? draft.expense.payer : (currentGroup.members[0] || ''),
            participants: draft.expense.participants.filter(name => currentGroup.members.includes(name)),
          });
          setTfForm({ ...draft.transfer,
            from: currentGroup.members.includes(draft.transfer.from) ? draft.transfer.from : (currentGroup.members[0] || ''),
            to: currentGroup.members.includes(draft.transfer.to) ? draft.transfer.to : '',
          });
          setRecordType(draft.recordType);
          setSelectedExpense(expense || null);
          setSelectedTransfer(transfer || null);
          setIsEditingExpense(!!expense);
          setIsEditingTransfer(!!transfer);
          showToast('已恢復上次未完成的記帳草稿');
          return;
        }
        clearRecordDraft();
      }
      if (!isEditingExpense) {
        setExpForm({
          desc: '', amount: '', date: utils.todayStr(),
          payer: currentGroup.members.includes(myName) ? myName : (currentGroup.members[0] || ''),
          participants: [...currentGroup.members], splitMode: 'equal', customShares: {}, category: defaultExpenseCategory
        });
      }
      if (!isEditingTransfer) {
        const defaultFrom = currentGroup.members.includes(myName) ? myName : (currentGroup.members[0] || '');
        const defaultTo = currentGroup.members.find(m => m !== defaultFrom) || '';
        setTfForm({ from: defaultFrom, to: defaultTo, amount: '', date: utils.todayStr(), note: '' });
      }
      if (!isEditingExpense && !isEditingTransfer) {
        setRecordType('expense');
      }
    }
    if (!open && key === 'addRecord') {
      setIsEditingExpense(false);
      setIsEditingTransfer(false);
    }
  };

  const openEditTransfer = (t: Transfer) => {
    setIsEditingTransfer(true);
    setTfForm({
      from: t.from,
      to: t.to,
      amount: t.amount.toString(),
      date: t.date || utils.todayStr(),
      note: t.note || ''
    });
    setModals(prev => ({ ...prev, transferDetail: false, addRecord: true }));
    setRecordType('transfer');
  };

  const openGroup = (code: string) => {
    const mg = myGroups.find(g => g.code === code);
    if (!mg) return;
    const data = storage.getGroup(code);
    if (!data) return;

    enterGroup(data, mg.myName);
  };

  const openSharedSource = async (expense: Expense) => {
    const source = expense.sharedSource;
    if (!source) return;
    setIsSaving(true); setFormError('');
    try {
      const group = navigator.onLine ? await fetchGroupOnce(source.groupCode) : storage.getGroup(source.groupCode);
      if (!group || !group.expenses.some(record => record.id === source.expenseId)) throw new Error('原始分帳已移除，返回帳本後會重新核對');
      if (group.security && group.security.users[currentDeviceUid()]?.name !== source.memberName) throw new Error('請用原本的帳號開啟共用帳本');
      const original = group.expenses.find(record => record.id === source.expenseId)!;
      storage.saveGroup(group.code, group);
      enterGroup(group, source.memberName, original.date);
      setSelectedExpense(original); setBankMergeId('');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : '暫時無法開啟原始分帳'); }
    finally { setIsSaving(false); }
  };

  const mergeBankExpense = async (bankId: string, shared: Expense) => {
    if (!currentGroup || isSaving) return;
    setIsSaving(true); setFormError('');
    const saved = await persistGroupMutation(currentGroup, { type: 'expense.linkBank', id: bankId, expenseId: shared.id }, '已合併銀行入帳，保留你的分攤金額');
    setIsSaving(false); if (saved) setBankMergeId('');
  };

  const goHome = () => {
    setCurrentPage('home');
    setMyGroups(storage.getMyGroups());
    storage.clearLastGroup();
  };

  const createGroup = async () => {
    const name = newGroupKind === 'personal' ? '我' : newGroupMyName.trim();
    if (!newGroupName.trim() || !name) {
      setFormError('請填寫帳本名稱與你的名字');
      return;
    }
    if (!validMemberName(name)) { setFormError('名字最多 12 字，請勿使用 . # $ / [ ] 或保留字'); return; }
    setIsSaving(true);
    setFormError('');
    try {
      let data: Group | null = null;
      for (let attempt = 0; attempt < 5 && !data; attempt++) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const candidate: Group = {
          kind: newGroupKind,
          name: newGroupName.trim(),
          code,
          members: [name],
          expenses: [],
          transfers: [],
          createdAt: Date.now()
        };
        if (await createGroupInCloud(candidate)) data = candidate;
      }
      if (!data) throw new Error('暫時無法建立帳本，請稍後再試');

      storage.saveGroup(data.code, data);
      const updated = [...myGroups, { code: data.code, name: data.name, myName: name, kind: data.kind }];
      storage.saveMyGroups(updated);
      setMyGroups(updated);
      toggleModal('createGroup', false);
      setNewGroupName('');
      setNewGroupMyName('');
      enterGroup(data, name);
      showToast(newGroupKind === 'personal' ? '個人帳本已建立' : '共用帳本已建立');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '建立暫時未完成，請稍後再試');
      setSyncState('error');
    } finally {
      setIsSaving(false);
    }
  };

  const joinGroup = async () => {
    if (!joinCode.trim() || !joinMyName.trim()) {
      setFormError('請填寫邀請碼與你的名字');
      return;
    }
    if (!/^\d{6}$/.test(joinCode.trim())) {
      setFormError('邀請碼必須是 6 位數字');
      return;
    }

    setIsSaving(true);
    setFormError('');
    setSyncState('syncing');
    try {
      const code = joinCode.trim();
      const name = joinMyName.trim();
      const cloudData = await fetchGroupOnce(code);
      if (!cloudData) {
        setFormError('找不到此邀請碼，請向群組成員確認');
        setSyncState('');
        return;
      }
      if (isPersonalLedger(cloudData)) throw new Error('個人帳本無法透過邀請碼加入');
      const existingLocalMembership = myGroups.some(group => group.code === code && group.myName === name);
      const unclaimedMember = !!cloudData.security && !cloudData.security.names[memberNameKey(name)];
      const sameDevice = cloudData.security?.names[memberNameKey(name)] === currentDeviceUid();
      if (cloudData.members.includes(name) && !existingLocalMembership && !unclaimedMember && !sameDevice) {
        setFormError('此名稱已有人使用，請換一個顯示名稱');
        setSyncState('');
        return;
      }
      const data = await joinGroupInCloud(code, name);
      storage.saveGroup(code, data);

      const updated = myGroups.some(group => group.code === code)
        ? myGroups.map(group => group.code === code ? { ...group, name: data.name, myName: name } : group)
        : [...myGroups, { code, name: data.name, myName: name, kind: data.kind }];
      storage.saveMyGroups(updated);
      setMyGroups(updated);

      toggleModal('joinGroup', false);
      setJoinCode('');
      setJoinMyName('');
      enterGroup(data, name);
      setSyncState('synced');
      showToast('已加入群組');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '加入暫時未完成，請稍後再試');
      setSyncState('error');
    } finally {
      setIsSaving(false);
    }
  };

  const openEditExpense = (e: Expense) => {
    setIsEditingExpense(true);
    const customShares: Record<string, string> = {};
    if (e.splitMode !== 'equal') {
      editableShares(e).forEach(s => {
        customShares[s.name] = s.amount.toString();
      });
    }

    setExpForm({
      desc: e.desc,
      amount: e.amount.toString(),
      date: e.date,
      payer: e.payer,
      participants: [...e.participants],
      splitMode: e.splitMode,
      category: e.category || 'other',
      customShares
    });

    setModals(prev => ({ ...prev, expenseDetail: false, addRecord: true }));
    setRecordType('expense');
  };

  const duplicateExpense = (expense: Expense) => {
    const customShares: Record<string, string> = {};
    editableShares(expense).forEach(share => {
      customShares[share.name] = share.amount.toString();
    });
    setSelectedExpense(null);
    setIsEditingExpense(false);
    setExpForm({
      desc: expense.desc,
      amount: expense.amount.toString(),
      date: utils.todayStr(),
      payer: expense.payer,
      participants: [...expense.participants],
      splitMode: expense.splitMode,
      category: expense.category || 'other',
      customShares,
    });
    setFormError('');
    setRecordType('expense');
    setModals(prev => ({ ...prev, expenseDetail: false, addRecord: true }));
  };

  const addExpense = async (form: ExpenseForm, keepOpen = false): Promise<boolean> => {
    if (!currentGroup) return false;
    form = expenseFormForLedger(currentGroup, form);
    const { desc, amount, payer, participants, splitMode, date, customShares } = form;
    const amt = parseFloat(amount);
    setFormError('');
    if (!desc.trim()) { setFormError('請填寫費用說明'); return false; }
    if (!Number.isFinite(amt) || utils.toCents(amt) <= 0) { setFormError('請填寫至少 0.01 元的有效金額'); return false; }
    if (!payer || !currentGroup.members.includes(payer)) { setFormError('請選擇有效付款人'); return false; }
    if (participants.length === 0 || participants.some(name => !currentGroup.members.includes(name))) { setFormError('請選擇有效的分攤對象'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setFormError('請填寫日期'); return false; }

    let shares: Share[] = [];
    let percentages: Share[] | undefined;
    if (splitMode !== 'equal') {
      const rawShares = participants.map(p => {
        const val = parseFloat(customShares[p] || '0');
        return { name: p, amount: val };
      });
      if (rawShares.some(share => !Number.isFinite(share.amount) || share.amount < 0)) {
        setFormError('分攤數值必須是 0 或正數');
        return false;
      }
      const total = rawShares.reduce((sum, share) => sum + share.amount, 0);

      if (splitMode === 'percent') {
        if (rawShares.some(share => share.amount > 100)) { setFormError('單一成員的比例不能超過 100%'); return false; }
        if (Math.abs(total - 100) > 0.001) { setFormError('比例總和必須等於 100%'); return false; }
        shares = utils.percentShares(amt, rawShares);
        percentages = rawShares;
      } else {
        if (utils.toCents(amt) !== utils.toCents(total)) { setFormError('分攤金額加總必須等於費用金額'); return false; }
        shares = rawShares.map(share => ({ ...share, amount: utils.fromCents(utils.toCents(share.amount)) }));
      }
    }

    const expense: Expense = {
      ...(isEditingExpense && selectedExpense ? selectedExpense : {}),
      id: isEditingExpense && selectedExpense ? selectedExpense.id : 'e' + crypto.randomUUID(),
      desc: desc.trim(), amount: utils.fromCents(utils.toCents(amt)), payer, participants, splitMode, shares,
      category: form.category || (isEditingExpense ? 'other' : defaultExpenseCategory),
      percentages,
      date, createdAt: isEditingExpense && selectedExpense ? selectedExpense.createdAt : Date.now()
    };

    let updatedExpenses;
    if (isEditingExpense && selectedExpense) {
      updatedExpenses = currentGroup.expenses.map(e => e.id === selectedExpense.id ? expense : e);
    } else {
      updatedExpenses = [...currentGroup.expenses, expense];
    }

    const updated = { ...currentGroup, expenses: updatedExpenses };
    setIsSaving(true);
    const saved = await persistGroupMutation(
      updated,
      { type: 'expense.put', expense },
      isEditingExpense ? '費用已更新' : '費用已新增',
    );
    setIsSaving(false);
    if (!saved) return false;
    clearRecordDraft();
    setIsEditingExpense(false);
    setSelectedExpense(null);
    if (keepOpen && !isEditingExpense) {
      setExpForm({
        desc: '',
        amount: '',
        date: utils.todayStr(),
        payer: updated.members.includes(myName) ? myName : (updated.members[0] || ''),
        participants: [...updated.members],
        splitMode: 'equal',
        customShares: {}, category: defaultExpenseCategory,
      });
      const from = updated.members.includes(myName) ? myName : (updated.members[0] || '');
      setTfForm({ from, to: updated.members.find(name => name !== from) || '', amount: '', date: utils.todayStr(), note: '' });
      setFormError('');
    } else {
      toggleModal('addRecord', false);
    }
    return true;
  };

  const choosePersonalEntry=(kind:'expense'|CashflowKind)=>{
    setFormError('');setSelectedCashflow(null);
    if(kind==='expense'){setCashflowEditor(null);if(!modals.addRecord)toggleModal('addRecord',true);}
    else{toggleModal('addRecord',false);setCashflowEditor({kind});}
  };
  const saveCashflow=async(form:CashflowForm)=>{
    if(!currentGroup||!personal||!cashflowEditor||isSaving)return false;
    setFormError('');let value:ReturnType<typeof cashflowValue>;
    try{value=cashflowValue(form);}catch(cause){setFormError((cause as Error).message);return false;}
    const original=cashflowEditor.record;
    const record={...original,...value,id:original?.id||(form.kind==='income'?'i':'s')+crypto.randomUUID(),createdAt:original?.createdAt||Date.now()};
    setIsSaving(true);
    const saved=await persistGroupMutation(currentGroup,form.kind==='income'?{type:'income.put',income:record}:{type:'saving.put',saving:record},(original?'已更新':'已新增')+(form.kind==='income'?'收入':'儲蓄'));
    setIsSaving(false);
    if(saved){setCashflowEditor(null);setRecordMonth(record.date.slice(0,7));setRecordCategory('');setRecordSearch('');setActiveTab('records');}
    return saved;
  };
  const removeCashflow=async(record:Income|Saving,kind:CashflowKind)=>{
    if(!currentGroup)return;
    setSelectedCashflow(null);
    const change:GroupChange=kind==='income'?{type:'income.remove',id:record.id}:{type:'saving.remove',id:record.id};
    if(await persistGroupMutation(currentGroup,change))showToast((kind==='income'?'收入':'儲蓄')+'已刪除',{actionLabel:'復原',onAction:async()=>{
      setToast(null);await persistGroupMutation(currentGroup,kind==='income'?{type:'income.put',income:record}:{type:'saving.put',saving:record},'紀錄已復原');
    }});
  };

  const addTransfer = async (form: TransferForm): Promise<boolean> => {
    if (!currentGroup) return false;
    if (personal) { setFormError('個人帳本不需要還款轉帳'); return false; }
    const { from, to, amount, date, note } = form;
    const amt = parseFloat(amount);
    setFormError('');
    if (!from || !to || !currentGroup.members.includes(from) || !currentGroup.members.includes(to)) { setFormError('請選擇有效的付款人與收款人'); return false; }
    if (from === to) { setFormError('付款人與收款人不能相同'); return false; }
    if (!Number.isFinite(amt) || utils.toCents(amt) <= 0) { setFormError('請填寫至少 0.01 元的有效金額'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setFormError('請填寫日期'); return false; }

    const tf: Transfer = {
      id: isEditingTransfer && selectedTransfer ? selectedTransfer.id : 't' + crypto.randomUUID(),
      from, to, amount: utils.fromCents(utils.toCents(amt)), note: note.trim(),
      date, createdAt: isEditingTransfer && selectedTransfer ? selectedTransfer.createdAt : Date.now()
    };
    
    let updatedTransfers;
    if (isEditingTransfer && selectedTransfer) {
      updatedTransfers = currentGroup.transfers.map(t => t.id === selectedTransfer.id ? tf : t);
    } else {
      updatedTransfers = [...currentGroup.transfers, tf];
    }
    
    const updated = { ...currentGroup, transfers: updatedTransfers };
    setIsSaving(true);
    const saved = await persistGroupMutation(
      updated,
      { type: 'transfer.put', transfer: tf },
      isEditingTransfer ? '轉帳已更新' : '轉帳已記錄',
    );
    setIsSaving(false);
    if (!saved) return false;
    clearRecordDraft();
    toggleModal('addRecord', false);
    setIsEditingTransfer(false);
    return true;
  };

  const removeExpense = async (id: string) => {
    if (!currentGroup) return;
    const target = currentGroup.expenses.find(e => e.id === id);
    if (!target) return;
    const updated = { ...currentGroup, expenses: currentGroup.expenses.filter(e => e.id !== id) };
    toggleModal('expenseDetail', false);
    const success = await persistGroupMutation(
      updated,
      { type: 'expense.remove', id },
    );
    if (success) {
      showToast('費用已刪除', {
        actionLabel: '復原',
        onAction: async () => {
          const restored = { ...updated, expenses: [...updated.expenses, target] };
          setToast(null);
          await persistGroupMutation(restored, { type: 'expense.put', expense: target }, '費用已復原');
        },
      });
    }
  };

  const removeTransfer = async (id: string) => {
    if (!currentGroup) return;
    const target = currentGroup.transfers.find(t => t.id === id);
    if (!target) return;
    const updated = { ...currentGroup, transfers: currentGroup.transfers.filter(t => t.id !== id) };
    toggleModal('transferDetail', false);
    const success = await persistGroupMutation(
      updated,
      { type: 'transfer.remove', id },
    );
    if (success) {
      showToast('轉帳已刪除', {
        actionLabel: '復原',
        onAction: async () => {
          const restored = { ...updated, transfers: [...updated.transfers, target] };
          setToast(null);
          await persistGroupMutation(restored, { type: 'transfer.put', transfer: target }, '轉帳已復原');
        },
      });
    }
  };

  const addMember = async (name: string) => {
    if (personal) { showToast('個人帳本無法加入其他成員'); return false; }
    const trimmedName = name.trim();
    if (!currentGroup || !trimmedName) return false;
    if (currentGroup.security && !validMemberName(trimmedName)) { showToast('名字最多 12 字，請勿使用 . # $ / [ ] 或保留字'); return false; }
    if (currentGroup.security && !isOwner) { showToast('只有群主可新增預設成員，朋友仍可使用邀請碼自行加入'); return false; }
    if (currentGroup.members.includes(trimmedName)) { showToast('此成員已存在'); return false; }
    const updated = { ...currentGroup, members: [...currentGroup.members, trimmedName] };
    return persistGroupMutation(
      updated,
      { type: 'member.add', name: trimmedName },
      `已新增 ${trimmedName}`,
    );
  };

  const removeMember = async (name: string) => {
    if (!currentGroup) return;
    if (personal) return;
    if (name === myName) { showToast('無法移除自己'); return; }
    
    // 檢查是否為群主（群主永遠是 members 的第 0 個索引）
    const creator = currentGroup.members[0];
    if (!isOwner) {
       showToast('⚠️ 權限不足：只有群主可以刪除成員'); 
       return; 
    }
    if (name === creator) { 
       showToast('不能刪除群主'); 
       return; 
    }

    const inUse = [...currentGroup.expenses, ...currentGroup.transfers]
      .some(e => e.payer === name || (e as any).participants?.includes(name) || (e as any).from === name || (e as any).to === name);
    if (inUse) { showToast('此成員有費用記錄，無法移除'); return; }
    const updated = { ...currentGroup, members: currentGroup.members.filter(m => m !== name) };
    await persistGroupMutation(
      updated,
      { type: 'member.remove', name },
      `已移除 ${name}`,
    );
  };

  const saveGroupSettings = async () => {
    if (!currentGroup || !settingsGroupName.trim()) return;
    if (currentGroup.security && !isOwner) { setFormError('只有群主可以修改群組名稱'); return; }
    const name = settingsGroupName.trim();
    const updated = { ...currentGroup, name };
    setIsSaving(true);
    const success = await persistGroupMutation(
      updated,
      { type: 'group.rename', name },
      '帳本名稱已更新',
    );
    setIsSaving(false);
    if (!success) return;
    const updatedMyGroups = myGroups.map(g => g.code === updated.code ? { ...g, name } : g);
    setMyGroups(updatedMyGroups);
    storage.saveMyGroups(updatedMyGroups);
    toggleModal('groupSettings', false);
  };

  const leaveGroup = () => {
    if (!currentGroup) return;
    const updated = myGroups.filter(g => g.code !== currentGroup.code);
    setMyGroups(updated);
    storage.saveMyGroups(updated);
    toggleModal('groupSettings', false);
    goHome();
    showToast('已離開群組');
  };

  function finishLedgerRemoval(code: string) {
    sync.forgetGroup(code);
    let message = '個人帳本已刪除';
    try { cleanupDeletedLedger(localStorage, code); }
    catch { message = '雲端帳本已刪除；本機清理未完成，請重新載入 App'; }
    void accountSync.forgetLedger(code).catch(() => {});
    setMyGroups(storage.getMyGroups().filter(group => group.code !== code));
    setDeleteTarget(target => target?.code === code ? null : target);
    if (groupCodeRef.current === code) {
      setCurrentGroup(null); setMyName(''); setCurrentPage('home');
      setDataSettings(false); setBankSettings(false);
      setBankInboxOpen(false); setHomeInboxSelect(false);
      setCashflowEditor(null);setSelectedCashflow(null);
      setModals({createGroup:false,joinGroup:false,addRecord:false,groupSettings:false,expenseDetail:false,transferDetail:false});
    }
    showToast(message);
  }

  const deletePersonalLedger = async () => {
    const target = deleteTarget;
    if (!target || deleteLock.current) return;
    if (!navigator.onLine || !sync.getStatus(target.code).connected) { setDeleteError('需要連線才能刪除，請稍後再試'); return; }
    deleteLock.current = true; setIsDeletingLedger(true); setDeleteError('');
    let release: (() => void) | undefined;
    try {
      release = sync.beginDeletion(target.code);
      await sync.flush(target.code);
      if (sync.getStatus(target.code).pending > 0) throw new Error('還有資料尚未同步，請先處理同步問題，再刪除帳本');
      await deletePersonalLedgerInCloud(target.code);
      finishLedgerRemoval(target.code);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setDeleteError(/permission|denied/i.test(message) ? '此裝置沒有刪除這本帳本的權限' : message || '尚未確認刪除結果，請保持連線後重試');
      void personalLedgerWasDeleted(target.code).then(deleted => { if (deleted) finishLedgerRemoval(target.code); }).catch(() => {});
    } finally {
      release?.(); deleteLock.current = false; setIsDeletingLedger(false);
    }
  };

  const openBankInstallation = () => {
    toggleModal('groupSettings', false); setBankSettings(false); setDataSettings(false);
    history.pushState(history.state, '', location.pathname + location.search + bankInstallationHash);
    setBankInstallationOpen(true);
  };
  const closeBankInstallation = () => {
    if (location.hash === bankInstallationHash) history.replaceState(history.state, '', location.pathname + location.search);
    setBankInstallationOpen(false);
  };
  const openBankSettings = () => {
    toggleModal('groupSettings', false);
    if (personal) openBankInstallation(); else setBankSettings(true);
  };

  const balances = useMemo(() => currentGroup ? utils.calcBalances(currentGroup) : {}, [currentGroup]);
  const settlements = useMemo(() => utils.calcSettlements(balances), [balances]);

  const groupedRecords = useMemo<Record<string, RecordItem[]>>(() => {
    if (!currentGroup) return {};
    const expenses: RecordItem[] = currentGroup.expenses.map(e => ({ ...e, type: 'expense' }));
    const transfers: RecordItem[] = currentGroup.transfers.map(t => ({ ...t, type: 'transfer' }));
    const cashflows:RecordItem[]=[...(currentGroup.incomes||[]).map(record=>({...record,type:'income' as const})),...(currentGroup.savings||[]).map(record=>({...record,type:'saving' as const}))];
    const query = recordSearch.trim().toLocaleLowerCase('zh-TW');
    const combined = [...expenses, ...transfers,...cashflows].filter(item => {
      const isExpense = item.type === 'expense';
      const isTransfer=item.type==='transfer';
      const isMine = isExpense
        ? item.participants.includes(myName)
        : isTransfer ? item.from === myName || item.to === myName : true;
      const isPaidByMe = isExpense ? item.payer === myName : isTransfer ? item.from === myName : true;
      if (recordFilter === 'mine' && !isMine) return false;
      if (recordFilter === 'paid' && !isPaidByMe) return false;
      if (recordMonth && !item.date?.startsWith(recordMonth + '-')) return false;
      if (recordCategory && (isExpense ? categoryOf(item)!==recordCategory : item.type!==recordCategory)) return false;
      if (!query) return true;
      const searchable = isExpense
        ? [item.desc, item.payer, ...item.participants, categoryLabel(item.category),item.location||'',item.notes||'',...(item.tags||[])]
        : isTransfer ? [item.from, item.to, item.note || ''] : [item.desc,item.type==='income'?'收入':'儲蓄',item.location||'',...(item.tags||[])];
      return searchable.some(value => value.toLocaleLowerCase('zh-TW').includes(query));
    }).sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return b.createdAt - a.createdAt;
    });
    const groups: Record<string, RecordItem[]> = {};
    combined.forEach(item => {
      const key = item.date || '未設定日期';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [currentGroup, myName, recordFilter, recordSearch, recordMonth, recordCategory]);

  const clearRecordFilters = useCallback(() => {
    setRecordSearch(''); setRecordFilter('all'); setRecordMonth(''); setRecordCategory('');
  }, []);
  const visibleRecordCount = Object.values(groupedRecords as Record<string, RecordItem[]>).reduce((sum, records) => sum + records.length, 0);
  const advancedFilterCount = Number(!!recordMonth) + Number(!!recordCategory);
  const bankInputInBackground = bankInboxOpen || homeInboxSelect || !!cashflowEditor || !!selectedCashflow || Object.values(modals).some(Boolean);

  if (bankInstallationOpen) return <><BankInstallation groups={myGroups} currentGroup={currentGroup} onClose={closeBankInstallation} onCreateLedger={() => { closeBankInstallation(); setNewGroupKind('personal'); setNewGroupName('日常記帳'); toggleModal('createGroup', true); }} />{updates.available && <div className="app-update-banner" role="status"><span className="text-xs">有新版可更新，安裝進度會保留</span><button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => appUpdates.update()}>更新</button></div>}</>;

  return (
    <div className={`min-h-[100dvh] flex flex-col font-sans ${toast ? 'has-toast' : ''}`}>
      {currentPage === 'home' ? (
          <div className="page-enter flex flex-col min-h-[100dvh]">
            <nav className="topbar" aria-label="分帳小工具">
              <div className="brand-name font-serif">分帳小工具</div>
              <button type="button" className="icon-btn" aria-label="開啟資料與 App 設定" onClick={() => setDataSettings(true)}><MoreHorizontal size={18} /></button>
            </nav>

            <main className="home-content">
              <div className="home-heading"><h1>我的帳本</h1><p>日常自己記，也能和朋友一起分帳</p><button type="button" className="btn btn-sm mt-3" onClick={() => setAccountSettings(true)}>帳本同步</button></div>
              <div className="home-actions">
                <button className="btn btn-primary" onClick={() => { setNewGroupKind('personal'); setNewGroupName('日常記帳'); toggleModal('createGroup', true); }}>＋ 新增帳本</button>
                <button className="btn" onClick={() => toggleModal('joinGroup', true)}>加入共用帳本</button>
              </div>
              <button type="button" className="bank-install-home" onClick={openBankInstallation}><span>手機自動記帳設定</span><ChevronRight size={17} aria-hidden="true" /></button>
              {inboxBooks.length > 0 && <BankInboxCard drafts={homeBankDrafts} onOpen={() => {
                if (inboxBooks.length === 1) { enterGroup(inboxBooks[0].group, inboxBooks[0].book.myName); setBankInboxOpen(true); }
                else setHomeInboxSelect(true);
              }} />}
                <div className="group-list">
                  {myGroups.length === 0 ? (
                    <div className="empty-state home-empty">
                      <span className="empty-icon"><NotebookPen size={30} aria-hidden="true" /></span>
                      <h2>建立第一個帳本</h2><p>用個人帳本記錄日常花費，或建立共用帳本與朋友分帳。</p>
                    </div>
                  ) : (
                    myGroups.map(g => {
                      const cached = storage.getGroup(g.code);
                      return (
                      <button
                        key={g.code}
                        onClick={() => openGroup(g.code)}
                        className="group-card"
                      >
                        <span className="member-avatar" aria-hidden="true">{g.name.charAt(0)}</span>
                        <div className="min-w-0">
                          <div className="group-card-name">{g.name}</div>
                          <div className="group-card-meta">
                            {isPersonalLedger(cached || g) ? '個人帳本' : '共用帳本'} · {cached ? `${homeExpenseCounts[g.code] ?? cached.expenses.length} 筆費用` : '開啟以載入帳目'}
                          </div>
                        </div>
                        <div className="group-card-end">{isPersonalLedger(cached || g) ? <LockKeyhole size={16} aria-label="個人帳本" /> : <span className="group-card-code">{g.code}</span>}<ChevronRight size={16} aria-hidden="true" /></div>
                      </button>
                    ); })
                  )}
                </div>
            </main>
          </div>
        ) : (
          <div className="page-enter flex flex-col min-h-[100dvh]">
            <nav className="topbar group-topbar" aria-label="群組資訊">
              <button className="icon-btn text-xl" onClick={goHome} aria-label="返回我的帳本"><ArrowLeft size={20} /></button>
              <div className="group-heading">
                <h1 title={currentGroup?.name}>{currentGroup?.name}</h1>
                <p>{personal ? '個人帳本 · 僅自己' : currentGroup?.code}</p>
              </div>
              <div className="group-header-actions">
                {syncStatus.pending > 0 || syncStatus.error || syncState === 'error' ? (
                  <button
                    type="button"
                    className={`sync-status ${syncStatus.syncing ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50 hover:bg-red-100'}`}
                    onClick={retryPendingMutations}
                    disabled={syncStatus.syncing}
                    title="重新上傳尚未同步的變更"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    {syncStatus.pending > 0 ? `${!syncStatus.connected ? '離線・' : syncStatus.syncing ? '同步中 ' : '待同步 '}${syncStatus.pending} 筆` : '重試同步'}
                  </button>
                ) : (
                  <div
                    className={`sync-status ${!syncStatus.connected ? 'text-ink-2 bg-paper-2' : syncState === 'syncing' ? 'text-amber-700 bg-amber-50' : 'text-green-700 bg-green-50'}`}
                    role="status"
                    title="雲端同步狀態"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${!syncStatus.connected ? 'bg-ink-3' : syncState === 'syncing' ? 'bg-amber-500 animate-pulse' : 'bg-green-600'}`}></span>
                    {!syncStatus.connected ? '離線' : syncState === 'syncing' ? '同步中' : '已同步'}
                  </div>
                )}
                <button className="icon-btn" onClick={() => toggleModal('groupSettings', true)} aria-label={personal ? '開啟帳本設定' : '開啟群組設定'}>
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </nav>

            <nav className="group-tabs" data-personal={personal} aria-label="帳本功能">
              {groupTabs.filter(tab => !personal || tab.id === 'records' || tab.id === 'stats').map(tab => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); window.scrollTo({ top: 0, behavior: 'instant' }); }}
                  className="group-tab"
                  aria-pressed={activeTab === tab.id}
                >
                  <tab.icon size={20} aria-hidden="true" /><span>{tab.label}</span>
                </button>
              ))}
            </nav>

            <main className="group-content flex-1">
              {syncStatus.reason && <div className="rounded-2xl border border-line p-4 text-sm bg-paper">
                <p role="alert">{syncStatus.reason}</p>
                {syncStatus.conflict && <div className="mt-3">
                  <p className="text-xs text-ink-3 leading-relaxed mb-3">另一位成員已更新這筆紀錄。你的變更保留在此裝置，請選擇保留哪個版本；選擇雲端版本會放棄此筆尚未同步的修改。</p>
                  {(() => {
                    const conflict = syncStatus.conflict;
                    const cloud = [...conflict.cloud.expenses, ...conflict.cloud.transfers,...conflict.cloud.incomes||[],...conflict.cloud.savings||[], ...conflict.cloud.bankInbox || []].find(record => record.id === conflict.targetId);
                    const mine = [...currentGroup?.expenses || [], ...currentGroup?.transfers || [],...currentGroup?.incomes||[],...currentGroup?.savings||[], ...currentGroup?.bankInbox || []].find(record => record.id === conflict.targetId);
                    const describe = (record?: LedgerRecord) => record ? ('desc' in record ? record.desc : record.from + ' → ' + record.to) + ' · NT$ ' + utils.fmt(record.amount) + ' · ' + record.date : '已刪除';
                    return <div className="text-xs mb-3 space-y-2 break-words"><p>雲端：{describe(cloud)}</p><p>此裝置：{describe(mine)}</p></div>;
                  })()}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => { try { sync.resolveConflict(currentGroup!.code, 'cloud'); } catch { showToast('儲存空間不足，尚未變更任何待同步紀錄'); } }}>保留雲端版本</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => { try { sync.resolveConflict(currentGroup!.code, 'mine'); } catch { showToast('儲存空間不足，尚未變更任何待同步紀錄'); } }}>使用此裝置版本</button>
                  </div>
                </div>}
              </div>}
              {activeTab === 'stats' && currentGroup && <Statistics group={currentGroup} myName={myName} month={recordMonth} onMonth={setRecordMonth} onRecords={(category,period)=>{setRecordMonth(period);setRecordCategory(category);setRecordSearch('');setRecordFilter('all');setActiveTab('records');window.scrollTo({top:0,behavior:'instant'});}} />}
              {activeTab === 'records' && (
                <section>
                  {personal && <div className="personal-overview"><div className="stat-label mb-3">{recordMonth === utils.todayStr().slice(0,7) ? '本月收支' : recordMonth ? personalPeriodLabel(recordMonth)+'收支' : '累計收支'}</div><FinanceTotals incomeCents={personalIncomeTotal} expenseCents={personalTotal} balanceCents={personalIncomeTotal-personalTotal}/><button type="button" className="btn btn-sm mt-4 w-full" onClick={openBankSettings}><Wallet size={16} aria-hidden="true" />銀行自動記帳設定</button></div>}
                  {personal && <BankInboxCard drafts={currentGroup?.bankInbox || []} onOpen={() => setBankInboxOpen(true)} />}
                  {!personal && <button type="button" className="shared-sync-entry" onClick={() => toggleModal('groupSettings', true)}><span>{personalLink?.enabled ? `我的分攤 → ${myGroups.find(book => book.code === personalLink.targetCode)?.name || '個人帳本'}` : '把我的分攤同步到個人帳本'}</span><ChevronRight size={17} aria-hidden="true" /></button>}
                  {personal && currentGroup && currentGroup.expenses.some(expense => possibleBankMatches(expense, currentGroup).length > 0) && <div className="shared-match-notice"><strong>有銀行入帳可能與分帳重複</strong><p>請開啟標示「分攤」的明細核對，可合併並保留你的實際負擔金額。</p><button type="button" className="btn btn-sm" onClick={() => showExpenseDetail(currentGroup.expenses.find(expense => possibleBankMatches(expense, currentGroup).length > 0)!)}>核對可能重複的記錄</button></div>}
                  <div className="records-heading">
                    <h2>明細記錄<span className="record-count">{visibleRecordCount} 筆</span></h2>
                    <button className="btn btn-sm btn-primary hidden sm:inline-flex" onClick={() => toggleModal('addRecord', true)}>＋ 新增</button>
                  </div>
                  <div className="record-toolbar">
                    <div className="record-search-wrap"><Search size={20} aria-hidden="true" />
                    <label className="sr-only" htmlFor="record-search">搜尋記帳明細</label>
                    <input
                      id="record-search"
                      type="search"
                      value={recordSearch}
                      onChange={event => setRecordSearch(event.target.value)}
                      placeholder={personal ? '搜尋說明或分類' : '搜尋說明或成員'}
                      className="record-search"
                      enterKeyHint="search"
                    />
                    </div>
                    <button type="button" className="btn filter-toggle" aria-label="篩選明細" aria-expanded={filtersOpen} aria-controls="advanced-record-filters" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={20} aria-hidden="true" />{advancedFilterCount > 0 && <span className="filter-count" aria-label={`${advancedFilterCount} 個篩選`}>{advancedFilterCount}</span>}</button>
                  </div>
                    {!personal && <div className="record-scope" aria-label="明細篩選">
                      {([
                        ['all', '全部'],
                        ['mine', '與我相關'],
                        ['paid', '我付款的'],
                      ] as const).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          onClick={() => setRecordFilter(value)}
                          aria-pressed={recordFilter === value}
                          className="filter-button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>}
                    <div className="advanced-filters" id="advanced-record-filters" hidden={!filtersOpen}>
                      <div className="advanced-filter-grid">
                        <div><label className="field-label" htmlFor="record-month">明細期間</label><select id="record-month" value={recordMonth} onChange={event => setRecordMonth(event.target.value)}><option value="">全部期間</option>{personal&&<optgroup label="全年">{[...new Set(memberMonths.map(month=>month.slice(0,4)))].map(year=><option key={year} value={year}>{year} 全年</option>)}</optgroup>}<optgroup label="月份">{memberMonths.map(month => <option key={month} value={month}>{month.replace('-', ' / ')}</option>)}</optgroup></select></div>
                        <div><label className="field-label" htmlFor="record-category">明細分類</label><select id="record-category" value={recordCategory} onChange={event => setRecordCategory(event.target.value)}><option value="">{personal ? '全部分類' : '全部分類／轉帳'}</option>{personal&&<><option value="income">收入</option><option value="saving">儲蓄</option></>}{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div>
                      </div>
                      {advancedFilterCount > 0 && <button type="button" className="btn btn-ghost btn-sm w-full mt-3" onClick={() => { setRecordMonth(''); setRecordCategory(''); }}>清除期間與分類</button>}
                    </div>
                  <RecordsList groups={groupedRecords} myName={myName} personal={personal} filtered={!!recordSearch || recordFilter !== 'all' || !!recordCategory || !!recordMonth && (!personal || !!currentGroup?.expenses.length)}
                    resetKey={JSON.stringify([currentGroup?.code, myName, recordSearch, recordFilter, recordMonth, recordCategory])} onClear={clearRecordFilters} onExpense={showExpenseDetail} onTransfer={showTransferDetail} onCashflow={showCashflowDetail} />
                  <button
                    type="button"
                    className="mobile-add-button sm:hidden"
                    onClick={() => toggleModal('addRecord', true)}
                    aria-label={personal ? '新增收支或儲蓄' : '新增費用或轉帳'}
                  >
                    <Plus size={22} aria-hidden="true" />
                    新增
                  </button>
                </section>
              )}

              {activeTab === 'balance' && (
                <>
                  <div className="panel">
                    <div className="panel-header p-4 border-b border-line"><span className="section-label">個人餘額</span></div>
                    <div className="px-4.5">
                      {currentGroup?.members.map(m => {
                        const b = balances[m] || 0;
                        const isPos = b > 0.005;
                        const isNeg = b < -0.005;
                        return (
                          <div key={m} className="flex items-center py-3 border-b border-line last:border-b-0 gap-3">
                            <div className="member-avatar" aria-hidden="true">{m.charAt(0)}</div>
                            <div className="flex-1 text-sm">
                              {m}
                              <div className="text-xs text-ink-3 mt-1">{isPos ? '待收回' : isNeg ? '待付款' : '已結清'}</div>
                            </div>
                            <div className={`money text-base ${isPos ? 'text-green-700' : isNeg ? 'text-red-700' : 'text-ink-3'}`}>
                              {isPos ? '+' : isNeg ? '-' : ''}NT$ {utils.fmt(Math.abs(b))}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-between items-center py-3 border-t border-line mt-1">
                        <span className="text-sm text-ink-2">群組總花費</span>
                        <span className="money text-base">NT$ {utils.fmt(currentGroup?.expenses.reduce((s, e) => s + e.amount, 0) || 0)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="panel mt-4">
                    <div className="panel-header p-4 border-b border-line"><span className="section-label">建議轉帳</span></div>
                    <div className="px-4.5">
                      {settlements.length === 0 ? (
                        <div className="text-center py-10 text-ink-3 text-xs tracking-wider leading-loose">
                          <span className="stamp">已結清</span><br /><br />目前無需轉帳
                        </div>
                      ) : (
                        settlements.map((s, idx) => (
                          <div key={idx} className="flex flex-col py-3 border-b border-line last:border-b-0 gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium">{s.from}</span>
                              <span className="text-ink-3 text-[11px]">應付給</span>
                              <span className="font-medium">{s.to}</span>
                              <span className="ml-auto font-medium">NT$ {utils.fmt(s.amount)}</span>
                            </div>
                            <button
                              className="btn btn-ghost w-full"
                              disabled={isSaving}
                              onClick={async () => {
                                setIsSaving(true);
                                const tf: Transfer = {
                                  id: 't' + crypto.randomUUID(), from: s.from, to: s.to, amount: s.amount,
                                  note: '結算轉帳', date: utils.todayStr(), createdAt: Date.now()
                                };
                                const updated = { ...currentGroup!, transfers: [...currentGroup!.transfers, tf] };
                                try {
                                  await persistGroupMutation(
                                    updated,
                                    { type: 'transfer.put', transfer: tf },
                                    `已記錄：${s.from} → ${s.to} NT$ ${utils.fmt(s.amount)}`,
                                  );
                                } finally {
                                  setIsSaving(false);
                                }
                              }}
                            >
                              {isSaving ? '同步中…' : '✓ 完成轉帳，記錄此筆'}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="panel mt-4">
                    <div className="panel-header p-4 border-b border-line"><span className="section-label">轉帳紀錄</span></div>
                    <div className="px-4.5">
                      {(currentGroup?.transfers.length || 0) === 0 ? (
                        <div className="text-center py-8 text-ink-3 text-xs tracking-wider">尚無轉帳紀錄</div>
                      ) : (
                        [...(currentGroup?.transfers || [])]
                          .sort((a, b) => {
                            const dateCmp = (b.date || '').localeCompare(a.date || '');
                            if (dateCmp !== 0) return dateCmp;
                            return b.createdAt - a.createdAt;
                          })
                          .map(t => (
                            <button
                              type="button"
                              key={t.id}
                              onClick={() => { setSelectedTransfer(t); toggleModal('transferDetail', true); }}
                              className="w-[calc(100%+2.25rem)] text-left py-3 border-b border-line last:border-b-0 flex items-center gap-2.5 cursor-pointer hover:bg-paper-2 focus-visible:bg-paper-2 -mx-4.5 px-4.5"
                            >
                              <ArrowRight size={14} className="text-ink-4 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-[14px] font-medium text-ink truncate">
                                  {t.from} <span className="text-ink-3 font-normal text-[12px] mx-1">轉給</span> {t.to}
                                </div>
                                <div className="text-[11px] text-ink-3 mt-0.5 truncate">
                                  {t.date ? utils.fmtDate(t.date) : ''}{t.note ? ` · ${t.note}` : ''}
                                </div>
                              </div>
                              <div className="ml-auto text-right shrink-0">
                                <div className="text-[17px] font-medium tracking-[0.5px]">NT${utils.fmt(t.amount)}</div>
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'members' && (
                <div className="panel">
                  <div className="panel-header p-4 border-b border-line"><span className="section-label">群組成員</span></div>
                  <div className="p-4.5">
                    <div className="bg-paper-2 border border-line p-3 flex items-center justify-between mb-3 rounded-xl">
                      <div>
                        <div className="text-xs text-ink-2 mb-1">邀請碼</div>
                        <div className="font-mono text-xl tracking-[6px] text-ink">{currentGroup?.code}</div>
                      </div>
                      <button className="btn btn-sm" onClick={async () => {
                        try { await navigator.clipboard.writeText(currentGroup?.code || ''); showToast('邀請碼已複製'); }
                        catch { showToast('無法自動複製，請長按邀請碼複製'); }
                      }}><Copy size={14} className="mr-1" /> 複製</button>
                    </div>
                    <div className="text-sm text-ink-3 mb-4 leading-relaxed">將邀請碼分享給朋友，他們即可加入此群組</div>

                    <div className="flex flex-col">
                      {currentGroup?.members.map(m => (
                        <div key={m} className="flex items-center py-3 border-b border-line last:border-b-0 gap-3">
                          <div className="member-avatar" aria-hidden="true">{m.charAt(0)}</div>
                          <div className="flex-1 min-w-0 text-sm font-medium break-words">{m} {m === myName && <span className="text-xs text-ink-3 font-normal">（我）</span>}</div>
                          {isOwner && currentGroup.members.length > 1 && m !== myName && (
                            <button className="icon-btn" aria-label={'移除 ' + m} onClick={() => removeMember(m)}><X size={14} /></button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-4">
                      <label className="field-label" htmlFor="newMemberInput">新增成員姓名</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          id="newMemberInput"
                          disabled={!!currentGroup?.security && !isOwner}
                          placeholder="姓名"
                          className="flex-1"
                          maxLength={12}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                              addMember((e.target as HTMLInputElement).value);
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                        <button className="btn btn-sm btn-primary" disabled={!!currentGroup?.security && !isOwner} onClick={() => {
                          const input = document.getElementById('newMemberInput') as HTMLInputElement;
                          addMember(input.value);
                          input.value = '';
                        }}>新增</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </main>
          </div>
        )}

      {/* Modals */}
      <>
        {modals.createGroup && (
          <Modal title="新增帳本" onClose={() => { if (!isSaving) toggleModal('createGroup', false); }}>
            <div className="ledger-kind-options" role="group" aria-label="帳本類型">
              {([{kind:'personal',label:'個人帳本',detail:'自己的日常花費',icon:NotebookPen},{kind:'shared',label:'共用帳本',detail:'和朋友一起分帳',icon:Users}] as const).map(option => <button key={option.kind} type="button" className="ledger-kind-option" aria-pressed={newGroupKind === option.kind} disabled={isSaving} onClick={() => { setNewGroupKind(option.kind); setFormError(''); if (newGroupName === '日常記帳' && option.kind === 'shared') setNewGroupName(''); if (!newGroupName && option.kind === 'personal') setNewGroupName('日常記帳'); }}><option.icon size={22} aria-hidden="true" /><span>{option.label}</span><small>{option.detail}</small></button>)}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="create-group-name">帳本名稱</label>
              <input id="create-group-name" type="text" value={newGroupName} onChange={e => { setNewGroupName(e.target.value); setFormError(''); }} placeholder={newGroupKind === 'personal' ? '例：日常記帳' : '例：京都旅行'} maxLength={20} autoComplete="off" disabled={isSaving} />
            </div>
            {newGroupKind === 'shared' ? <div className="field">
              <label className="field-label" htmlFor="create-member-name">你的名字</label>
              <input id="create-member-name" type="text" value={newGroupMyName} onChange={e => { setNewGroupMyName(e.target.value); setFormError(''); }} placeholder="你在群組中的顯示名稱" maxLength={12} autoComplete="name" />
            </div> : <p className="text-xs text-ink-3 leading-relaxed mb-4">個人帳本只供自己使用。建立後可開啟「帳本同步」，讓 Safari 與桌面 App 連回同一本帳本。</p>}
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('createGroup', false)} disabled={isSaving}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={createGroup} disabled={isSaving}>{isSaving ? '建立中…' : '建立'}</button>
            </div>
          </Modal>
        )}

        {modals.joinGroup && (
          <Modal title="加入共用帳本" onClose={() => toggleModal('joinGroup', false)}>
            <div className="field">
              <label className="field-label" htmlFor="join-code">邀請碼（6 位數字）</label>
              <input id="join-code" data-autofocus type="text" inputMode="numeric" pattern="[0-9]*" value={joinCode} onChange={e => { setJoinCode(e.target.value.replace(/\D/g, '')); setFormError(''); }} placeholder="123456" maxLength={6} className="text-xl tracking-[6px] font-mono" autoComplete="one-time-code" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="join-member-name">你的名字</label>
              <input id="join-member-name" type="text" value={joinMyName} onChange={e => { setJoinMyName(e.target.value); setFormError(''); }} placeholder="你在群組中的顯示名稱" maxLength={12} autoComplete="name" />
            </div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('joinGroup', false)} disabled={isSaving}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={joinGroup} disabled={isSaving}>{isSaving ? '加入中…' : '加入'}</button>
            </div>
          </Modal>
        )}

        {modals.addRecord && currentGroup && (
          <RecordEditor group={currentGroup} myName={myName}
            notice={personal&&!isEditingExpense?<EntryKindTabs kind="expense" onKind={choosePersonalEntry}/>:undefined}
            initial={{ recordType, expense: expForm, transfer: tfForm, expenseId: isEditingExpense ? selectedExpense?.id : undefined, transferId: isEditingTransfer ? selectedTransfer?.id : undefined }}
            isSaving={isSaving} error={formError} clearError={() => setFormError('')}
            onClose={() => toggleModal('addRecord', false)} onExpense={addExpense} onTransfer={addTransfer} />
        )}

        {modals.groupSettings && (
          <Modal title={personal ? '帳本設定' : '群組設定'} onClose={() => toggleModal('groupSettings', false)}>
            {!personal && currentGroup && <PersonalLedgerSyncSettings group={currentGroup} myName={myName} books={myGroups} onAccount={() => { toggleModal('groupSettings', false); setAccountSettings(true); }} />}
            <button type="button" className="btn btn-primary w-full mb-4" onClick={openBankSettings}>銀行與卡片設定</button>
            <button type="button" className="btn w-full mb-4" onClick={() => { toggleModal('groupSettings', false); setAccountSettings(true); }}>帳本同步 · 連結 Safari 與桌面 App</button>
            <p className="text-xs text-ink-3 leading-relaxed mb-4">{personal ? '這是只有你能存取的個人帳本，可記錄日常支出並查看分類統計。先開啟「帳本同步」，換到 Safari 或新裝置時登入同一帳號即可存取原本帳本。未連結前請保留此 App 資料。' : currentGroup?.security ? (isOwner ? '你是此群組的群主。成員可記帳與編輯帳目；群組名稱及成員管理限群主。' : '你是群組成員，可記帳與編輯帳目；群組名稱及成員管理限群主。') : '這是舊版群組，尚未啟用身分綁定；現有記帳與邀請碼維持正常。安全升級須由管理者核對群主裝置，不能只用名字認領。'}</p>
            {!personal && <p className="text-xs text-ink-3 mb-4 break-all">此裝置識別碼：{deviceUid || '連線後取得'}<br />裝置身分不包含在備份內。請勿清除網站資料，以免失去群主綁定。</p>}
            <div className="field">
              <label className="field-label">帳本名稱</label>
              <input type="text" value={settingsGroupName} onChange={e => setSettingsGroupName(e.target.value)} maxLength={20} disabled={!!currentGroup?.security && !isOwner} />
            </div>
            <div className="mt-2">
              <button type="button" className="btn w-full mb-2" onClick={() => { toggleModal('groupSettings', false); setDataSettings(true); }}>資料備份、匯出與 App 更新</button>
              {!personal && <button className="btn btn-danger btn-sm w-full" onClick={leaveGroup}>離開群組</button>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('groupSettings', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={saveGroupSettings} disabled={isSaving || (!!currentGroup?.security && !isOwner)}>{isSaving ? '同步中…' : '儲存'}</button>
            </div>
            {currentGroup && <HistoryLog group={currentGroup} />}
            {personal && isOwner && <div className="ledger-delete-entry"><p>刪除會移除這本個人帳本與所有記錄，下一步會再次確認。</p><button type="button" className="btn btn-danger w-full" onClick={() => { setDeleteError(''); setDeleteTarget(currentGroup); toggleModal('groupSettings', false); }}>刪除個人帳本</button></div>}
          </Modal>
        )}

        {modals.expenseDetail && selectedExpense && (
          <Modal title="費用詳情" onClose={() => toggleModal('expenseDetail', false)}>
            <div className="mb-4.5">
              <div className="text-xl font-medium mb-1">{selectedExpense.desc}</div>
              <div className="text-xs text-ink-3 mb-2">{categoryLabel(selectedExpense.category)}</div>
              <div className="text-2xl font-medium tracking-tight mb-3">NT$ {utils.fmt(selectedExpense.amount)}</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="field-label">日期</div>
                  <div className="text-sm">{selectedExpense.date ? utils.fmtDate(selectedExpense.date) : '未設定'}</div>
                </div>
                {!personal && <div>
                  <div className="field-label">付款人</div>
                  <div className="text-sm">{selectedExpense.payer}</div>
                </div>}
                {!personal && <div>
                  <div className="field-label">分攤方式</div>
                  <div className="text-sm">{utils.buildSplitDesc(selectedExpense)}</div>
                </div>}
                <div>
                  <div className="field-label">建立時間</div>
                  <div className="text-xs text-ink-3">{new Date(selectedExpense.createdAt).toLocaleString('zh-TW')}</div>
                </div>
              </div>
              {!personal && <><div className="field-label mb-2">各人分攤金額</div>
              <div className="flex flex-col">
                {selectedExpense.splitMode === 'equal' ? (
                  utils.equalShares(selectedExpense.amount, selectedExpense.participants).map(share => (
                    <div key={share.name} className="flex justify-between py-1.5 border-b border-line text-sm">
                      <span>{share.name}</span><span>NT$ {utils.fmt(share.amount)}</span>
                    </div>
                  ))
                ) : (
                  selectedExpense.shares?.map(s => (
                    <div key={s.name} className="flex justify-between py-1.5 border-b border-line text-sm">
                      <span>{s.name}</span><span>NT$ {utils.fmt(s.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </>}
            </div>
            <RecordProvenance record={selectedExpense}/>
            {currentGroup && <HistoryLog group={currentGroup} target={selectedExpense.id} />}
            {personal && selectedExpense.sharedSource && <div className="shared-source-detail"><strong>來自 {selectedExpense.sharedSource.groupName}</strong><p>整筆 NT$ {utils.fmt(selectedExpense.sharedSource.totalAmount)} · {selectedExpense.sharedSource.payer}先付</p><p>這裡記錄你的分攤；金額、說明與分類跟隨原始分帳更新。</p></div>}
            {personal && currentGroup && possibleBankMatches(selectedExpense, currentGroup).map(bank => <div className="shared-match-notice" key={bank.id}><strong>這筆銀行入帳可能重複</strong><p>{bank.desc} · {bank.date}<br />已入帳 NT$ {utils.fmt(bank.amount)}，分攤 NT$ {utils.fmt(selectedExpense.amount)}</p>{bankMergeId === bank.id ? <><p>確認是同一筆消費後，銀行全額記錄將合併至分帳，個人支出只計入分攤金額。</p><div className="flex flex-col gap-2"><button type="button" className="btn btn-primary btn-sm" disabled={isSaving} onClick={() => void mergeBankExpense(bank.id, selectedExpense)}>確認同一筆，合併入帳</button><button type="button" className="btn btn-sm" onClick={() => setBankMergeId('')}>保留兩筆</button></div></> : <button type="button" className="btn btn-sm" onClick={() => setBankMergeId(bank.id)}>核對並合併</button>}</div>)}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="flex flex-col gap-2 mt-2">
              {personal && selectedExpense.sharedSource ? <button type="button" className="btn btn-primary w-full" disabled={isSaving} onClick={() => void openSharedSource(selectedExpense)}>前往原始分帳</button> : <><button className="btn btn-primary w-full" onClick={() => openEditExpense(selectedExpense)}>
                編輯此筆費用
              </button>
              <button className="btn btn-ghost w-full" onClick={() => duplicateExpense(selectedExpense)}>
                <Copy size={14} className="mr-1.5" /> 複製為新費用
              </button>
              <button className="btn btn-danger w-full" onClick={() => removeExpense(selectedExpense.id)}>
                <Trash2 size={14} className="mr-1.5" /> 刪除此筆費用
              </button>
              </>}
            </div>
          </Modal>
        )}

        {modals.transferDetail && selectedTransfer && (
          <Modal title="轉帳詳情" onClose={() => toggleModal('transferDetail', false)}>
            <div className="mb-4.5">
              <div className="flex items-center gap-2 text-xl font-medium mb-1">
                {selectedTransfer.from} <ArrowRight size={16} className="text-ink-3" /> {selectedTransfer.to}
              </div>
              <div className="text-2xl font-medium tracking-tight mb-3">NT$ {utils.fmt(selectedTransfer.amount)}</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="field-label">日期</div>
                  <div className="text-sm">{selectedTransfer.date ? utils.fmtDate(selectedTransfer.date) : '未設定'}</div>
                </div>
                <div>
                  <div className="field-label">建立時間</div>
                  <div className="text-xs text-ink-3">{new Date(selectedTransfer.createdAt).toLocaleString('zh-TW')}</div>
                </div>
                {selectedTransfer.note && (
                  <div className="col-span-2">
                    <div className="field-label">備註</div>
                    <div className="text-sm">{selectedTransfer.note}</div>
                  </div>
                )}
              </div>
            </div>
            {currentGroup && <HistoryLog group={currentGroup} target={selectedTransfer.id} />}
            <div className="flex flex-col gap-2 mt-2">
              <button className="btn btn-primary w-full" onClick={() => openEditTransfer(selectedTransfer)}>
                編輯此筆轉帳
              </button>
              <button className="btn btn-danger w-full" onClick={() => removeTransfer(selectedTransfer.id)}>
                <Trash2 size={14} className="mr-1.5" /> 刪除此筆轉帳
              </button>
            </div>
          </Modal>
        )}
      </>
      {cashflowEditor&&currentGroup&&personal&&<React.Fragment key={cashflowEditor.kind+':'+(cashflowEditor.record?.id||'new')}><CashflowEditor code={currentGroup.code} myName={myName} kind={cashflowEditor.kind} record={cashflowEditor.record} busy={isSaving} error={formError} clearError={()=>setFormError('')} onClose={()=>setCashflowEditor(null)} onKind={choosePersonalEntry} onSave={saveCashflow}/></React.Fragment>}
      {selectedCashflow&&currentGroup&&personal&&<Modal title={selectedCashflow.kind==='income'?'收入詳情':'儲蓄詳情'} onClose={()=>setSelectedCashflow(null)}><h3 className="text-xl font-medium mb-3">{selectedCashflow.record.desc}</h3><div className={`money text-2xl mb-4 ${selectedCashflow.kind==='income'?'finance-income':''}`}>NT$ {utils.fmt(selectedCashflow.record.amount)}</div><p className="text-sm mb-4">{utils.fmtDate(selectedCashflow.record.date)}</p>{selectedCashflow.kind==='saving'&&<p className="text-sm text-ink-2 mb-4">{'direction' in selectedCashflow.record&&selectedCashflow.record.direction==='in'?'從儲蓄轉回':'存入儲蓄'} · 資金移轉，不計入收入或消費支出</p>}<RecordProvenance record={selectedCashflow.record}/><HistoryLog group={currentGroup} target={selectedCashflow.record.id}/><div className="flex flex-col gap-2 mt-4"><button type="button" className="btn btn-primary" onClick={()=>{setCashflowEditor(selectedCashflow);setSelectedCashflow(null);setFormError('');}}>編輯這筆{selectedCashflow.kind==='income'?'收入':'儲蓄'}</button><button type="button" className="btn btn-danger" onClick={()=>void removeCashflow(selectedCashflow.record,selectedCashflow.kind)}>刪除這筆{selectedCashflow.kind==='income'?'收入':'儲蓄'}</button></div></Modal>}
      {dataSettings && <DataSettings group={currentPage === 'group' ? currentGroup : null} onClose={() => setDataSettings(false)} onOpenBankInstallation={openBankInstallation} />}
      {bankSettings && currentGroup && <Modal title="銀行與卡片設定" onClose={() => setBankSettings(false)}><React.Fragment key={currentGroup.code}><BankShortcutSettings group={currentGroup} /></React.Fragment></Modal>}
      {accountSettings && <Modal title="連結原本帳本" onClose={() => { if (!accountSync.getSnapshot().busy) setAccountSettings(false); }}><AccountSyncSettings /></Modal>}
      {homeInboxSelect && <Modal title="選擇待確認帳本" onClose={() => setHomeInboxSelect(false)}><div className="space-y-3">{inboxBooks.map(item => <button type="button" className="btn w-full justify-between" key={item.book.code} onClick={() => { enterGroup(item.group, item.book.myName); setHomeInboxSelect(false); setBankInboxOpen(true); }}><span>{item.group.name}</span><span>{item.group.bankInbox?.length || 0} 筆待確認</span></button>)}</div></Modal>}
      {bankInboxOpen && currentGroup && <BankInbox group={currentGroup} myName={myName} onClose={() => setBankInboxOpen(false)} onSaved={(message, date) => { if (date) setRecordMonth(date.slice(0,7)); showToast(message); }} />}
      {deleteTarget && <DeleteLedgerDialog group={deleteTarget} pending={sync.getStatus(deleteTarget.code).pending} connected={sync.getStatus(deleteTarget.code).connected} busy={isDeletingLedger} error={deleteError} onClose={() => { if (!deleteLock.current) setDeleteTarget(null); }} onConfirm={deletePersonalLedger} />}
      {bankInputs[0] && !dataSettings && !bankSettings && !accountSettings && !deleteTarget && (!bankInputs[0].setup || !bankInputInBackground) && <React.Fragment key={bankInputs[0].key}>{bankInputs[0].setup ? <BankSetup setup={bankInputs[0].setup} groups={myGroups} currentGroup={currentGroup} onClose={() => setBankInputs(queue => queue.slice(1))} onCreateLedger={() => { setNewGroupKind('personal'); setNewGroupName('日常記帳'); toggleModal('createGroup', true); }} /> : <BankImport input={bankInputs[0]} background={bankInputInBackground} onClose={() => setBankInputs(queue => queue.slice(1))} onGroup={(group, name, date) => { if (!bankInputInBackground) enterGroup(group, name, date); }} onSaved={showToast} />}</React.Fragment>}
      {updates.available && <div className="app-update-banner" role="status">
        <span className="text-xs">有新版可更新，待同步資料會保留</span><button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => appUpdates.update()}>更新</button>
      </div>}

      {/* Toast */}
      <div
        className={`app-toast ${toast ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        role="status"
        aria-live="polite"
      >
        <span>{toast?.message}</span>
        {toast?.onAction && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-paper underline underline-offset-4 font-medium whitespace-nowrap min-h-11"
            onClick={toast.onAction}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {toast.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
