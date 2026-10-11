import type { Expense, ExpenseCategory } from '../types';

export type ExpenseForm = {
  desc: string; amount: string; date: string; payer: string;
  participants: string[]; splitMode: Expense['splitMode']; customShares: Record<string, string>;
  category?: ExpenseCategory;
};
export type TransferForm = { from: string; to: string; amount: string; date: string; note: string };
export type RecordDraft = {
  recordType: 'expense' | 'transfer'; expense: ExpenseForm; transfer: TransferForm;
  expenseId?: string; transferId?: string;
};

export class Drafts {
  constructor(private store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  private key(code: string, name: string) { return `warikan_draft_v1_${code}_${encodeURIComponent(name)}`; }
  read(code: string, name: string): RecordDraft | null {
    try { return JSON.parse(this.store.getItem(this.key(code, name)) || 'null'); }
    catch { return null; }
  }
  save(code: string, name: string, draft: RecordDraft, keepEmpty = false) {
    const hasContent = keepEmpty || draft.expenseId || draft.transferId || draft.expense.amount || draft.expense.desc || draft.transfer.amount || draft.transfer.note;
    if (hasContent) this.store.setItem(this.key(code, name), JSON.stringify(draft));
    else this.clear(code, name);
  }
  clear(code: string, name: string) { this.store.removeItem(this.key(code, name)); }
}

export class DraftWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: (() => void) | undefined;
  constructor(private onError: (error: unknown) => void, private delay = 350) {}
  schedule(write: () => void) {
    this.pending = write;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }
  flush(): boolean {
    clearTimeout(this.timer);
    const write = this.pending;
    this.pending = undefined;
    try { write?.(); return true; } catch (error) { this.pending = write; this.onError(error); return false; }
  }
  cancel() { clearTimeout(this.timer); this.pending = undefined; }
}
