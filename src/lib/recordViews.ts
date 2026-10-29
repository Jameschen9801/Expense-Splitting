import type { Expense, Group, Income, Saving, Transfer } from '../types';
import { categoryLabel, categoryOf } from './categories';
import { memberExpenseAmount } from './sharedExpenses';
import { utils } from './utils';

export type RecordItem = (Expense & { type: 'expense' }) | (Transfer & { type: 'transfer' }) | (Income & { type: 'income' }) | (Saving & { type: 'saving' });
export type RecordQuery = { period?: string; category?: string; search?: string; scope?: 'all' | 'mine' | 'paid'; tag?: string };
export type StatisticsDetail = { period: string; category: string; tag?: string };

export function matchesRecordPeriod(date: string, period = '') {
  return !period || (period.length === 10 ? date === period : date?.startsWith(period + '-'));
}
export function recordGroups(group: Group, myName: string, query: RecordQuery = {}): Record<string, RecordItem[]> {
  const search = query.search?.trim().toLocaleLowerCase('zh-TW') || '';
  const rows: RecordItem[] = [
    ...group.expenses.map(record => ({ ...record, type: 'expense' as const })),
    ...group.transfers.map(record => ({ ...record, type: 'transfer' as const })),
    ...(group.incomes || []).map(record => ({ ...record, type: 'income' as const })),
    ...(group.savings || []).map(record => ({ ...record, type: 'saving' as const })),
  ];
  const selected = rows.filter(record => {
    if (!matchesRecordPeriod(record.date, query.period)) return false;
    if (query.category === 'expense' && record.type !== 'expense') return false;
    if (query.category === 'cashflow' && record.type !== 'expense' && record.type !== 'income') return false;
    if (query.category && !['expense','cashflow'].includes(query.category) && (record.type === 'expense' ? categoryOf(record) !== query.category : record.type !== query.category)) return false;
    if (query.tag && (!('tags' in record) || !record.tags?.includes(query.tag))) return false;
    if (query.scope === 'mine' && (record.type === 'expense' ? !record.participants.includes(myName) : record.type === 'transfer' && record.from !== myName && record.to !== myName)) return false;
    if (query.scope === 'paid' && (record.type === 'expense' ? record.payer !== myName : record.type === 'transfer' && record.from !== myName)) return false;
    if (!search) return true;
    const fields = record.type === 'transfer' ? [record.from, record.to, record.note || '']
      : [record.desc, ...record.tags || [], record.location || '', record.notes || '',
        ...(record.type === 'expense' ? [record.payer, ...record.participants, categoryLabel(record.category), record.sharedSource?.groupName || ''] : [record.type === 'income' ? '收入' : '儲蓄'])];
    return fields.some(value => value.toLocaleLowerCase('zh-TW').includes(search));
  }).sort((a,b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const result: Record<string, RecordItem[]> = {};
  for (const record of selected) (result[record.date || '未設定日期'] ||= []).push(record);
  return result;
}
export function recordTotals(records: RecordItem[], myName: string, personal = true) {
  let expenseCents = 0, incomeCents = 0;
  for (const record of records) {
    if (record.type === 'expense') expenseCents += utils.toCents(personal ? record.amount : memberExpenseAmount(record, myName));
    if (personal && record.type === 'income') incomeCents += utils.toCents(record.amount);
  }
  return { expenseCents, incomeCents, count: records.length };
}
export const resetRecordQuery = (today = utils.todayStr()) => ({ period: today.slice(0,7), day: today, category: '', search: '', scope: 'all' as const });
export function shiftRecordMonth(period: string, direction: number, today = utils.todayStr()) {
  const base = /^\d{4}-\d{2}$/.test(period) ? period : today.slice(0,7);
  const date = new Date(Date.UTC(Number(base.slice(0,4)), Number(base.slice(5))-1+direction, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
}
export function dayInMonth(month: string, anchor = utils.todayStr()) {
  const end = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(Number(anchor.slice(8)) || 1, 1), end)).padStart(2,'0')}`;
}
export const detailCategoryLabel = (category: string) => category === 'income' ? '收入' : category === 'saving' ? '儲蓄' : !category || category === 'expense' ? '支出' : categoryLabel(category as Expense['category']);
