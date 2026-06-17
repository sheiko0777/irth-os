'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signOut, useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  Home, ShoppingCart, Package, Users, ShoppingBag,
  Plug2, BarChart2, PieChart, Tag, Box, FolderOpen,
  Bell, Settings, UserCog, FileText, Truck, RotateCcw,
  LogOut, ChevronDown, Warehouse, DollarSign, Megaphone,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: React.ElementType };
type NavGroup = { label: string; items: NavItem[] };

export function Sidebar({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const groups: NavGroup[] = [
    {
      label: 'عام',
      items: [
        { href: `/${locale}`, label: 'الرئيسية', icon: Home },
        { href: `/${locale}/orders`, label: 'الطلبات', icon: ShoppingCart },
        { href: `/${locale}/customers`, label: 'العملاء', icon: Users },
        { href: `/${locale}/notifications`, label: 'الإشعارات', icon: Bell },
      ],
    },
    {
      label: 'المخزون والمنتجات',
      items: [
        { href: `/${locale}/products`, label: 'المنتجات', icon: Box },
        { href: `/${locale}/categories`, label: 'التصنيفات', icon: FolderOpen },
        { href: `/${locale}/inventory`, label: 'المخزون', icon: Warehouse },
        { href: `/${locale}/purchasing`, label: 'المشتريات', icon: ShoppingBag },
        { href: `/${locale}/returns`, label: 'المرتجعات', icon: RotateCcw },
      ],
    },
    {
      label: 'المالية والتقارير',
      items: [
        { href: `/${locale}/finance`, label: 'المالية', icon: DollarSign },
        { href: `/${locale}/analytics`, label: 'التحليلات', icon: PieChart },
        { href: `/${locale}/coupons`, label: 'الكوبونات', icon: Tag },
        { href: `/${locale}/campaigns`, label: 'الحملات', icon: Megaphone },
      ],
    },
    {
      label: 'العمليات',
      items: [
        { href: `/${locale}/courier`, label: 'الشحن والتسوية', icon: Truck },
        { href: `/${locale}/eta`, label: 'الفواتير الإلكترونية', icon: FileText },
        { href: `/${locale}/integrations`, label: 'التكاملات', icon: Plug2 },
      ],
    },
    {
      label: 'الإعدادات',
      items: [
        { href: `/${locale}/settings`, label: 'الإعدادات', icon: Settings },
        { href: `/${locale}/settings/members`, label: 'الأعضاء', icon: UserCog },
      ],
    },
  ];

  const handleLogout = async () => {
    await signOut();
    router.push(`/${locale}/login`);
    router.refresh();
  };

  return (
    <aside className="flex h-screen w-[240px] flex-col border-l border-[var(--rim1)] bg-[var(--surface)] text-[var(--t2)] shrink-0 z-20">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b border-[var(--rim1)] gap-2 shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--gold-bg)] border border-[var(--gold-br)]">
          <span className="text-[var(--gold)] font-bold text-lg leading-none">إ</span>
        </div>
        <span className="font-bold text-[var(--t1)] font-cairo text-sm">نظام إرث</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t4)]">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((link) => {
                const Icon = link.icon;
                const isActive =
                  pathname === link.href ||
                  (link.href !== `/${locale}` && pathname.startsWith(link.href));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors border-r-2',
                      isActive
                        ? 'bg-[var(--gold-bg)] text-[var(--gold)] border-[var(--gold)] font-semibold'
                        : 'text-[var(--t2)] hover:bg-[var(--rim1)] hover:text-[var(--t1)] border-transparent'
                    )}
                  >
                    <Icon size={15} className="shrink-0 opacity-80" />
                    <span className="truncate">{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--rim1)] p-3 space-y-2 shrink-0">
        {session?.user?.email && (
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="h-6 w-6 rounded-full bg-[var(--gold-bg)] border border-[var(--gold-br)] flex items-center justify-center shrink-0">
              <span className="text-[var(--gold)] text-[10px] font-bold">
                {session.user.email[0]?.toUpperCase()}
              </span>
            </div>
            <span className="text-xs text-[var(--t3)] truncate" dir="ltr">
              {session.user.email}
            </span>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-[var(--crimson)] border-[var(--rim2)] hover:text-[var(--crimson)] hover:bg-[var(--rim1)] bg-transparent text-xs"
          onClick={handleLogout}
        >
          <LogOut size={13} />
          تسجيل الخروج
        </Button>
      </div>
    </aside>
  );
}
