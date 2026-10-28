import type { BankDraft, Expense, Group, MutationMeta, Transfer } from '../types';
import { auditEntry, fingerprint, RecordConflictError, updatedRecord } from './audit';
import { assertLedgerChange } from './ledgers';
import { possibleSharedMatches } from './sharedExpenses';

export type GroupChange = (
  | { type: 'expense.put'; expense: Expense }
  | { type: 'expense.remove'; id: string }
  | { type: 'transfer.put'; transfer: Transfer }
  | { type: 'transfer.remove'; id: string }
  | { type: 'bankDraft.put'; draft: BankDraft }
  | { type: 'bankDraft.confirm'; id: string; expense: Expense }
  | { type: 'bankDraft.remove'; id: string }
  | { type: 'bankDraft.link'; id: string; expenseId: string }
  | { type: 'expense.linkBank'; id: string; expenseId: string }
  | { type: 'member.add'; name: string }
  | { type: 'member.remove'; name: string }
  | { type: 'group.rename'; name: string }) & { meta?: MutationMeta };

export type PendingChange = { id: string; groupCode: string; change: GroupChange };
export const changeEntityId = (change: GroupChange) => change.type === 'bankDraft.put' ? change.draft.id
  : change.type === 'expense.put' ? change.expense.id : change.type === 'transfer.put' ? change.transfer.id : 'id' in change ? change.id : '';
export const changeRecord = (group: Group, change: GroupChange) => (change.type.startsWith('bankDraft.') ? group.bankInbox || []
  : change.type.startsWith('expense.') ? group.expenses : group.transfers).find(record => record.id === changeEntityId(change));

// Applying a queued operation more than once must never duplicate a record.
export function applyChange(group: Group, change: GroupChange): Group {
  assertLedgerChange(group, change);
  if (change.meta && Object.hasOwn(group.history || {}, change.meta.id)) return group;
  const target = changeEntityId(change) || ('name' in change ? change.name : group.code);
  const before = change.type.startsWith('bankDraft.') ? changeRecord(group, change)
    : change.type.startsWith('expense.') ? group.expenses.find(record => record.id === target)
    : change.type.startsWith('transfer.') ? group.transfers.find(record => record.id === target)
    : change.type === 'group.rename' ? group.name : change.type === 'member.remove' ? change.name : undefined;
  // A protected record is published before its separate audit append. Do not
  // reapply that in-flight mutation and invent another optimistic revision.
  if (change.meta && before && typeof before === 'object' && before.lastMutationId === change.meta.id) return group;
  let next: Group;
  switch (change.type) {
    case 'bankDraft.put': {
      if (group.expenses.some(record => record.id === target) || group.bankReceiptIds?.includes(target)) return group;
      next = { ...group, bankInbox: [...group.bankInbox || [], updatedRecord(change.draft, undefined, change.meta)], bankReceiptIds: [...new Set([...(group.bankReceiptIds || []), target])] };
      break;
    }
    case 'bankDraft.confirm': {
      if (!group.bankInbox?.some(record => record.id === target) || group.expenses.some(record => record.id === target)) return group;
      next = { ...group, bankInbox: group.bankInbox.filter(record => record.id !== target), bankReceiptIds: [...new Set([...(group.bankReceiptIds || []), target])], expenses: [...group.expenses, updatedRecord(change.expense, before as Expense, change.meta)] };
      break;
    }
    case 'bankDraft.remove': next = { ...group, bankInbox: (group.bankInbox || []).filter(record => record.id !== target), bankReceiptIds: [...new Set([...(group.bankReceiptIds || []), target])] }; break;
    case 'bankDraft.link': case 'expense.linkBank': {
      const bank = change.type === 'bankDraft.link' ? group.bankInbox?.find(record => record.id === change.id) : group.expenses.find(record => record.id === change.id);
      if (!bank && group.bankLinks?.[change.id] === change.expenseId) return group;
      const linked = group.expenses.find(record => record.id === change.expenseId);
      if (!bank || !linked || change.type === 'expense.linkBank' && (!bank.id.startsWith('ebank_') || bank.sharedSource)
        || !possibleSharedMatches(bank, [linked]).length) return group; // Keep an obsolete offline intent from breaking the visible inbox.
      next = { ...group, bankLinks: { ...group.bankLinks, [change.id]: change.expenseId },
        ...(change.type === 'bankDraft.link' ? { bankInbox: (group.bankInbox || []).filter(record => record.id !== change.id),
          bankReceiptIds: [...new Set([...(group.bankReceiptIds || []), change.id])] }
          : { expenses: group.expenses.filter(record => record.id !== change.id) }) };
      break;
    }
    case 'expense.put': next = { ...group, expenses: [...group.expenses.filter(e => e.id !== change.expense.id), updatedRecord(change.expense, before as Expense | undefined, change.meta)] }; break;
    case 'expense.remove': next = { ...group, expenses: group.expenses.filter(e => e.id !== change.id) }; break;
    case 'transfer.put': next = { ...group, transfers: [...group.transfers.filter(t => t.id !== change.transfer.id), updatedRecord(change.transfer, before as Transfer | undefined, change.meta)] }; break;
    case 'transfer.remove': next = { ...group, transfers: group.transfers.filter(t => t.id !== change.id) }; break;
    case 'member.add': next = { ...group, members: group.members.includes(change.name) ? group.members : [...group.members, change.name] }; break;
    case 'member.remove': next = { ...group, members: group.members.filter(name => name !== change.name) }; break;
    case 'group.rename': next = { ...group, name: change.name }; break;
  }
  if (change.meta) {
    const after = change.type === 'bankDraft.put' ? change.draft : change.type === 'bankDraft.confirm' ? change.expense : change.type === 'expense.put' ? change.expense : change.type === 'transfer.put' ? change.transfer
      : change.type === 'bankDraft.link' || change.type === 'expense.linkBank' ? group.expenses.find(record => record.id === change.expenseId)
      : change.type === 'group.rename' || change.type === 'member.add' ? change.name : undefined;
    const entry = auditEntry(change.type, target, before, after, change.meta);
    next.history = Object.fromEntries(Object.values({ ...group.history, [entry.id]: entry })
      .sort((a, b) => b.at - a.at).slice(0, 300).map(entry => [entry.id, entry]));
  }
  return next;
}

