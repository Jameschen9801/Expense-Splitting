import type { Expense, Group, Transfer } from '../types';

export type GroupChange =
  | { type: 'expense.put'; expense: Expense }
  | { type: 'expense.remove'; id: string }
  | { type: 'transfer.put'; transfer: Transfer }
  | { type: 'transfer.remove'; id: string }
  | { type: 'member.add'; name: string }
  | { type: 'member.remove'; name: string }
  | { type: 'group.rename'; name: string };

export type PendingChange = { id: string; groupCode: string; change: GroupChange };

// Applying a queued operation more than once must never duplicate a record.
export function applyChange(group: Group, change: GroupChange): Group {
  switch (change.type) {
    case 'expense.put': return { ...group, expenses: [...group.expenses.filter(e => e.id !== change.expense.id), change.expense] };
    case 'expense.remove': return { ...group, expenses: group.expenses.filter(e => e.id !== change.id) };
    case 'transfer.put': return { ...group, transfers: [...group.transfers.filter(t => t.id !== change.transfer.id), change.transfer] };
    case 'transfer.remove': return { ...group, transfers: group.transfers.filter(t => t.id !== change.id) };
    case 'member.add': return { ...group, members: group.members.includes(change.name) ? group.members : [...group.members, change.name] };
    case 'member.remove': return { ...group, members: group.members.filter(name => name !== change.name) };
    case 'group.rename': return { ...group, name: change.name };
  }
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
}
