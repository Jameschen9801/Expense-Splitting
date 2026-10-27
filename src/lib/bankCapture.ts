import type { Group } from '../types';
import { bankExpense, type BankEntry, type BankRule } from './bankShortcuts';
import { isPersonalLedger } from './ledgers';
import { utils } from './utils';

export function bankCapture(rule: BankRule, entry: BankEntry, id: string, group: Group, duplicate: boolean, today = utils.todayStr(), now = Date.now()) {
  const captureFirst = isPersonalLedger(group);
  const expense = { ...bankExpense(rule, entry, id, group), createdAt: now };
  if (captureFirst) {
    expense.category = 'other';
    if (entry.desc === '銀行刷卡消費') expense.desc = '銀行消費（待補說明）';
    return { expense, captureFirst, automatic: true, reviewReason: '' };
  }
  const nearDuplicate = group.expenses.some(item => item.amount === entry.amount && item.desc === entry.desc && item.date === entry.date && item.payer === rule.payer && Math.abs(now - item.createdAt) < 120000);
  const reviewReason = !entry.dateInMessage ? '通知未含消費日期，請核對日期後新增'
    : entry.date !== today ? '通知不是今天的消費，請核對日期後新增'
    : entry.amount > rule.limit ? '超過自動入帳上限，請確認後新增'
    : nearDuplicate && !duplicate ? '短時間內已有相似費用，請確認是否為另一筆消費' : '';
  return { expense, captureFirst, automatic: rule.mode === 'auto' && !reviewReason, reviewReason };
}
