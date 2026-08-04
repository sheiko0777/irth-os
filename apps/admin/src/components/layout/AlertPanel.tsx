'use client';

import Link from 'next/link';
import { Clock, PackageX, RotateCcw } from 'lucide-react';
import { trpc } from '@/lib/trpc';

/**
 * The three things needing a human today, pinned under the nav.
 *
 * A sidebar that only navigates makes the operator go looking for problems.
 * This makes the problems come to them, and it is the one place in the console
 * where a count is worth interrupting for.
 */
interface AlertRow {
  key: 'lateOrders' | 'outOfStock' | 'pendingReturns';
  label: string;
  href: string;
  icon: React.ElementType;
  /** Tint only — a solid fill here would compete with the active nav marker. */
  fg: string;
  bg: string;
}

export function AlertPanel({ locale }: { locale: string }) {
  // Ops counts go stale fast, but not fast enough to justify refetching on
  // every route change — the sidebar mounts on all of them.
  const { data, isLoading } = trpc.dashboard.getAlerts.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const rows: AlertRow[] = [
    {
      key: 'lateOrders',
      label: 'طلبات متأخرة',
      href: `/${locale}/orders`,
      icon: Clock,
      fg: 'var(--crimson)',
      bg: 'rgba(232,56,56,.15)',
    },
    {
      key: 'outOfStock',
      label: 'أصناف نفدت',
      href: `/${locale}/inventory`,
      icon: PackageX,
      fg: 'var(--amber)',
      bg: 'rgba(245,165,0,.15)',
    },
    {
      key: 'pendingReturns',
      label: 'مرتجعات معلقة',
      href: `/${locale}/returns`,
      icon: RotateCcw,
      fg: 'var(--azure)',
      bg: 'rgba(46,143,255,.15)',
    },
  ];

  if (isLoading) {
    // Skeletons matching the real row shape, so the panel does not resize when
    // the counts land. A spinner here would reserve no space and shift the nav.
    return (
      <div className="mt-2 space-y-1.5" aria-hidden="true">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
          يحتاج انتباهك
        </p>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-8 rounded-md bg-[var(--raised)] animate-pulse"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    );
  }

  const counts = data?.data;
  if (!counts) return null;

  const active = rows.filter((r) => counts[r.key] > 0);
  // Nothing wrong means no panel. An "all clear" box is just furniture, and it
  // would train the operator to stop reading this corner of the screen.
  if (active.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
        يحتاج انتباهك
      </p>
      <ul className="space-y-0.5">
        {active.map((row) => {
          const Icon = row.icon;
          const n = counts[row.key];
          return (
            <li key={row.key}>
              <Link
                href={row.href}
                className="flex items-center gap-2.5 rounded-md bg-[var(--raised)] px-3 py-2 text-sm transition-colors hover:bg-[var(--rim1)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]"
              >
                <Icon size={15} className="shrink-0" style={{ color: row.fg }} />
                <span className="truncate text-[var(--t2)]">{row.label}</span>
                <span
                  className="ms-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{ color: row.fg, background: row.bg }}
                  dir="ltr"
                >
                  {n.toLocaleString('ar-EG')}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
