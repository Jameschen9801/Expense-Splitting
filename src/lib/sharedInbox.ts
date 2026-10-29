import type { Expense, Group, PersonalLedgerLink, SharedDraft } from '../types';
import type { ExpenseForm } from './drafts';
import type { GroupChange } from './outbox';
import { categories } from './categories';
import { memberExpenseAmount, sharedExpenseId } from './sharedExpenses';
import { utils } from './utils';

export function validSyncDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const reviewLink = (link: PersonalLedgerLink) => link.mode === 'review' && validSyncDate(link.since);
export const legacySharedExpense = (expense: Expense) => !!expense.sharedSource && /^eshared_[a-f0-9]{64}$/.test(expense.id) && !expense.sharedSource.confirmedAt;
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');

export async function projectSharedDrafts(source: Group, targetName: string, memberName: string, since: string): Promise<SharedDraft[]> {
  if (!validSyncDate(since)) throw new Error('請選擇有效的同步起始日期');
  return Promise.all(source.expenses.filter(expense => expense.date >= since && utils.toCents(memberExpenseAmount(expense, memberName)) > 0).map(async expense => ({
    id: await sharedExpenseId(source.code, expense.id), desc: expense.desc, amount: memberExpenseAmount(expense, memberName),
    date: expense.date, category: expense.category || 'other', payer: targetName, participants: [targetName], splitMode: 'equal' as const,
    createdAt: expense.createdAt,
    sharedSource: { groupCode: source.code, groupName: source.name, expenseId: expense.id, memberName, totalAmount: expense.amount, payer: expense.payer,
      sourceVersion: await digest([expense.desc, expense.amount, expense.date, expense.category || 'other', expense.payer, expense.participants, expense.splitMode, expense.shares || []]) },
  })));
}

// Confirmed entries are personal records. Reconciliation only proposes changes;
// it never replaces someone's description/category or deletes reviewed history.
export function sharedReviewChanges(target: Group, code: string, projected: SharedDraft[], options: { cleanupLegacy?: boolean; excludedIds?: Record<string, true> } = {}): GroupChange[] {
  const changes: GroupChange[] = [];
  const expenses = new Map(target.expenses.map(expense => [expense.id, expense]));
  const drafts = new Map((target.sharedInbox || []).filter(draft => draft.sharedSource.groupCode === code).map(draft => [draft.id, draft]));
  const desired = new Set<string>();
  if (options.cleanupLegacy) for (const expense of expenses.values()) if (expense.sharedSource?.groupCode === code && legacySharedExpense(expense)) {
    changes.push({ type: 'expense.remove', id: expense.id }); expenses.delete(expense.id);
  }
  for (const incoming of projected) {
    const existing = expenses.get(incoming.id), pending = drafts.get(incoming.id), handled = target.sharedHandled?.[incoming.id];
    if (existing && existing.sharedSource?.groupCode !== code) throw new Error('來源編號與個人記錄重複，原記錄已保留');
    if (options.excludedIds?.[incoming.id] || handled?.status === 'ignored' || existing && legacySharedExpense(existing)
      || !existing && !!handled || existing?.sharedSource?.sourceVersion === incoming.sharedSource.sourceVersion) continue;
    desired.add(incoming.id);
    if (pending?.sharedSource.sourceVersion === incoming.sharedSource.sourceVersion) continue;
    const draft = existing ? { ...incoming, desc: existing.desc, category: existing.category || incoming.category } : incoming;
    changes.push({ type: 'sharedDraft.put', draft });
  }
  for (const draft of drafts.values()) if (!desired.has(draft.id)) changes.push({ type: 'sharedDraft.withdraw', id: draft.id });
  return changes;
}

export function sharedDraftExpense(draft: SharedDraft, form: ExpenseForm, at = Date.now()): Expense {
  if (!form.desc.trim() || form.desc.trim().length > 200) throw new Error('請填寫說明，最多 200 字');
  if (!categories.some(category => category.id === form.category)) throw new Error('請選擇分類');
  if (!form.amount.trim() || !/^\d+(?:\.\d{1,2})?$/.test(form.amount.trim()) || utils.toCents(Number(form.amount)) !== utils.toCents(draft.amount)) throw new Error('分攤金額請回原始共用帳本修改，再重新確認');
  if (!validSyncDate(form.date)) throw new Error('請選擇有效日期');
  return { ...draft, desc: form.desc.trim(), category: form.category, date: form.date, sharedSource: { ...draft.sharedSource, confirmedAt: at } };
}

export function possiblePersonalMatches(draft: SharedDraft, group: Group): Expense[] {
  return group.expenses.filter(expense => expense.id !== draft.id && !expense.sharedSource && !expense.id.startsWith('ebank_')
    && expense.date === draft.date && utils.toCents(expense.amount) === utils.toCents(draft.amount));
}

export function excludedOnTargetChange(previous: PersonalLedgerLink, target: Group): Record<string, true> {
  return { ...previous.excludedIds,
    ...Object.fromEntries(Object.keys(target.sharedHandled || {}).map(id => [id, true as const])),
    ...Object.fromEntries(target.expenses.filter(expense => expense.sharedSource && (!legacySharedExpense(expense) || !previous.cleanupLegacy)).map(expense => [expense.id, true as const])),
  };
}
