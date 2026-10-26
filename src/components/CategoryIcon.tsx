import { House, BusFront, ShoppingBag, Tickets, Utensils, ReceiptText, HeartPulse, Gift, ShieldCheck } from 'lucide-react';
import type { ExpenseCategory } from '../types';

const icons = { food: Utensils, transport: BusFront, stay: House, shopping: ShoppingBag, entertainment: Tickets, bills: ReceiptText, health: HeartPulse, social: Gift, insurance: ShieldCheck, other: ReceiptText };
export function CategoryIcon({ category = 'other', size = 20 }: { category?: ExpenseCategory; size?: number }) {
  const Icon = icons[category] || ReceiptText;
  return <Icon size={size} aria-hidden="true" />;
}
