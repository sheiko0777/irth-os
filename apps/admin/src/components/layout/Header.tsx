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
  const current = crumbs.at(-1) ?? 'الرئيسية';

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-[var(--rim1)] px-4 md:px-6" style={{ background: 'var(--header-bg)', backdropFilter: 'blur(18px)' }}>
      <nav aria-label="مسار الصفحة" className="min-w-0 flex items-center gap-1 text-sm">
        <span className="hidden text-xs text-[var(--t3)] md:inline">إرث</span>
        <ChevronLeft size={12} className="hidden text-[var(--t4)] md:inline" />
        <span className="truncate text-sm font-semibold text-[var(--t1)] md:text-xs md:font-medium">{current}</span>
        <span className="hidden md:flex items-center gap-1">
          {crumbs.slice(0, -1).map((crumb, i) => <span key={`${crumb}-${i}`} className="flex items-center gap-1"><ChevronLeft size={12} className="text-[var(--t4)]"/><span className="text-xs text-[var(--t3)]">{crumb}</span></span>)}
        </span>
      </nav>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('irth:palette'))} className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--t2)] hover:bg-[var(--raised)] md:hidden" aria-label="بحث وانتقال سريع"><Search size={17} aria-hidden="true" /></button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('irth:palette'))} className="hidden h-8 w-52 items-center gap-2 rounded-md border border-[var(--rim2)] bg-[var(--surface)] px-2.5 text-xs text-[var(--t3)] transition-colors hover:border-[var(--rim3)] hover:text-[var(--t2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)] md:flex" aria-label="فتح لوحة الأوامر"><Search size={13} aria-hidden="true"/><span className="truncate">بحث أو انتقال سريع</span><kbd className="ms-auto rounded-md border border-[var(--rim2)] bg-[var(--card-bg)] px-1.5 py-0.5 text-[10px]" dir="ltr">Ctrl K</kbd></button>
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
