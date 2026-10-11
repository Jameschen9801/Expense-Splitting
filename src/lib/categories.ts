import type { Expense, ExpenseCategory } from '../types';
import { utils } from './utils';

export const categories: { id: ExpenseCategory; label: string }[] = [
  { id: 'food', label: '餐飲' }, { id: 'transport', label: '交通' }, { id: 'stay', label: '住宿' },
  { id: 'shopping', label: '購物' }, { id: 'entertainment', label: '娛樂' }, { id: 'bills', label: '生活帳單' },
  { id: 'other', label: '其他' },
];
export const categoryLabel = (id?: ExpenseCategory) => categories.find(category => category.id === id)?.label || '其他';
export const categoryOf = (expense: Expense) => expense.category || 'other';

export function summarizeExpenses(expenses: Expense[], myName: string, month = '') {
  const buckets = new Map(categories.map(category => [category.id, { ...category, totalCents: 0, mineCents: 0, count: 0 }]));
  let totalCents = 0, mineCents = 0, paidCents = 0, count = 0;
  for (const expense of expenses) {
    if (month && !expense.date?.startsWith(`${month}-`)) continue;
    const cents = utils.toCents(expense.amount);
    const shares = expense.splitMode === 'equal' ? utils.equalShares(expense.amount, expense.participants) : expense.shares || [];
    const mine = utils.toCents(shares.find(share => share.name === myName)?.amount || 0);
    const bucket = buckets.get(categoryOf(expense)) || buckets.get('other')!;
    bucket.totalCents += cents; bucket.mineCents += mine; bucket.count++;
    totalCents += cents; mineCents += mine; count++;
    if (expense.payer === myName) paidCents += cents;
  }
  return { total: utils.fromCents(totalCents), mine: utils.fromCents(mineCents), paid: utils.fromCents(paidCents), count,
    categories: [...buckets.values()].filter(bucket => bucket.count).sort((a, b) => b.totalCents - a.totalCents)
      .map(bucket => ({ ...bucket, total: utils.fromCents(bucket.totalCents), mine: utils.fromCents(bucket.mineCents) })),
  };
}
