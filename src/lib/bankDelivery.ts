export const bankDeliveryKey = 'warikan_bank_delivery_v1';
export const bankDeliveryEvent = 'warikan:bank-delivery';
export type BankDeliveryState = 'received' | 'pending' | 'saved' | 'duplicate' | 'review' | 'error' | 'setup';
export type BankDelivery = { at: number; state: BankDeliveryState; message: string };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const states: BankDeliveryState[] = ['received', 'pending', 'saved', 'duplicate', 'review', 'error', 'setup'];

export function readBankDelivery(store: Store): BankDelivery | null {
  try {
    const value = JSON.parse(store.getItem(bankDeliveryKey) || 'null');
    return value && Number.isSafeInteger(value.at) && value.at > 0 && states.includes(value.state)
      && typeof value.message === 'string' && value.message.length <= 240 ? value : null;
  } catch { return null; }
}

// Only the latest outcome stays in this browser. Notification text, account,
// card, amount, receipt IDs and private Shortcut links are never stored here.
export function saveBankDelivery(store: Store, state: BankDeliveryState, message: string, at = Date.now()) {
  try { store.setItem(bankDeliveryKey, JSON.stringify({ at, state, message: message.slice(0, 240) })); } catch { /* Diagnostics must not prevent capture. */ }
}

export function reportBankDelivery(state: BankDeliveryState, message: string) {
  if (typeof window === 'undefined') return;
  try { saveBankDelivery(localStorage, state, message); window.dispatchEvent(new Event(bankDeliveryEvent)); } catch { /* Storage may be disabled. */ }
}
