import type { Group } from '../types';
import type { ExpenseForm } from './drafts';
import type { GroupChange } from './outbox';

export const isPersonalLedger = (group?: Pick<Group, 'kind'> | null) => group?.kind === 'personal';
export const ledgerKind = (group?: Pick<Group, 'kind'> | null) => isPersonalLedger(group) ? 'personal' : 'shared';

export function expenseFormForLedger(group: Group, form: ExpenseForm): ExpenseForm {
  if (!isPersonalLedger(group)) return form;
  const name = group.members[0];
  return { ...form, payer: name, participants: [name], splitMode: 'equal', customShares: {} };
}

export function assertLedgerChange(group: Group, change: GroupChange) {
  if (change.type.startsWith('bankDraft.') && !isPersonalLedger(group)) throw new Error('手機通知待確認目前供個人帳本使用');
  if (change.type === 'bankDraft.confirm' && change.id !== change.expense.id) throw new Error('待確認通知與入帳編號不一致');
  if (!isPersonalLedger(group)) return;
  if (change.type.startsWith('member.') || change.type.startsWith('transfer.')) throw new Error('個人帳本不提供成員分攤或還款轉帳');
  if (change.type === 'expense.put' || change.type === 'bankDraft.put' || change.type === 'bankDraft.confirm') {
    const expense = change.type === 'bankDraft.put' ? change.draft : change.expense, name = group.members[0];
    if (expense.payer !== name || expense.participants.length !== 1 || expense.participants[0] !== name || expense.splitMode !== 'equal') throw new Error('個人帳本只能記錄自己的支出');
  }
}
