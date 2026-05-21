'use client';

import { NotificationBell } from './NotificationBell';

export function Header({ locale }: { locale: string }) {
  return (
    <header
      className="flex h-[56px] items-center justify-between px-6 border-b border-[var(--rim1)] shrink-0 z-10 sticky top-0"
      style={{
        background: 'rgba(6,10,16,.92)',
        backdropFilter: 'blur(16px)'
      }}
    >
      <div className="flex-1">
        {/* Placeholder for future header items like search or breadcrumbs */}
      </div>
      <div className="flex items-center gap-4">
        <NotificationBell locale={locale} />
      </div>
    </header>
  );
}
