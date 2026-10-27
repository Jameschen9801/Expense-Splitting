export interface Group {
  kind?: 'personal' | 'shared';
  code: string;
  name: string;
  members: string[];
  expenses: Expense[];
  transfers: Transfer[];
  createdAt: number;
  history?: Record<string, AuditEntry>;
  bankInbox?: BankDraft[];
  bankReceiptIds?: string[];
  security?: GroupSecurity;
}

export type ExpenseCategory = 'other' | 'food' | 'transport' | 'stay' | 'shopping' | 'entertainment' | 'bills' | 'health' | 'social' | 'insurance' | 'travel';
export type MutationMeta = { id: string; actor: string; actorUid?: string; at: number; expected?: string | null };
export type AuditEntry = {
  id: string; actor: string; actorUid?: string; at: number; action: string; target: string;
  changes: { label: string; before: string; after: string }[];
};
export type GroupSecurity = {
  version: 1; ownerUid: string;
  users: Record<string, { name: string; nameKey: string; role: 'owner' | 'member' }>;
  names: Record<string, string>;
};
export type RecordMetadata = {
  revision?: number; createdBy?: string; createdByUid?: string;
  updatedAt?: number; updatedBy?: string; updatedByUid?: string; lastMutationId?: string;
};

export interface Expense extends RecordMetadata {
  id: string;
  desc: string;
  amount: number;
  payer: string;
  participants: string[];
  splitMode: 'equal' | 'custom' | 'percent';
  shares?: Share[];
  percentages?: Share[];
  date: string;
  createdAt: number;
  category?: ExpenseCategory;
}

export interface BankDraft extends Expense {
  bank: string;
  last4: string;
}

export interface Share {
  name: string;
  amount: number;
}

export interface Transfer extends RecordMetadata {
  id: string;
  from: string;
  to: string;
  amount: number;
  note?: string;
  date: string;
  createdAt: number;
}

export interface MyGroup {
  kind?: Group['kind'];
  code: string;
  name: string;
  myName: string;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}