export function applyCloudChange(group: Group, change: GroupChange): Group {
  if (change.meta && Object.hasOwn(group.history || {}, change.meta.id)) return group;
  const target = changeEntityId(change);
  if (change.type === 'bankDraft.link' || change.type === 'expense.linkBank') {
    if (group.bankLinks?.[change.id] === change.expenseId) return group;
    const bank = changeRecord(group, change), linked = group.expenses.find(expense => expense.id === change.expenseId);
    if (!bank || !('desc' in bank) || !linked || change.type === 'expense.linkBank' && (!bank.id.startsWith('ebank_') || bank.sharedSource)
      || !possibleSharedMatches(bank, [linked]).length) throw new RecordConflictError(group, target);
  }
  if (change.type === 'bankDraft.put' && (group.bankReceiptIds?.includes(target) || group.expenses.some(record => record.id === target))) return group;
  if (change.type === 'bankDraft.confirm' && group.expenses.some(record => record.id === target)) return group;
  if (change.type === 'bankDraft.remove' && !group.bankInbox?.some(record => record.id === target) && group.bankReceiptIds?.includes(target)) return group;
  if (target && change.meta && 'expected' in change.meta) {
    if ((change.type === 'bankDraft.link' || change.type === 'expense.linkBank') && group.bankLinks?.[change.id] === change.expenseId) return group;
    const current = changeRecord(group, change);
    if (current?.lastMutationId === change.meta.id) return group;
    const restored = change.type === 'bankDraft.put' ? change.draft : change.type === 'expense.put' ? change.expense : change.type === 'transfer.put' ? change.transfer : undefined;
    if (change.meta.expected === null && restored && fingerprint(current) === fingerprint(restored)) return group;
    if (fingerprint(current) !== change.meta.expected) throw new RecordConflictError(group, target);
  }
  return applyChange(group, change);
}

export function overlayPending(group: Group, pending: PendingChange[]): Group {
  return pending.filter(item => item.groupCode === group.code).reduce((result, item) => applyChange(result, item.change), group);
}

export class Outbox {
  private key = 'warikan_outbox_v1';
  constructor(private store: Pick<Storage, 'getItem' | 'setItem'>) {}

  list(): PendingChange[] {
    const raw = this.store.getItem(this.key);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('待同步資料格式錯誤');
    return data;
  }

  enqueue(groupCode: string, change: GroupChange): PendingChange {
    const item = { id: crypto.randomUUID(), groupCode, change };
    this.store.setItem(this.key, JSON.stringify([...this.list(), item]));
    return item;
  }

  acknowledge(id: string) {
    this.store.setItem(this.key, JSON.stringify(this.list().filter(item => item.id !== id)));
  }
  replace(id: string, change: GroupChange) {
    this.store.setItem(this.key, JSON.stringify(this.list().map(item => item.id === id ? { ...item, change } : item)));
  }
  discardEntity(code: string, targetId: string) {
    this.store.setItem(this.key, JSON.stringify(this.list().filter(item => {
      const change = item.change;
      const id = changeEntityId(change);
      return item.groupCode !== code || id !== targetId;
    })));
  }
}
