'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signOut, useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function Sidebar({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const links = [
    { href: `/${locale}`, label: 'الرئيسية' },
    { href: `/${locale}/products`, label: 'المنتجات' },
    { href: `/${locale}/categories`, label: 'التصنيفات' },
    { href: `/${locale}/notifications`, label: 'الإشعارات' },
    { href: `/${locale}/settings`, label: 'الإعدادات' },
    { href: `/${locale}/settings/members`, label: 'الأعضاء' },
  ];

  const handleLogout = async () => {
    await signOut();
    router.push(`/${locale}/login`);
    router.refresh();
  };

  return (
    <aside className="flex h-screen w-[240px] flex-col border-l border-[var(--rim1)] bg-[var(--surface)] text-[var(--t2)] shrink-0 z-20 transition-all duration-300">
      <div className="flex h-14 items-center px-6 border-b border-[var(--rim1)]">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--gold-bg)] border border-[var(--gold-br)]">
            <span className="text-[var(--gold)] font-bold text-lg leading-none">إ</span>
          </div>
          <span className="font-bold text-[var(--t1)] font-cairo">نظام إرث</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
        {links.map((link) => {
          const isActive = pathname === link.href || (link.href !== `/${locale}` && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive 
                  ? "bg-[var(--gold-bg)] text-[var(--gold)] border-r-2 border-[var(--gold)] font-semibold" 
                  : "text-[var(--t2)] hover:bg-[var(--rim1)] hover:text-[var(--t1)] border-r-2 border-transparent"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      
      <div className="border-t border-[var(--rim1)] p-4 space-y-4">
        {session?.user?.email && (
          <div className="text-sm text-[var(--t3)] truncate px-2" dir="ltr">
            {session.user.email}
          </div>
        )}
        <Button 
          variant="outline" 
          className="w-full justify-start text-[var(--crimson)] border-[var(--rim2)] hover:text-[var(--crimson)] hover:bg-[var(--rim1)] bg-transparent" 
          onClick={handleLogout}
        >
          تسجيل الخروج
        </Button>
      </div>
    </aside>
  );
}
