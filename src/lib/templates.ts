import type { ExpenseForm } from './drafts';

export type ExpenseTemplate = { id: string; name: string; form: Omit<ExpenseForm, 'date'>; updatedAt: number };
export const templateKey = (code: string, name: string) => `warikan_templates_v1_${code}_${encodeURIComponent(name)}`;
export function readTemplates(store: Pick<Storage, 'getItem'>, code: string, name: string): ExpenseTemplate[] {
  try { const items = JSON.parse(store.getItem(templateKey(code, name)) || '[]'); return Array.isArray(items) ? items : []; }
  catch { return []; }
}
export function saveTemplates(store: Pick<Storage, 'setItem'>, code: string, name: string, templates: ExpenseTemplate[]) {
  store.setItem(templateKey(code, name), JSON.stringify(templates.slice(0, 20)));
}
