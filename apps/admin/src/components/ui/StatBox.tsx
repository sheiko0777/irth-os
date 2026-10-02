import type { ReactNode } from 'react';
import { formatNumber } from '@irth/domain';

/**
 * "Label over a big number" stat tile: the smaller sibling of KpiCard for
 * plain label + value pairs (analytics, customers, gift cards). One primitive,
 * so padding, radius and surface never drift between screens again.
 */
export function StatBox({
  label,
  value,
  valueClassName,
  trailing,
}: {
  label: string;
  value: ReactNode;
  /** Defaults to the standard text color; pass a token like 'text-[var(--gold)]' for the accented variants every call site already used. */
  valueClassName?: string;
  /** An element rendered next to the value, e.g. a growth badge. */
  trailing?: ReactNode;
}) {
  return (
    <div className="glass rounded-[var(--card-radius)] p-4 space-y-1.5">
      <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
      <div className="flex items-center gap-2">
        {/* LTR isolate: an amount string must read "1,234 ج.م" in RTL too. */}
        <p dir="ltr" className={`text-2xl font-semibold tracking-tight tabular-nums ${valueClassName ?? 'text-[var(--text-primary)]'}`}>
          {typeof value === 'number' ? formatNumber(value) : value}
        </p>
        {trailing}
      </div>
    </div>
  );
}
