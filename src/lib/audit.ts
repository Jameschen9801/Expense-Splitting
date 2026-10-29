import type { AuditEntry, Expense, Group, LedgerRecord, MutationMeta, RecordMetadata } from '../types';
import { categoryLabel } from './categories';

// Stable content, rather than only a revision, also detects edits made by older clients.
export function fingerprint(record: LedgerRecord | undefined): string | null {
  if (!record) return null;
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)]));
    return value;
  };
  // The combined record list adds a display-only type discriminator. It is not
  // persisted in Firebase and must not make an unchanged record look different.
  const { type: _displayType, ...persisted } = record as LedgerRecord & { type?: string };
  const normalized = { ...persisted,
    revision: record.revision || 0, createdBy: record.createdBy || '', createdByUid: record.createdByUid || '',
    updatedAt: record.updatedAt || 0, updatedBy: record.updatedBy || '', updatedByUid: record.updatedByUid || '', lastMutationId: record.lastMutationId || '',
    ...('payer' in record ? { shares: record.shares || [], percentages: record.percentages || [], category: record.category || 'other' } : 'from' in record ? { note: record.note || '' } : {}),
  };
  return JSON.stringify(canonical(normalized));
}

export class RecordConflictError extends Error {
  constructor(public cloud: Group, public targetId: string) { super('這筆紀錄已被其他裝置修改，請選擇要保留的版本'); this.name = 'RecordConflictError'; }
}

export function updatedRecord<T extends LedgerRecord>(record: T, before: T | undefined, meta?: MutationMeta): T {
  const {type:_displayType,...persisted}=record as T & {type?:string};
  if (!meta) return persisted as T;
  const metadata: RecordMetadata = {
    revision: (before?.revision || 0) + 1,
    createdBy: before?.createdBy || record.createdBy || meta.actor,
    updatedAt: meta.at, updatedBy: meta.actor, lastMutationId: meta.id,
    ...(before?.createdByUid || record.createdByUid || meta.actorUid ? { createdByUid: before?.createdByUid || record.createdByUid || meta.actorUid } : {}),
    ...(meta.actorUid ? { updatedByUid: meta.actorUid } : {}),
  };
  return { ...persisted, ...metadata } as T;
}

export function auditEntry(action: string, target: string, before: LedgerRecord | string | undefined, after: LedgerRecord | string | undefined, meta: MutationMeta): AuditEntry {
  const fields = [
    ['desc', '說明'], ['amount', '金額'], ['payer', '付款人'], ['participants', '分攤對象'],
    ['splitMode', '分攤方式'], ['shares', '分攤金額'], ['percentages', '分攤比例'], ['category', '分類'],
    ['date', '日期'], ['from', '付款人'], ['to', '收款人'], ['note', '備註'],
    ['notes', '補充說明'], ['location', '地點'], ['tags', '標籤'],
    ['direction', '儲蓄方向'],
  ];
  const display = (value: unknown, field: string) => {
    if (field === 'category') return categoryLabel(value as Expense['category']);
    if (field === 'splitMode') return ({ equal: '平均分攤', custom: '自訂金額', percent: '自訂比例' } as Record<string, string>)[String(value)] || '';
    if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? `${item.name}：${item.amount}` : String(item)).join('、');
    return value == null ? '' : String(value);
  };
  const changes = typeof before === 'string' || typeof after === 'string'
    ? [{ label: '名稱', before: before as string || '', after: after as string || '' }]
    : fields.flatMap(([field, label]) => {
      const oldValue = before ? display(before[field], field) : '';
      const newValue = after ? display(after[field], field) : '';
      return oldValue === newValue ? [] : [{ label, before: oldValue, after: newValue }];
    });
  return { id: meta.id, actor: meta.actor, at: meta.at, action, target, changes,
    ...(meta.actorUid ? { actorUid: meta.actorUid } : {}),
  };
}

export const actionLabel = (action: string) => ({
  'expense.put': '新增／修改費用', 'expense.remove': '刪除費用', 'transfer.put': '新增／修改轉帳',
  'transfer.remove': '刪除轉帳', 'member.add': '新增成員', 'member.remove': '移除成員', 'group.rename': '修改群組名稱',
  'bankDraft.put': '收到手機通知', 'bankDraft.confirm': '確認通知並入帳', 'bankDraft.remove': '忽略手機通知',
  'bankDraft.link': '通知連結分帳', 'expense.linkBank': '銀行入帳合併至分帳',
  'sharedDraft.put': '收到共用分攤', 'sharedDraft.confirm': '確認分攤並入帳', 'sharedDraft.remove': '忽略共用分攤', 'sharedDraft.withdraw': '移出分攤待確認',
  'sharedExpense.remove': '刪除已確認分攤',
  'income.put': '新增／修改收入', 'income.remove': '刪除收入',
  'saving.put': '新增／修改儲蓄', 'saving.remove': '刪除儲蓄', 'import.receiptbox': '匯入 ReceiptBox 帳目',
} as Record<string, string>)[action] || action;
