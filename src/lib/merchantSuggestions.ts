import type { Expense, ExpenseCategory } from '../types';
import { categories } from './categories';
import { pendingDescription } from './bankInbox';

export type MerchantHabit = { category: ExpenseCategory; count: number };
export type MerchantSuggestion = { category: ExpenseCategory | null; desc: string };
export type BankGeminiSuggestion = {
  merchant: string;
  at: number;
  state: 'running' | 'ready' | 'failed';
  category?: ExpenseCategory;
  desc?: string;
};

const categoryIds = new Set<string>(categories.map(item => item.id));
const unsafeText = /[\p{Cc}\p{Cf}<>{}]|https?:|www\.|@|\d[\d\s-]{6,}\d/u;

export function suggestionMerchant(value: unknown) {
  if (typeof value !== 'string') return '';
  const name = value.normalize('NFKC').trim();
  return name.length <= 60 && /\p{L}/u.test(name) && !unsafeText.test(name) ? name.replace(/\s+/g, ' ') : '';
}

export const bankNoticeMerchant = (desc: string) => pendingDescription(desc) ? '' : suggestionMerchant(desc);

export function savedBankSuggestion(value: BankGeminiSuggestion | undefined, merchant: string) {
  if (!merchant || value?.merchant !== merchant || value.state !== 'ready') return null;
  return readMerchantSuggestion({ category: value.category ?? null, desc: value.desc ?? '' });
}

const merchantKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const aliases = [
  ['好市多', /^(好市多|costco)/],
  ['全聯', /^(全聯|pxmart|pxmart全聯)/],
  ['中油', /^(台灣中油|臺灣中油|中油|cpc)/],
] as const;
const merchantIdentity = (key: string) => aliases.find(([, pattern]) => pattern.test(key))?.[0] || key;

export function merchantHabits(merchant: string, history: readonly Expense[]): MerchantHabit[] {
  const key = merchantIdentity(merchantKey(merchant));
  if (key.length < 2) return [];
  const matches = history.filter(expense => {
    if (!expense.category || !categoryIds.has(expense.category)) return false;
    if (expense.sharedSource && !expense.sharedSource.confirmedAt) return false;
    if (typeof expense.merchant === 'string' && expense.merchant) return merchantIdentity(merchantKey(expense.merchant)) === key;
    // On older entries, recognize a store at the start of the description
    // only when the remainder is separated from it, or for known chains.
    const description = typeof expense.desc === 'string' ? expense.desc.trim() : '';
    const first = description.split(/[\s、，,·：:（(]/u)[0];
    return merchantIdentity(merchantKey(first)) === key || merchantIdentity(merchantKey(description)) === key;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 12);

  const counts = new Map<ExpenseCategory, number>();
  for (const expense of matches) {
    const category = expense.category!;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 3);
}

export function readMerchantHabits(value: unknown): MerchantHabit[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const seen = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== 2 || !categoryIds.has(item.category)
      || !Number.isInteger(item.count) || item.count < 1 || seen.has(item.category)) return null;
    seen.add(item.category);
    total += item.count;
  }
  return total <= 12 ? value : null;
}

export function readMerchantSuggestion(value: unknown): MerchantSuggestion | null {
  if (!value || typeof value !== 'object' || !('category' in value) || !('desc' in value)) return null;
  const { category, desc } = value;
  if (category !== null && (typeof category !== 'string' || !categoryIds.has(category))) return null;
  if (typeof desc !== 'string' || desc.length > 30 || unsafeText.test(desc)) return null;
  return { category: category as ExpenseCategory | null, desc: desc.trim() };
}
