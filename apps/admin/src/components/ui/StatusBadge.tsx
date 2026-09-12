import { cn } from '@/lib/utils';
import { statusStyle, type StatusDomain } from '@/lib/statusMaps';

interface StatusBadgeProps {
  status: string;
  /** Which status map to render from. Defaults to 'order'. */
  domain?: StatusDomain;
  className?: string;
}

export function StatusBadge({ status, domain, className }: StatusBadgeProps) {
  const config = statusStyle(domain ?? 'order', status);

  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}
      style={{ color: config.color, background: config.bg }}
    >
      {config.label}
    </span>
  );
}
