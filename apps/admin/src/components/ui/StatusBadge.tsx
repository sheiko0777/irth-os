import { cn } from '@/lib/utils';
import { statusStyle, type StatusDomain } from '@/lib/statusMaps';

type OrderStatus =
  | 'pending' | 'confirmed' | 'payment_failed'
  | 'shipped' | 'delivered' | 'cancelled' | 'returned';

type PaymentStatus = 'paid' | 'unpaid' | 'refunded' | 'partial';

interface StatusBadgeProps {
  status: string;
  /** Which status map to render from. Defaults to 'order'. */
  domain?: StatusDomain;
  /** @deprecated legacy alias for domain ('order' | 'payment'). */
  type?: 'order' | 'payment';
  className?: string;
}

export function StatusBadge({ status, domain, type, className }: StatusBadgeProps) {
  const resolved: StatusDomain = domain ?? (type === 'payment' ? 'payment' : 'order');
  const config = statusStyle(resolved, status);

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
