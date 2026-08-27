'use client';

import { usePathname } from 'next/navigation';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { ChevronLeft, Search } from 'lucide-react';
import { routeLabels } from '@/lib/routeLabels';

export function Header({ locale }: { locale: string }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean).filter(s => s !== locale);
  const crumbs = segments.map(seg => routeLabels[seg] ?? seg);

  return (
    <header
      className="flex h-[56px] items-center justify-between px-6 border-b border-[var(--rim1)] shrink-0 z-10 sticky top-0"
      style={{ background: 'var(--header-bg)', backdropFilter: 'blur(16px)' }}
    >
      <nav className="flex items-center gap-1 text-sm">
        <span className="text-[var(--t3)] hover:text-[var(--t1)] transition-colors cursor-pointer text-xs">إرث</span>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronLeft size={12} className="text-[var(--t4)]" />
            <span className={i === crumbs.length - 1 ? 'text-[var(--t1)] font-medium text-xs' : 'text-[var(--t3)] text-xs'}>{crumb}</span>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('irth:palette'))} className="hidden md:flex items-center gap-2 h-8 w-52 rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-2.5 text-xs text-[var(--t3)] transition-colors hover:border-[var(--rim3)] hover:text-[var(--t2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]" aria-label="فتح لوحة الأوامر">
          <Search size={13} aria-hidden="true" /><span className="truncate">بحث أو انتقال سريع</span><kbd className="ms-auto rounded-md border border-[var(--rim2)] bg-[var(--card-bg)] px-1.5 py-0.5 text-[10px]" dir="ltr">Ctrl K</kbd>
        </button>
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
