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
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-none', className)}
      style={{ color: config.color, background: config.bg }}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {config.label}
    </span>
  );
}
