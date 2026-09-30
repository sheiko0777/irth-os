'use client';

import Link from "next/link";
import { formatDate } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ClipboardList, Wallet } from "lucide-react";
import { BalanceCard } from "@/components/mobile/BalanceCard";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";

export const SUPPLIER_STATUS = { pending: "مستني ردك", confirmed: "مؤكد", date_proposed: "اقترحت موعد تاني" } as const;
export const PO_STATUS: Record<string, string> = { ordered: "مطلوب", partial: "استلام جزئي", received: "مستلم بالكامل" };

/** My purchase orders, and what I am owed (received − paid). */
export function PortalHome({ locale }: { locale: string }) {
  const orders = trpc.portal.orders.useQuery();
  const statement = trpc.portal.statement.useQuery();

  const data = statement.data?.data;
  const list = orders.data?.data ?? [];

  return (
    <div className="space-y-6">
      {statement.isLoading ? (
        <Skeleton className="h-52 w-full rounded-[calc(var(--card-radius)+6px)]" />
      ) : (
        <BalanceCard
          id="balance-title"
          label="الباقي لك"
          minor={data?.outstandingMinor ?? 0n}
          icon={<Wallet />}
          data-testid="portal-outstanding"
        >
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-[var(--control-radius)] bg-white/10 p-3">
              <dt className="text-xs text-[var(--hero-muted)]">المستلم منك</dt>
              <dd className="mt-1 font-semibold"><Money minor={data?.receivedMinor ?? 0n} /></dd>
            </div>
            <div className="rounded-[var(--control-radius)] bg-white/10 p-3">
              <dt className="text-xs text-[var(--hero-muted)]">المدفوع لك</dt>
              <dd className="mt-1 font-semibold"><Money minor={data?.paidMinor ?? 0n} /></dd>
            </div>
          </dl>
        </BalanceCard>
      )}

      <section id="portal-orders-section" aria-labelledby="orders-title" className="scroll-mt-24 space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="orders-title" className="text-base font-semibold">أوامر الشراء</h2>
          {list.length > 0 && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)] tabular-nums">
              {list.length.toLocaleString("ar-EG-u-nu-latn")}
            </span>
          )}
        </div>
        {orders.isLoading ? <Skeleton className="h-40 w-full" /> : (
          <ul className="space-y-2" data-testid="portal-orders">
            {list.length === 0 && (
              <li className="glass rounded-[var(--card-radius)] p-4 text-sm text-[var(--text-secondary)]">مفيش أوامر شراء.</li>
            )}
            {list.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/${locale}/portal/orders/${o.id}`}
                  className="glass flex items-center gap-3 rounded-[var(--card-radius)] p-3.5 transition-shadow hover:shadow-[var(--float-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]" aria-hidden="true">
                    <ClipboardList size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium" dir="ltr">{o.poNumber}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {PO_STATUS[o.status] ?? o.status} · {SUPPLIER_STATUS[o.supplierStatus]}
                      {o.expectedDeliveryAt && ` · التسليم ${formatDate(o.expectedDeliveryAt)}`}
                    </p>
                  </div>
                  {o.orderTotalMinor !== null && (
                    <Money minor={o.orderTotalMinor} currency={o.currency} className="shrink-0 font-semibold" />
                  )}
                  <ChevronLeft size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MobileTabBar
        label="أقسام البوابة"
        items={[
          { href: "#balance-title", label: "كشف الحساب", icon: <Wallet /> },
          { href: "#portal-orders-section", label: "أوامر الشراء", icon: <ClipboardList /> },
        ]}
      />
    </div>
  );
}
