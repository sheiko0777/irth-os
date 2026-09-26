'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { screenRequirement } from '@/lib/navigation';
import { usePermissionKeys, useVisibleNavGroups } from '@/lib/permissions';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Screen-level access (PR-1e), UX only: a member who opens a screen they have
 * no permission for sees a plain "no access" message instead of a broken
 * page, and one without the home dashboard lands on the first screen they
 * can use. The server refuses the data either way.
 */
export function ScreenGuard({ locale, children }: { locale: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const perms = usePermissionKeys();
  const groups = useVisibleNavGroups(locale);
  const required = screenRequirement(locale, pathname);
  const denied = perms !== null && required !== undefined && !perms.has(required);
  const isHome = pathname.replace(/\/$/, '') === `/${locale}`;
  // A real screen of theirs first (a rep lands on توصيلاتي, not on the
  // notifications everyone has), then anything at all.
  const items = groups.flatMap((g) => g.items).filter((i) => i.href !== `/${locale}`);
  const fallback = (items.find((i) => i.requires) ?? items[0])?.href;

  useEffect(() => {
    if (denied && isHome && fallback) router.replace(fallback);
  }, [denied, isHome, fallback, router]);

  if (!denied) return <>{children}</>;
  if (isHome && fallback) return null;
  return (
    <EmptyState
      icon={ShieldOff}
      title="مالكش صلاحية على الشاشة دي"
      hint="لو محتاجها في شغلك، اطلبها من مدير الحساب."
    />
  );
}
