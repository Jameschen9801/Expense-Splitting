import type { Expense, Group, MyGroup, Transfer } from '../types';
import { categories, categoryLabel } from './categories';
import type { GroupChange, PendingChange } from './outbox';
import { utils } from './utils';

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
export type Backup = { app: 'Expense-Splitting'; version: 1; createdAt: string; entries: Record<string, string> };
export type RestorePlan = { entries: Record<string, string>; groups: number; records: number; drafts: number; templates: number; pending: number; skipped: number };
const MAX_BYTES = 8 * 1024 * 1024;
const allowedKey = (key: string) => /^(warikan_my_groups|warikan_last_group|warikan_outbox_v1|warikan_group_\d{6}|warikan_(draft|templates)_v1_\d{6}_.{1,200})$/.test(key);
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length <= max;
const recordId = (value: unknown): value is string => text(value, 150) && !!value && !/[.#$\[\]/\u0000-\u001f\u007f]/.test(value);
const code = (value: unknown) => typeof value === 'string' && /^\d{6}$/.test(value);
const names = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 1000 && value.every(item => text(item, 100) && item.length > 0) && new Set(value).size === value.length;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9;
const date = (value: unknown) => {
  if (!text(value, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
function parse(raw: string) {
  return JSON.parse(raw, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('備份含有不安全的欄位');
    return value;
  });
}
function validRecord(record: any): record is Expense | Transfer {
  if (!object(record) || !recordId(record.id) || '_deleted' in record || '_lastAudit' in record || !amount(record.amount) || !date(record.date)
    || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return false;
  if (record.revision != null && (!Number.isInteger(record.revision) || record.revision < 0)) return false;
  if (record.updatedAt != null && (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt))) return false;
  if (['createdBy','createdByUid','updatedBy','updatedByUid','lastMutationId'].some(key => record[key] != null && !text(record[key], 150))) return false;
  if ('desc' in record) {
    if (!text(record.desc, 200) || !text(record.payer, 100) || !names(record.participants) || !record.participants.length
      || !['equal', 'custom', 'percent'].includes(record.splitMode)
      || record.category && !categories.some(category => category.id === record.category)) return false;
    if (record.splitMode !== 'equal') {
      if (!Array.isArray(record.shares) || record.shares.length !== record.participants.length
        || record.shares.some((share: any) => !object(share) || !record.participants.includes(share.name) || typeof share.amount !== 'number' || !Number.isFinite(share.amount) || share.amount < 0)
        || new Set(record.shares.map((share: any) => share.name)).size !== record.participants.length
        || record.shares.reduce((sum: number, share: any) => sum + utils.toCents(share.amount), 0) !== utils.toCents(record.amount)) return false;
    }
    if (record.percentages != null && (!Array.isArray(record.percentages) || record.percentages.length !== record.participants.length
      || record.percentages.some((share: any) => !object(share) || !record.participants.includes(share.name) || typeof share.amount !== 'number' || !Number.isFinite(share.amount) || share.amount < 0 || share.amount > 100)
      || Math.abs(record.percentages.reduce((sum: number, share: any) => sum + share.amount, 0) - 100) > 0.001)) return false;
    return true;
  }
  return text(record.from, 100) && text(record.to, 100) && record.from !== record.to && (record.note == null || text(record.note, 1000));
}
function validGroup(group: any): group is Group {
  if (!object(group) || !code(group.code) || !text(group.name) || !names(group.members)
    || !Array.isArray(group.expenses) || !Array.isArray(group.transfers)
    || [...group.expenses, ...group.transfers].length > 50000
    || !group.expenses.every((record: any) => validRecord(record) && 'desc' in record)
    || !group.transfers.every((record: any) => validRecord(record) && !('desc' in record) && 'from' in record)
    || typeof group.createdAt !== 'number' || !Number.isFinite(group.createdAt)
    || new Set([...group.expenses, ...group.transfers].map(record => record.id)).size !== group.expenses.length + group.transfers.length) return false;
  if (group.history && (!object(group.history) || Object.keys(group.history).length > 300 || Object.entries(group.history).some(([id, entry]: [string, any]) =>
    !object(entry) || entry.id !== id || !text(entry.actor, 100) || !text(entry.target, 200) || !Number.isFinite(entry.at)
    || !['expense.put','expense.remove','transfer.put','transfer.remove','member.add','member.remove','group.rename'].includes(entry.action)
    || !Array.isArray(entry.changes) || entry.changes.length > 30 || entry.changes.some((change: any) => !object(change) || !text(change.label, 100) || !text(change.before, 10000) || !text(change.after, 10000))))) return false;
  if (group.security) {
    const security = group.security;
    if (!object(security) || security.version !== 1 || !text(security.ownerUid, 150) || !object(security.users) || !object(security.names)
      || security.users[security.ownerUid]?.role !== 'owner'
      || Object.entries(security.users).some(([uid, user]: [string, any]) => !object(user) || !text(user.name, 12) || user.nameKey !== user.name
        || security.names[user.name] !== uid || user.role !== (uid === security.ownerUid ? 'owner' : 'member'))) return false;
  }
  return group.expenses.every((record: Expense) => group.members.includes(record.payer) && record.participants.every(name => group.members.includes(name)))
    && group.transfers.every((record: Transfer) => group.members.includes(record.from) && group.members.includes(record.to));
}
function validForm(form: any, transfer = false) {
  if (!object(form) || !text(form.amount, 100) || !date(form.date)) return false;
  if (transfer) return text(form.from, 100) && text(form.to, 100) && text(form.note, 1000);
  return text(form.desc, 200) && text(form.payer, 100) && names(form.participants) && ['equal', 'custom', 'percent'].includes(form.splitMode)
    && object(form.customShares) && Object.values(form.customShares).every(value => text(value, 100))
    && (!form.category || categories.some(category => category.id === form.category));
}
function validPending(item: any): item is PendingChange {
  if (!object(item) || !text(item.id, 150) || !code(item.groupCode) || !object(item.change)) return false;
  const change = item.change;
  if (change.meta && (!object(change.meta) || !text(change.meta.id, 150) || !text(change.meta.actor, 100)
    || !Number.isFinite(change.meta.at) || (change.meta.expected != null && !text(change.meta.expected, 100000)))) return false;
  switch (change.type) {
    case 'expense.put': return validRecord(change.expense) && 'desc' in change.expense;
    case 'transfer.put': return validRecord(change.transfer) && 'from' in change.transfer;
    case 'expense.remove': case 'transfer.remove': return recordId(change.id);
    case 'member.add': case 'member.remove': case 'group.rename': return text(change.name, 200) && !!change.name;
    default: return false;
  }
}
function validateEntry(key: string, raw: string) {
  if (!allowedKey(key) || !text(raw, MAX_BYTES)) throw new Error('不是可還原的分帳資料');
  if (key === 'warikan_last_group') { if (!code(raw)) throw new Error('群組代碼格式錯誤'); return; }
  const data = parse(raw);
  let valid = false;
  if (key === 'warikan_my_groups') valid = Array.isArray(data) && data.length <= 1000 && data.every(item => object(item) && code(item.code) && text(item.name) && text(item.myName, 100));
  else if (key === 'warikan_outbox_v1') valid = Array.isArray(data) && data.length <= 10000 && data.every(validPending) && new Set(data.map(item => item.id)).size === data.length;
  else if (key.startsWith('warikan_group_')) valid = validGroup(data) && key === 'warikan_group_' + data.code;
  else if (key.startsWith('warikan_draft_')) valid = object(data) && ['expense', 'transfer'].includes(data.recordType) && validForm(data.expense) && validForm(data.transfer, true)
    && (!data.expenseId || text(data.expenseId, 150)) && (!data.transferId || text(data.transferId, 150));
  else if (key.startsWith('warikan_templates_')) valid = Array.isArray(data) && data.length <= 20 && data.every(item => object(item) && text(item.id, 150) && text(item.name, 100) && validForm({ ...item.form, date: '2026-01-01' }) && Number.isFinite(item.updatedAt));
  if (!valid) throw new Error('備份資料格式不正確：' + key.replace(/_(?:draft|templates)_v1_.*$/, ''));
}
export function createBackup(store: Store): Backup {
  const entries: Record<string, string> = {};
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index)!;
    if (allowedKey(key)) { const raw = store.getItem(key); if (raw !== null) entries[key] = raw; }
  }
  return { app: 'Expense-Splitting', version: 1, createdAt: new Date().toISOString(), entries };
}
export function readBackup(raw: string): Backup {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('備份超過 8 MB，請拆分或縮小檔案');
  const data = parse(raw);
  if (!object(data) || data.app !== 'Expense-Splitting' || data.version !== 1 || !object(data.entries)
    || Object.keys(data.entries).length > 3000 || !text(data.createdAt, 100)) throw new Error('不是支援的分帳備份檔');
  Object.entries(data.entries).forEach(([key, value]) => validateEntry(key, value as string));
  return data as Backup;
}
const entityId = (change: GroupChange) => change.type === 'expense.put' ? change.expense.id : change.type === 'transfer.put' ? change.transfer.id : 'id' in change ? change.id : '';

export function planRestore(store: Store, backup: Backup): RestorePlan {
  // Validate even when this function is called outside the file picker.
  readBackup(JSON.stringify(backup));
  const result: RestorePlan = { entries: {}, groups: 0, records: 0, drafts: 0, templates: 0, pending: 0, skipped: 0 };
  const currentGroups: MyGroup[] = parse(store.getItem('warikan_my_groups') || '[]');
  const memberships: MyGroup[] = parse(backup.entries.warikan_my_groups || '[]');
  const pending: PendingChange[] = parse(store.getItem('warikan_outbox_v1') || '[]');
  const restoredPending: PendingChange[] = parse(backup.entries.warikan_outbox_v1 || '[]');
  const addedRecords: { group: Group; record: Expense | Transfer }[] = [];
  const originals = new Map<string, Group | null>();
  for (const [key, raw] of Object.entries(backup.entries)) {
    if (!key.startsWith('warikan_group_')) continue;
    const imported: Group = parse(raw);
    const current: Group | null = parse(store.getItem(key) || 'null');
    originals.set(imported.code, current);
    const missingExpenses = imported.expenses.filter(record => !current?.expenses.some(item => item.id === record.id));
    const missingTransfers = imported.transfers.filter(record => !current?.transfers.some(item => item.id === record.id));
    result.skipped += imported.expenses.length + imported.transfers.length - missingExpenses.length - missingTransfers.length;
    [...missingExpenses, ...missingTransfers].forEach(record => addedRecords.push({ group: imported, record }));
    const next = current ? { ...current,
      members: [...new Set([...current.members, ...imported.members])],
      expenses: [...current.expenses, ...missingExpenses], transfers: [...current.transfers, ...missingTransfers],
      history: Object.fromEntries(Object.values({ ...imported.history, ...current.history }).sort((a, b) => b.at - a.at).slice(0, 300).map(entry => [entry.id, entry])) } : imported;
    result.entries[key] = JSON.stringify(next);
    result.records += missingExpenses.length + missingTransfers.length;
    if (!current) result.groups++;
  }
  const validMemberships = memberships.filter(item => result.entries['warikan_group_' + item.code] || store.getItem('warikan_group_' + item.code));
  result.entries.warikan_my_groups = JSON.stringify([...currentGroups, ...validMemberships.filter(item => !currentGroups.some(current => current.code === item.code))]);
  const restoredEntities = new Set<string>();
  for (const item of restoredPending) {
    if (pending.some(current => current.id === item.id)) { result.skipped++; continue; }
    const id = entityId(item.change);
    const current = originals.has(item.groupCode) ? originals.get(item.groupCode) : parse(store.getItem('warikan_group_' + item.groupCode) || 'null');
    const currentRecord = [...current?.expenses || [], ...current?.transfers || []].find(record => record.id === id);
    // Never replay old edits/deletions or management changes over existing local work.
    if (!id || currentRecord || pending.some(queued => queued.groupCode === item.groupCode && entityId(queued.change) === id)) { result.skipped++; continue; }
    if (!result.entries['warikan_group_' + item.groupCode] && !store.getItem('warikan_group_' + item.groupCode)) { result.skipped++; continue; }
    pending.push(item); result.pending++; restoredEntities.add(item.groupCode + ':' + id);
  }
  for (const { group, record } of addedRecords) {
    const key = group.code + ':' + record.id;
    if (restoredEntities.has(key) || pending.some(item => item.groupCode === group.code && entityId(item.change) === record.id)) continue;
    const actor = validMemberships.find(item => item.code === group.code)?.myName || '備份還原';
    const change: GroupChange = 'desc' in record ? { type: 'expense.put', expense: record } : { type: 'transfer.put', transfer: record };
    change.meta = { id: crypto.randomUUID(), actor, at: Date.now(), expected: null };
    pending.push({ id: crypto.randomUUID(), groupCode: group.code, change });
    result.pending++;
  }
  result.entries.warikan_outbox_v1 = JSON.stringify(pending);
  for (const [key, raw] of Object.entries(backup.entries)) {
    if (key.startsWith('warikan_draft_')) {
      if (!store.getItem(key)) { result.entries[key] = raw; result.drafts++; } else result.skipped++;
    } else if (key.startsWith('warikan_templates_')) {
      const items = parse(raw), current = parse(store.getItem(key) || '[]');
      const missing = items.filter((item: any) => !current.some((existing: any) => existing.id === item.id));
      const added = missing.slice(0, Math.max(0, 20 - current.length));
      result.entries[key] = JSON.stringify([...current, ...added]);
      result.templates += added.length; result.skipped += items.length - added.length;
    } else if (key === 'warikan_last_group' && !store.getItem(key)) result.entries[key] = raw;
  }
  return result;
}
export function commitRestore(store: Store, plan: RestorePlan) {
  const previous = new Map(Object.keys(plan.entries).map(key => [key, store.getItem(key)]));
  const changed: string[] = [];
  try {
    for (const [key, raw] of Object.entries(plan.entries)) { store.setItem(key, raw); changed.push(key); }
  } catch (error) {
    // Free space before restoring the originals. Do not clear unrelated application data.
    changed.forEach(key => store.removeItem(key));
    changed.forEach(key => { const raw = previous.get(key); if (raw != null) store.setItem(key, raw); });
    throw new Error('還原未完成，原有資料已保留。請確認儲存空間後再試。', { cause: error });
  }
}
export function groupCsv(group: Group) {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: (string | number)[][] = [['群組', '類型', '日期', '說明／備註', '付款人', '收款人', '金額 NT$', '分類', '各人分攤', '紀錄 ID']];
  group.expenses.forEach(record => rows.push([group.name, '費用', record.date, record.desc, record.payer, '', record.amount.toFixed(2), categoryLabel(record.category),
    (record.splitMode === 'equal' ? utils.equalShares(record.amount, record.participants) : record.shares || []).map(share => share.name + ':' + share.amount.toFixed(2)).join('；'), record.id]));
  group.transfers.forEach(record => rows.push([group.name, '轉帳', record.date, record.note || '', record.from, record.to, record.amount.toFixed(2), '', '', record.id]));
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
export function downloadFile(contents: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
