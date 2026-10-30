import type { RecordQuery } from './recordViews';

export type RecordView = 'day' | 'month';
export const recordViewKey = (code: string) => `warikan_record_view_v1_${code}`;
export function readRecordView(store: Pick<Storage,'getItem'>, code: string): RecordView {
  try { return store.getItem(recordViewKey(code)) === 'month' ? 'month' : 'day'; } catch { return 'day'; }
}
export function saveRecordView(store: Pick<Storage,'setItem'>, code: string, view: RecordView) {
  try { store.setItem(recordViewKey(code), view); } catch { /* Browsing still works when preferences cannot be saved. */ }
}
export function recordSearchQuery(query: RecordQuery, search: string, allDates: boolean): RecordQuery {
  return { ...query, period: search.trim() && allDates ? '' : query.period, search };
}
