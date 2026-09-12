import type { ReactNode } from 'react';

/**
 * "Label over a big number" stat tile -- the shape GiftCardsClient had
 * extracted locally (as `StatCard`), while analytics/page.tsx, customers/
 * page.tsx and customers/[id]/page.tsx each repeated the same markup
 * inline. All four had already drifted on padding/radius (p-5/rounded-xl
 * vs p-4/rounded-lg) and border color (explicit `border-[var(--rim1)]` vs
 * relying on Tailwind's default border color) for what is meant to be one
 * visual primitive; this is the version that wins, everyone else adopts it.
 *
 * Deliberately NOT the existing KpiCard (which carries trend/sparkline/
 * href/icon) -- that would be overkill for these simple label+value pairs;
 * this is a smaller sibling for the same design system.
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
    <div className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4 space-y-1">
      <p className="text-sm text-[var(--t2)]">{label}</p>
      <div className="flex items-center gap-2">
        <p className={`text-2xl font-bold ${valueClassName ?? 'text-[var(--t1)]'}`}>{value}</p>
        {trailing}
      </div>
    </div>
  );
}
