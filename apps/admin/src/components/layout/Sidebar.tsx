'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signOut, useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { AlertPanel } from '@/components/layout/AlertPanel';
import { OrgSwitcher } from '@/components/layout/OrgSwitcher';
import { LogOut, Shield, X } from 'lucide-react';
import { buildNavGroups } from '@/lib/navigation';
import { canSeeScreen, useAccess } from '@/lib/permissions';

/** Collapsed-rail width. Wide enough for a centered 15px icon with breathing room. */
const RAIL = 'w-16';
/** Expanded width — unchanged from the original static sidebar. */
const FULL = 'w-[240px]';

export function Sidebar({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { accessPolicy, permissionOverrides, assignedWarehouseIds } = useAccess();
  // Never fully hidden on any breakpoint: collapsed = icon-only rail (always
  // visible, reserves its own gutter — see the `me-16` on DashboardLayout's
  // content wrapper), expanded = the original full-width sidebar, overlaid
  // with a scrim below `lg` (240px is too much of a 375px screen to
  // permanently push) and pushing content normally at `lg`+ (`lg:static`
  // below, so flex layout reserves the space itself — no gutter needed there).
  const [expanded, setExpanded] = useState(false);

  // Decoupled from Header's trigger the same way CommandPalette is (see its
  // own 'irth:palette' event) — keeps Sidebar and Header as plain siblings
  // under DashboardLayout with no shared state/context to wire up.
  useEffect(() => {
    const toggle = () => setExpanded((e) => !e);
    window.addEventListener('irth:sidebar-toggle', toggle);
    return () => window.removeEventListener('irth:sidebar-toggle', toggle);
  }, []);

  // Tapping a nav link collapses back to the rail — no reason to keep
  // covering the screen once a destination is picked.
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  // Single source shared with the command palette — see lib/navigation.ts.
  const hasWarehouseScope = Boolean(accessPolicy && assignedWarehouseIds.length > 0);
  const groups = buildNavGroups(locale)
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !(hasWarehouseScope && item.href.endsWith('/inventory/lots')))
        .map((item) => hasWarehouseScope && item.href.endsWith('/inventory')
          ? { ...item, href: `/${locale}/inventory/lots`, label: locale === 'ar' ? 'مخزوني' : 'My warehouse' }
          : item)
        .filter((item) => {
        const segments = item.href.split('/').filter(Boolean);
        const screen = segments.at(-1) === 'lots' ? 'inventory' : segments.at(-1);
        return !screen || canSeeScreen(screen, accessPolicy, permissionOverrides);
        }),
    }))
    .filter((group) => group.items.length > 0);

  const handleLogout = async () => {
    await signOut();
    router.push(`/${locale}/login`);
    router.refresh();
  };

  return (
    <>
      {/* Scrim — mobile only, only while expanded over content. At `lg`+ the
          sidebar pushes rather than overlays, so no scrim is ever needed there. */}
      {expanded && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          // `end-0` (not `right-0`) so the rail sits at the same edge the
          // static desktop sidebar already occupies in both locales — `border-e`
          // below confirms that edge is the logical trailing one, not a
          // hardcoded side.
          'fixed inset-y-0 end-0 z-40 flex h-screen flex-col overflow-hidden border-e border-[var(--rim1)] bg-[var(--surface)] text-[var(--t2)] shrink-0',
          'transition-[width] duration-200 ease-out',
          'lg:static',
          expanded ? FULL : RAIL
        )}
      >
        {/* Logo */}
        <div className={cn('flex h-14 items-center border-b border-[var(--rim1)] gap-2 shrink-0', expanded ? 'px-4' : 'justify-center px-2')}>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--gold-bg)] border border-[var(--gold-br)] shrink-0">
            <Image src="/logo-mark.png" alt="إرث" width={22} height={22} className="object-contain" priority />
          </div>
          {expanded && <span className="font-bold text-[var(--t1)] text-sm truncate">نظام إرث</span>}
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ms-auto lg:hidden rounded-md p-1.5 text-[var(--t3)] transition-colors hover:bg-[var(--rim1)] hover:text-[var(--t1)] shrink-0"
              aria-label="إغلاق القائمة"
            >
              <X size={16} />
            </button>
          )}
        </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {/* Sits above the nav groups on purpose: what is broken outranks where
            you might want to go. Text-heavy (counts + labels) with no
            collapsed variant of its own — simplest correct behavior is to
            only show it once there's room. */}
        {expanded && <AlertPanel locale={locale} />}
        {groups.map((group) => (
          <div key={group.label}>
            {expanded && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                {group.label}
              </p>
            )}
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
                    title={expanded ? undefined : link.label}
                    className={cn(
                      'flex items-center rounded-md py-2 text-sm font-medium transition-colors border-s-2',
                      expanded ? 'gap-2.5 px-3' : 'justify-center px-0',
                      isActive
                        ? 'bg-[var(--gold-bg)] text-[var(--gold)] border-[var(--gold)] font-semibold'
                        : 'text-[var(--t2)] hover:bg-[var(--rim1)] hover:text-[var(--t1)] border-transparent'
                    )}
                  >
                    <Icon size={15} className="shrink-0 opacity-80" />
                    {expanded && <span className="truncate">{link.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL &&
          session?.user?.email === process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL && (
          <div className="mt-2">
            {expanded && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                النظام
              </p>
            )}
            <div className="space-y-0.5">
              <Link
                href={`/${locale}/platform-admin`}
                title={expanded ? undefined : 'لوحة الأدمن'}
                className={cn(
                  'flex items-center rounded-md py-2 text-sm font-medium transition-colors border-s-2',
                  expanded ? 'gap-2.5 px-3' : 'justify-center px-0',
                  pathname.startsWith(`/${locale}/platform-admin`)
                    ? 'bg-[var(--gold-bg)] text-[var(--gold)] border-[var(--gold)] font-semibold'
                    : 'text-[var(--t2)] hover:bg-[var(--rim1)] hover:text-[var(--t1)] border-transparent'
                )}
              >
                <Shield size={15} className="shrink-0 opacity-80" />
                {expanded && <span className="truncate">لوحة الأدمن</span>}
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className={cn('border-t border-[var(--rim1)] p-3 space-y-2 shrink-0', !expanded && 'flex flex-col items-center')}>
        {expanded && <OrgSwitcher />}
        {session?.user?.email && (
          <div className={cn('flex items-center gap-2', expanded ? 'px-2 py-1' : 'py-1')} title={expanded ? undefined : session.user.email}>
            <div className="h-6 w-6 rounded-full bg-[var(--gold-bg)] border border-[var(--gold-br)] flex items-center justify-center shrink-0">
              <span className="text-[var(--gold)] text-[10px] font-bold">
                {session.user.email[0]?.toUpperCase()}
              </span>
            </div>
            {expanded && (
              <span className="text-xs text-[var(--t3)] truncate" dir="ltr">
                {session.user.email}
              </span>
            )}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          title={expanded ? undefined : 'تسجيل الخروج'}
          className={cn(
            'text-[var(--crimson)] border-[var(--rim2)] hover:text-[var(--crimson)] hover:bg-[var(--rim1)] bg-transparent text-xs',
            expanded ? 'w-full justify-start gap-2' : 'w-9 p-0 justify-center'
          )}
          onClick={handleLogout}
        >
          <LogOut size={13} />
          {expanded && 'تسجيل الخروج'}
        </Button>
      </div>
      </aside>
    </>
  );
}
