'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export interface FilterTab {
  /** Query value. `undefined` is the "all" tab — it drops the param entirely. */
  value?: string;
  label: string;
  count?: number;
}

interface FilterTabsProps {
  /** The query-string key this strip owns, e.g. `status`. */
  param: string;
  tabs: FilterTab[];
}

/**
 * URL-backed filter tabs.
 *
 * State lives in the query string rather than component state, so a filtered
 * view is shareable, survives a reload, and lands correctly from browser
 * history. That also keeps the server component the single fetcher: it reads
 * searchParams and queries once, instead of the client re-fetching after mount.
 *
 * Renders as links, not buttons — middle-click and open-in-new-tab work, which
 * matters when an operator is comparing two filtered views side by side.
 */
export function FilterTabs({ param, tabs }: FilterTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? undefined;

  const hrefFor = (value?: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(param, value);
    else next.delete(param);
    // Any filter change invalidates the current page offset.
    next.delete('page');
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div
      className="glass inline-flex max-w-full flex-wrap items-center gap-1 rounded-[var(--control-radius)] p-1"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === current;
        return (
          <Link
            key={tab.value ?? '__all'}
            href={hrefFor(tab.value)}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            // Segmented chips: the active one is the navy pill, the same
            // "you are here" signature as the active sidebar link.
            className={
              'flex min-h-9 items-center gap-2 rounded-[calc(var(--control-radius)-4px)] px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ' +
              (isActive
                ? 'bg-[var(--accent)] font-semibold text-[var(--accent-fg)] shadow-[0_6px_14px_-8px_var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]')
            }
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ' +
                  (isActive ? 'bg-white/20 text-[var(--accent-fg)]' : 'bg-[var(--raised)] text-[var(--text-secondary)]')
                }
                dir="ltr"
              >
                {tab.count.toLocaleString('ar-EG')}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
