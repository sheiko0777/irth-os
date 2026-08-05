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
      className="flex flex-wrap items-center gap-1 border-b border-[var(--rim1)]"
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
            className="group flex items-center gap-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]"
            style={{
              // A 2px gold underline on the active tab — the same "you are here"
              // signature as the sidebar bar and the palette row, rotated to fit
              // a horizontal strip.
              boxShadow: isActive ? 'inset 0 -2px 0 var(--gold)' : undefined,
              color: isActive ? 'var(--t1)' : 'var(--t2)',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors"
                style={{
                  background: isActive ? 'rgba(224,144,0,.15)' : 'var(--rim1)',
                  color: isActive ? 'var(--gold)' : 'var(--t3)',
                }}
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
