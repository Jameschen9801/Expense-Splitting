import type { BankDraft, Expense, ExpenseCategory } from '../types';
import type { ExpenseForm } from './drafts';
import { categories } from './categories';
import { utils } from './utils';

export const bankDraftOwner = (name: string, id: string) => name + ':bank:' + id;
export const pendingDescription = (desc: string) => ['銀行消費（待補說明）', '銀行刷卡消費'].includes(desc);
export function bankDraftExpense(draft: BankDraft, form: ExpenseForm): Expense {
  if (!form.desc.trim() || pendingDescription(form.desc.trim())) throw new Error('請填寫消費說明');
  if (!categories.some(item => item.id === form.category)) throw new Error('請選擇分類');
  const amount = Number(form.amount), date = new Date(form.date + 'T00:00:00Z');
  if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 1e9 || !/^\d+(?:\.\d{1,2})?$/.test(form.amount.trim())) throw new Error('請填寫有效金額，最多兩位小數');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== form.date) throw new Error('請填寫有效日期');
  const { bank, last4, ...expense } = draft;
  return { ...expense, desc: form.desc.trim().slice(0,30), amount: utils.fromCents(utils.toCents(amount)), date: form.date, category: form.category as ExpenseCategory };
}
