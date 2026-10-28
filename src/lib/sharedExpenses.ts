import type { BankDraft, Expense, Group } from '../types';
import type { GroupChange } from './outbox';
import { utils } from './utils';

export function memberExpenseAmount(expense: Expense, name: string): number {
  if (!expense.participants.includes(name)) return 0;
  const shares = expense.splitMode === 'equal' ? utils.equalShares(expense.amount, expense.participants) : expense.shares || [];
  return shares.find(share => share.name === name)?.amount || 0;
}

export async function sharedExpenseId(code: string, id: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([code, id])));
  return 'eshared_' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function projectSharedExpenses(source: Group, targetName: string, memberName: string): Promise<Expense[]> {
  return Promise.all(source.expenses.filter(expense => utils.toCents(memberExpenseAmount(expense, memberName)) > 0).map(async expense => ({
    id: await sharedExpenseId(source.code, expense.id), desc: expense.desc,
    amount: memberExpenseAmount(expense, memberName), date: expense.date, category: expense.category || 'other',
    payer: targetName, participants: [targetName], splitMode: 'equal' as const, createdAt: expense.createdAt,
    sharedSource: { groupCode: source.code, groupName: source.name, expenseId: expense.id, memberName,
      totalAmount: expense.amount, payer: expense.payer },
  })));
}

const content = (expense: Expense) => JSON.stringify([expense.desc, expense.amount, expense.date, expense.category || 'other',
  expense.payer, expense.participants, expense.splitMode, expense.sharedSource]);

export function sharedExpenseChanges(target: Group, code: string, projected: Expense[]): GroupChange[] {
  const desired = new Map(projected.map(expense => [expense.id, expense]));
  const existing = new Map(target.expenses.filter(expense => expense.sharedSource?.groupCode === code).map(expense => [expense.id, expense]));
  return [
    ...projected.flatMap(expense => {
      const before = existing.get(expense.id);
      if (!before && target.expenses.some(row => row.id === expense.id)) throw new Error('同步編號與個人記錄重複，原記錄已保留');
      return before && content(before) === content(expense) ? [] : [{ type: 'expense.put' as const, expense }];
    }),
    ...[...existing.values()].filter(expense => !desired.has(expense.id)).map(expense => ({ type: 'expense.remove' as const, id: expense.id })),
  ];
}

// Amount/date alone can only suggest a match. A person must confirm the link.
// Compare the card charge to the full payment, even when one's share is smaller.
export function possibleSharedMatches(bank: Pick<BankDraft, 'amount'|'date'>, expenses: Expense[], bankId?: string): Expense[] {
  return expenses.filter(expense => expense.id !== bankId && expense.sharedSource
    && expense.sharedSource.payer === expense.sharedSource.memberName
    && expense.date === bank.date && utils.toCents(expense.sharedSource.totalAmount) === utils.toCents(bank.amount));
}

export function possibleBankMatches(shared: Expense, group: Group): Expense[] {
  if (!shared.sharedSource) return [];
  return group.expenses.filter(expense => expense.id.startsWith('ebank_') && !expense.sharedSource
    && !group.bankLinks?.[expense.id] && possibleSharedMatches(expense, [shared]).length > 0);
}
