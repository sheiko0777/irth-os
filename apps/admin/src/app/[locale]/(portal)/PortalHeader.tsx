'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function PortalHeader({ locale, supplierName }: { locale: string; supplierName: string }) {
  const router = useRouter();
  return (
    <header className="border-b border-[var(--rim1)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 p-4">
        <div>
          <Link href={`/${locale}/portal`} className="text-lg font-bold">بوابة المورد</Link>
          <p className="text-sm text-[var(--t3)]" data-testid="portal-supplier">{supplierName}</p>
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
