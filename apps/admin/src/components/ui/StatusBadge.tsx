import { cn } from '@/lib/utils';

type OrderStatus =
  | 'pending' | 'confirmed' | 'payment_failed'
  | 'shipped' | 'delivered' | 'cancelled';

type PaymentStatus = 'paid' | 'unpaid' | 'refunded' | 'partial';

const orderStatusMap: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:        { label: 'معلق',          color: 'var(--amber)',   bg: 'rgba(245,165,0,.10)'   },
  confirmed:      { label: 'مؤكد',          color: 'var(--azure)',   bg: 'rgba(46,143,255,.10)'  },
  payment_failed: { label: 'فشل الدفع',     color: 'var(--crimson)', bg: 'rgba(232,56,56,.10)'   },
  shipped:        { label: 'مشحون',         color: 'var(--gold)',    bg: 'rgba(224,144,0,.10)'   },
  delivered:      { label: 'تم التسليم',    color: 'var(--emerald)', bg: 'rgba(0,196,120,.10)'   },
  cancelled:      { label: 'ملغى',          color: 'var(--t3)',      bg: 'var(--rim1)'            },
};

const paymentStatusMap: Record<PaymentStatus, { label: string; color: string; bg: string }> = {
  paid:     { label: 'مدفوع',    color: 'var(--emerald)', bg: 'rgba(0,196,120,.10)'  },
  unpaid:   { label: 'غير مدفوع', color: 'var(--crimson)', bg: 'rgba(232,56,56,.10)' },
  refunded: { label: 'مسترد',    color: 'var(--azure)',   bg: 'rgba(46,143,255,.10)' },
  partial:  { label: 'جزئي',     color: 'var(--amber)',   bg: 'rgba(245,165,0,.10)'  },
};

interface StatusBadgeProps {
  status: OrderStatus | PaymentStatus;
  type?: 'order' | 'payment';
  className?: string;
}

export function StatusBadge({ status, type = 'order', className }: StatusBadgeProps) {
  const map = type === 'payment' ? paymentStatusMap : orderStatusMap;
  const config = (map as Record<string, { label: string; color: string; bg: string }>)[status];

  if (!config) {
    return (
      <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--rim1)] text-[var(--t3)]', className)}>
        {status}
      </span>
    );
  }

  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}
      style={{ color: config.color, background: config.bg }}
    >
      {config.label}
    </span>
  );
}

export type { OrderStatus, PaymentStatus };
