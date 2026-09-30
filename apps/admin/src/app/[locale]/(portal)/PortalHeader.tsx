'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function PortalHeader({ locale, supplierName }: { locale: string; supplierName: string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 px-3 pt-3">
      <div className="glass mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-[var(--card-radius)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--hero-from),var(--hero-to))] text-[var(--hero-fg)]" aria-hidden="true">
            <Building2 size={18} />
          </span>
          <div className="min-w-0">
            <Link href={`/${locale}/portal`} className="block text-base font-semibold leading-tight">بوابة المورد</Link>
            <p className="truncate text-xs text-[var(--text-secondary)]" data-testid="portal-supplier">{supplierName}</p>
          </div>
        </div>
        <Button
          type="button" variant="outline" size="sm"
          onClick={async () => { await signOut(); router.push(`/${locale}/login`); router.refresh(); }}
        >
          <LogOut aria-hidden="true" /> خروج
        </Button>
      </div>
    </header>
  );
}
