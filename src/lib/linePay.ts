import type { BankDraft } from '../types';
import { pendingDescription } from './bankInbox';
import { utils } from './utils';

const pairWindow = 2 * 60_000;
const maxAge = 48 * 60 * 60_000;
const indexLimit = 60;

// Use the same gate in Shortcuts before any network request. Chat messages and
// notifications that only say "付款完成" should stay on the phone.
export const linePayNotificationPattern = String.raw`^(?:LINE[ \u3000]*錢包|LINE[ \u3000]*Pay)[ \t]*\r?\n(?=[\s\S]{1,400}$)(?![\s\S]*(?:退款|退貨|取消|失敗|未完成|未成功|轉帳|驗證碼|\bOTP\b|https?://))(?=[\s\S]*(?:付款(?:已)?完成|付款成功|支付成功))(?=[\s\S]*(?:NT[ \t]*[$＄]|TWD|新[台臺]幣))(?=[\s\S]*(?:商[店家]名稱|店家名稱|商店|商家)(?:[ \t]*[:：][ \t]*|[ \t]+|\r?\n)[^\s:：])[\s\S]+$`;
const paymentNotice = new RegExp(linePayNotificationPattern, 'i');
const unsupported = /退款|退貨|取消|失敗|未完成|未成功|轉帳|驗證碼|\bOTP\b|https?:\/\/|(?:USD|JPY|HKD|EUR|美元|日幣|日圓)/i;
const merchantLabel = /(?:^|[\s，,。；;])(?:商[店家]名稱|商店|商家|店家名稱)[^\S\n]*(?:(?:[:：][^\S\n]*)|\n|[ \t]+)([^\n，,。；;]{1,80})/gu;
const amountLabel = /(?:NT[ \t]*\$|TWD|新[台臺]幣)[ \t]*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,eE]|\.\d)/gi;

export type LinePayPayment = { merchant: string; cents: number; date: string; at: number; receivedAt: number; explicitTime: boolean };
export type LinePayBank = { book: string; cents: number; date: string; at: number; chargeAt?: number };
export type LinePayIndex = { payments?: Record<string, LinePayPayment>; banks?: Record<string, LinePayBank> };

export function richartBank(name: string) {
  return /^(?:richart(?:\s*life)?|[台臺]新(?:銀行)?)$/i.test(name.trim());
}

export function richartChargeTime(text: string, date: string) {
  const match = text.normalize('NFKC').match(/(?:於|在)\s*(\d{1,2})\/(\d{1,2})[- \t]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/);
  if (!match) return undefined;
  const [, month, day, hour, minute, second = '00'] = match;
  if (Number(month) !== Number(date.slice(5, 7)) || Number(day) !== Number(date.slice(8)) ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
  const time = Date.parse(`${date}T${hour.padStart(2, '0')}:${minute}:${second}+08:00`);
  return Number.isFinite(time) ? time : undefined;
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function parseLinePayNotification(text: string, receivedAt: number): LinePayPayment | null {
  const normalized = text.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
  if (!paymentNotice.test(normalized) || unsupported.test(normalized)) return null;
  const merchants = [...normalized.matchAll(merchantLabel)];
  const amounts = [...normalized.matchAll(amountLabel)];
  if (merchants.length !== 1 || amounts.length !== 1) return null;
  const merchant = merchants[0][1].trim();
  const cents = Number(amounts[0][1].replaceAll(',', '')) * 100 + Number((amounts[0][2] || '').padEnd(2, '0'));
  if (!merchant || merchant.length > 60 || !/\p{Letter}/u.test(merchant) ||
    /[\u0000-\u001f]|\d{8,}|付款完成|付款成功|了解更多|瞭解更多|^LINE\s*Pay$/i.test(merchant) ||
    !Number.isSafeInteger(cents) || cents <= 0 || cents > 1e11) return null;

  const timestamp = normalized.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  let at = receivedAt;
  if (timestamp) {
    const [year, month, day, hour, minute, second = 0] = timestamp.slice(1).filter(value => value !== undefined).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null;
    at = Date.UTC(year, month - 1, day, hour - 8, minute, second);
    if (at > receivedAt + pairWindow || receivedAt - at > maxAge) return null;
  }
  const date = new Date(at + 8 * 60 * 60_000).toISOString().slice(0, 10);
  return { merchant, cents, date, at, receivedAt, explicitTime: !!timestamp };
}

function recent<T>(rows: Record<string, T>, timestamp: (item: T) => number, now: number) {
  return Object.fromEntries(Object.entries(rows)
    .filter(([, item]) => now - timestamp(item) <= maxAge)
    .sort(([, a], [, b]) => timestamp(b) - timestamp(a)).slice(0, indexLimit));
}

export function addLinePayPayment(index: LinePayIndex | null, id: string, payment: LinePayPayment): LinePayIndex {
  const payments = index?.payments || {};
  if (payments[id] || (!payment.explicitTime && Object.values(payments).some(previous =>
    !previous.explicitTime && previous.merchant === payment.merchant && previous.cents === payment.cents &&
    previous.date === payment.date && Math.abs(previous.receivedAt - payment.receivedAt) <= pairWindow))) return index!;
  return {
    payments: recent({ ...payments, [id]: payment }, item => item.receivedAt, payment.receivedAt),
    banks: recent(index?.banks || {}, item => item.at, payment.receivedAt),
  };
}

export function addLinePayBank(index: LinePayIndex | null, id: string, bank: LinePayBank): LinePayIndex {
  const banks = index?.banks || {};
  if (banks[id]) return index!;
  return {
    payments: recent(index?.payments || {}, item => item.receivedAt, bank.at),
    banks: recent({ ...banks, [id]: bank }, item => item.at, bank.at),
  };
}

// Compute a one-to-one match using both sides, including recently handled
// Richart receipts. A finished receipt must not free its hint for another one.
export function linePayPairs(index: LinePayIndex | null) {
  const banks = Object.entries(index?.banks || {});
  const payments = Object.entries(index?.payments || {});
  const eligible = (bank: LinePayBank, payment: LinePayPayment) =>
    bank.cents === payment.cents && bank.date === payment.date &&
    Math.abs(bank.at - payment.receivedAt) <= pairWindow &&
    (!payment.explicitTime || Math.abs((bank.chargeAt ?? bank.at) - payment.at) <= pairWindow);
  const pairs: Record<string, { book: string; paymentId: string; merchant: string }> = {};
  for (const [id, bank] of banks) {
    const matching = payments.filter(([, payment]) => eligible(bank, payment));
    if (matching.length !== 1) continue;
    const [paymentId, payment] = matching[0];
    if (banks.filter(([, row]) => eligible(row, payment)).length === 1) {
      pairs[id] = { book: bank.book, paymentId, merchant: payment.merchant };
    }
  }
  return pairs;
}

export function linePaySuggestions(index: LinePayIndex | null, book: string, drafts: BankDraft[]): Record<string, string> {
  const pairs = linePayPairs(index);
  const suggestions: Record<string, string> = {};
  for (const draft of drafts) {
    const bank = index?.banks?.[draft.id];
    if (!bank || bank.book !== book || bank.cents !== utils.toCents(draft.amount) ||
      bank.date !== draft.date || !richartBank(draft.bank) || (draft.desc.trim() && !pendingDescription(draft.desc))) continue;
    if (pairs[draft.id]) suggestions[draft.id] = pairs[draft.id].merchant;
  }
  return suggestions;
}
