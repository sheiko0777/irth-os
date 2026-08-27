'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingCart, Package, Boxes, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MobileBottomNav({ locale }: { locale: string }) {
  const pathname = usePathname();
  const items = [
    { href: `/${locale}`, label: 'الرئيسية', icon: Home },
    { href: `/${locale}/orders`, label: 'الطلبات', icon: ShoppingCart },
    { href: `/${locale}/products`, label: 'المنتجات', icon: Package },
    { href: `/${locale}/inventory`, label: 'المخزون', icon: Boxes },
    { href: `/${locale}/analytics`, label: 'التحليلات', icon: BarChart3 },
  ];

  return (
    <nav aria-label="التنقل الرئيسي" className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--rim1)] bg-[var(--header-bg)]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === `/${locale}` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('relative flex min-h-11 flex-col items-center justify-center gap-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)]', active ? 'text-[var(--gold)]' : 'text-[var(--t3)] hover:text-[var(--t1)]')}>
              {active && <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-[var(--gold)]" />}
              <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
