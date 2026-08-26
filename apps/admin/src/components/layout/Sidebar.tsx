'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signOut, useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { AlertPanel } from '@/components/layout/AlertPanel';
import { OrgSwitcher } from '@/components/layout/OrgSwitcher';
import { LogOut, Shield } from 'lucide-react';
import { buildNavGroups } from '@/lib/navigation';

export function Sidebar({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  // Single source shared with the command palette — see lib/navigation.ts.
  const groups = buildNavGroups(locale);

  const handleLogout = async () => {
    await signOut();
    router.push(`/${locale}/login`);
    router.refresh();
  };

  return (
    <aside className="flex h-screen w-[240px] flex-col border-e border-[var(--rim1)] bg-[var(--surface)] text-[var(--t2)] shrink-0 z-20">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b border-[var(--rim1)] gap-2 shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--gold-bg)] border border-[var(--gold-br)]">
          <span className="text-[var(--gold)] font-bold text-lg leading-none">إ</span>
        </div>
        <span className="font-bold text-[var(--t1)] text-sm">نظام إرث</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {/* Sits above the nav groups on purpose: what is broken outranks where
            you might want to go. */}
        <AlertPanel locale={locale} />
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
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
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors border-s-2',
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
        {process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL &&
          session?.user?.email === process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL && (
          <div className="mt-2">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
              النظام
            </p>
            <div className="space-y-0.5">
              <Link
                href={`/${locale}/platform-admin`}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors border-s-2',
                  pathname.startsWith(`/${locale}/platform-admin`)
                    ? 'bg-[var(--gold-bg)] text-[var(--gold)] border-[var(--gold)] font-semibold'
                    : 'text-[var(--t2)] hover:bg-[var(--rim1)] hover:text-[var(--t1)] border-transparent'
                )}
              >
                <Shield size={15} className="shrink-0 opacity-80" />
                <span className="truncate">لوحة الأدمن</span>
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--rim1)] p-3 space-y-2 shrink-0">
        <OrgSwitcher />
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