'use client';

import { usePathname } from 'next/navigation';
import { NotificationBell } from './NotificationBell';
import { ChevronLeft } from 'lucide-react';

const routeLabels: Record<string, string> = {
  orders:        'الطلبات',
  products:      'المنتجات',
  inventory:     'المخزون',
  customers:     'العملاء',
  purchasing:    'المشتريات',
  integrations:  'التكاملات',
  finance:       'المالية والتقارير',
  analytics:     'التحليلات',
  coupons:       'الكوبونات',
  categories:    'التصنيفات',
  notifications: 'الإشعارات',
  settings:      'الإعدادات',
  members:       'الأعضاء',
  eta:           'الفواتير الإلكترونية',
  courier:       'الشحن والتسوية',
  returns:       'المرتجعات',
  campaigns:     'الحملات',
  stocktaking:   'الجرد',
  pricelists:    'قوائم الأسعار',
  shipping:      'مناطق الشحن',
};

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
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm">
        <span className="text-[var(--t3)] hover:text-[var(--t1)] transition-colors cursor-pointer text-xs">
          إرث
        </span>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronLeft size={12} className="text-[var(--t4)]" />
            <span
              className={
                i === crumbs.length - 1
                  ? 'text-[var(--t1)] font-medium text-xs'
                  : 'text-[var(--t3)] text-xs'
              }
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <NotificationBell />
      </div>
    </header>
  );
}
