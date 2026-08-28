'use client';

import { usePathname } from 'next/navigation';
import { NotificationBell } from './NotificationBell';
import { ChevronLeft, Menu, Search } from 'lucide-react';
import { routeLabels } from '@/lib/routeLabels';

export function Header({ locale }: { locale: string }) {
  const pathname = usePathname();

  // Build breadcrumb from pathname segments, skip locale
  const segments = pathname.split('/').filter(Boolean).filter(s => s !== locale);
  const crumbs = segments.map(seg => routeLabels[seg] ?? seg);

  return (
    <header
      className="flex h-[56px] items-center justify-between px-6 border-b border-[var(--rim1)] shrink-0 z-10 sticky top-0"
      style={{ background: 'rgba(6,10,16,.92)', backdropFilter: 'blur(16px)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Opens Sidebar's off-canvas drawer below `lg` — see the matching
            listener there, same decoupled-event pattern as the palette
            trigger below. */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('irth:sidebar-toggle'))}
          className="lg:hidden flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--t2)] transition-colors hover:bg-[var(--rim1)] hover:text-[var(--t1)]"
          aria-label="فتح القائمة"
        >
          <Menu size={18} />
        </button>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
          <span className="text-[var(--t3)] hover:text-[var(--t1)] transition-colors cursor-pointer text-xs shrink-0">
            إرث
          </span>
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1 min-w-0">
              <ChevronLeft size={12} className="text-[var(--t4)] shrink-0" />
              <span
                className={
                  (i === crumbs.length - 1
                    ? 'text-[var(--t1)] font-medium text-xs'
                    : 'text-[var(--t3)] text-xs') + ' truncate'
                }
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Icon-only fallback below `md`, where the full search box (below)
            is hidden — otherwise the palette had no mobile entry point at all. */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('irth:palette'))}
          className="md:hidden flex h-8 w-8 items-center justify-center rounded-md border border-[var(--rim2)] bg-[var(--surface)] text-[var(--t3)] transition-colors hover:border-[var(--rim3)] hover:text-[var(--t2)]"
          aria-label="فتح لوحة الأوامر"
        >
          <Search size={14} />
        </button>
        {/* Looks like an input, acts as a button: the affordance teaches the
            shortcut. Dispatches an event so the palette needs no prop drilling. */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('irth:palette'))}
          className="hidden md:flex items-center gap-2 h-8 w-52 rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-2.5 text-xs text-[var(--t3)] transition-colors hover:border-[var(--rim3)] hover:text-[var(--t2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]"
          aria-label="فتح لوحة الأوامر"
        >
          <Search size={13} aria-hidden="true" />
          <span className="truncate">بحث أو انتقال سريع</span>
          <kbd
            className="ms-auto rounded-md border border-[var(--rim2)] bg-[var(--card-bg)] px-1.5 py-0.5 text-[10px]"
            dir="ltr"
          >
            Ctrl K
          </kbd>
        </button>
        <NotificationBell />
      </div>
    </header>
  );
}
