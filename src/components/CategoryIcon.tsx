import { BedDouble, BusFront, ShoppingBag, Tickets, Utensils, ReceiptText } from 'lucide-react';
import type { ExpenseCategory } from '../types';

const icons = { food: Utensils, transport: BusFront, stay: BedDouble, shopping: ShoppingBag, entertainment: Tickets, bills: ReceiptText, other: ReceiptText };
export function CategoryIcon({ category = 'other', size = 20 }: { category?: ExpenseCategory; size?: number }) {
  const Icon = icons[category] || ReceiptText;
  return <Icon size={size} aria-hidden="true" />;
}
