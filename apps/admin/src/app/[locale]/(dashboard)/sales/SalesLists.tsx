'use client';

import { useRef } from "react";
import { toast } from "sonner";
import { formatDate } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { StatusBadge } from "@/components/ui/StatusBadge";

const QUOTE_STATUS = { open: "مفتوح", converted: "اتحوّل لطلب", cancelled: "ملغي" } as const;

/** My orders and my quotes; an open, valid quote converts to an order once. */
export function SalesLists() {
  const can = useCan();
  const utils = trpc.useUtils();
  const orders = trpc.sales.orders.useQuery();
  const quotes = trpc.sales.quotes.useQuery();
  const keys = useRef(new Map<string, string>());
  const keyFor = (id: string) => {
    let k = keys.current.get(id);
    if (!k) { k = crypto.randomUUID(); keys.current.set(id, k); }
    return k;
  };

  const convert = trpc.sales.convertQuote.useMutation({
    onSuccess: ({ data }, vars) => { keys.current.delete(vars.quoteId); toast.success(`اتعمل الطلب ${data.orderNumber}`); void utils.sales.invalidate(); },
    onError: (err) => toast.error(err.message || "تعذر تحويل عرض السعر"),
  });
  const cancel = trpc.sales.cancelQuote.useMutation({
    onSuccess: () => { toast.success("اتلغى عرض السعر"); void utils.sales.quotes.invalidate(); },
    onError: (err) => toast.error(err.message || "تعذر الإلغاء"),
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="my-orders" className="space-y-2">
        <h2 id="my-orders" className="font-semibold">طلباتي</h2>
        <ul className="divide-y divide-[var(--rim1)] rounded-md border border-[var(--rim1)] bg-[var(--surface)] text-sm" data-testid="sales-orders">
          {(orders.data?.data ?? []).length === 0 && <li className="p-3 text-[var(--t3)]">مفيش طلبات لسه.</li>}
          {(orders.data?.data ?? []).map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 p-3">
              <div>
                <p className="font-mono" dir="ltr">{o.orderNumber}</p>
                <p className="text-xs text-[var(--t3)]">{o.customerName ?? "—"} · {o.createdAt ? formatDate(o.createdAt) : ""}</p>
              </div>
              <div className="text-end">
                <StatusBadge status={o.status} domain="order" />
                <p><Money minor={o.totalAmountMinor} currency={o.currency} /></p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="my-quotes" className="space-y-2">
        <h2 id="my-quotes" className="font-semibold">عروض الأسعار</h2>
        <ul className="divide-y divide-[var(--rim1)] rounded-md border border-[var(--rim1)] bg-[var(--surface)] text-sm" data-testid="sales-quotes">
          {(quotes.data?.data ?? []).length === 0 && <li className="p-3 text-[var(--t3)]">مفيش عروض أسعار.</li>}
          {(quotes.data?.data ?? []).map(({ quote: q, customerName }) => {
            const expired = new Date(q.validUntil) < new Date();
            return (
              <li key={q.id} className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-mono" dir="ltr">{q.quoteNumber}</p>
                    <p className="text-xs text-[var(--t3)]">{customerName ?? "—"} · صالح لحد {formatDate(q.validUntil)}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-xs">{expired && q.status === "open" ? "انتهت صلاحيته" : QUOTE_STATUS[q.status]}</p>
                    <Money minor={q.totalMinor} currency={q.currency} />
                  </div>
                </div>
                {q.status === "open" && !expired && (
                  <div className="flex gap-2">
                    {can("sales", "order") && (
                      <Button type="button" size="sm" disabled={convert.isPending}
                        onClick={() => convert.mutate({ quoteId: q.id, idempotencyKey: keyFor(q.id) })}>
                        تحويل لطلب
                      </Button>
                    )}
                    {can("sales", "quote") && (
                      <Button type="button" size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate({ quoteId: q.id })}>
                        إلغاء
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
