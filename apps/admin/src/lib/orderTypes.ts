export type OrderStatus = 'pending' | 'confirmed' | 'payment_failed' | 'shipped' | 'delivered' | 'cancelled';

export const STATUS_COLUMNS: { id: OrderStatus; label: string; color: string }[] = [
  { id: 'pending',        label: 'قيد الانتظار', color: 'var(--amber)' },
  { id: 'confirmed',      label: 'مؤكد',          color: 'var(--azure)' },
  { id: 'payment_failed', label: 'فشل الدفع',     color: 'var(--crimson)' },
  { id: 'shipped',        label: 'تم الشحن',       color: 'var(--emerald)' },
  { id: 'delivered',      label: 'تم التسليم',     color: 'var(--emerald)' },
  { id: 'cancelled',      label: 'ملغي',           color: 'var(--gold)' },
];
