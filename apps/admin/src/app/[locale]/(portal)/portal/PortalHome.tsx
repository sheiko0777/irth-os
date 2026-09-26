'use client';

import Link from "next/link";
import { formatDate } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/skeleton";

export const SUPPLIER_STATUS = { pending: "مستني ردك", confirmed: "مؤكد", date_proposed: "اقترحت موعد تاني" } as const;
export const PO_STATUS: Record<string, string> = { ordered: "مطلوب", partial: "استلام جزئي", received: "مستلم بالكامل" };

/** My purchase orders, and what I am owed (received − paid). */
export function PortalHome({ locale }: { locale: string }) {
  const orders = trpc.portal.orders.useQuery();
  const statement = trpc.portal.statement.useQuery();

  return (
    <div className="space-y-6">
      <section aria-labelledby="balance-title" className="rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4">
        <h2 id="balance-title" className="mb-3 font-semibold">كشف الحساب</h2>
        {statement.isLoading ? <Skeleton className="h-16 w-full" /> : (
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-[var(--t3)]">المستلم منك</dt><dd><Money minor={statement.data?.data.receivedMinor ?? 0n} /></dd></div>
            <div><dt className="text-[var(--t3)]">المدفوع لك</dt><dd><Money minor={statement.data?.data.paidMinor ?? 0n} /></dd></div>
            <div>
              <dt className="text-[var(--t3)]">الباقي لك</dt>
              <dd className="font-bold"><Money minor={statement.data?.data.outstandingMinor ?? 0n} data-testid="portal-outstanding" /></dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-labelledby="orders-title" className="space-y-2">
        <h2 id="orders-title" className="font-semibold">أوامر الشراء</h2>
        {orders.isLoading ? <Skeleton className="h-40 w-full" /> : (
          <ul className="divide-y divide-[var(--rim1)] rounded-md border border-[var(--rim1)] bg-[var(--surface)]" data-testid="portal-orders">
            {(orders.data?.data ?? []).length === 0 && <li className="p-3 text-sm text-[var(--t3)]">مفيش أوامر شراء.</li>}
            {(orders.data?.data ?? []).map((o) => (
              <li key={o.id}>
                <Link href={`/${locale}/portal/orders/${o.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-raised">
                  <div>
                    <p className="font-mono text-sm" dir="ltr">{o.poNumber}</p>
                    <p className="text-xs text-[var(--t3)]">
                      {PO_STATUS[o.status] ?? o.status} · {SUPPLIER_STATUS[o.supplierStatus]}
                      {o.expectedDeliveryAt && ` · التسليم ${formatDate(o.expectedDeliveryAt)}`}
                    </p>
                  </div>
                  {o.orderTotalMinor !== null && <Money minor={o.orderTotalMinor} currency={o.currency} />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
