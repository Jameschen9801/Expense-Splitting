export interface Group {
  kind?: 'personal' | 'shared';
  code: string;
  name: string;
  members: string[];
  expenses: Expense[];
  incomes?: Income[];
  savings?: Saving[];
  transfers: Transfer[];
  createdAt: number;
  history?: Record<string, AuditEntry>;
  bankInbox?: BankDraft[];
  bankReceiptIds?: string[];
  bankLinks?: Record<string, string>;
  security?: GroupSecurity;
}

export type ExpenseCategory = 'other' | 'food' | 'transport' | 'stay' | 'shopping' | 'entertainment' | 'bills' | 'health' | 'social' | 'insurance' | 'travel' | 'education' | 'haircut';
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

export type RecordDetails = {
  notes?: string;
  location?: string;
  tags?: string[];
  importSource?: { system: 'ReceiptBox'; category: string };
};
export interface Income extends RecordMetadata, RecordDetails {
  id: string; desc: string; amount: number; date: string; createdAt: number;
}
export interface Saving extends Income { direction?: 'out' | 'in' }

export interface Expense extends RecordMetadata, RecordDetails {
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
  sharedSource?: {
    groupCode: string;
    groupName: string;
    expenseId: string;
    memberName: string;
    totalAmount: number;
    payer: string;
  };
}

export type PersonalLedgerLink = { targetCode: string; memberName: string; enabled: boolean };

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

export type LedgerRecord = Expense | Income | Saving | Transfer;

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
