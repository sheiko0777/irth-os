'use client';

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDate } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { PO_STATUS, SUPPLIER_STATUS } from "../../PortalHome";

/**
 * One purchase order, from the supplier's side: confirm it, or propose another
 * delivery date; and announce a shipment line by line, never more than is
 * left (the server holds that line under a lock). One idempotency key per
 * notice, kept until it is sent.
 */
export function PortalOrder({ locale, id }: { locale: string; id: string }) {
  const utils = trpc.useUtils();
  const q = trpc.portal.get.useQuery({ id });
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const refresh = () => { void utils.portal.invalidate(); };

  const confirm = trpc.portal.confirm.useMutation({
    onSuccess: () => { toast.success("اتأكد أمر الشراء"); refresh(); },
    onError: (err) => toast.error(err.message || "تعذر التأكيد"),
  });
  const propose = trpc.portal.proposeDate.useMutation({
    onSuccess: () => { toast.success("اتبعت الموعد المقترح"); refresh(); },
    onError: (err) => toast.error(err.message || "تعذر الإرسال"),
  });
  const ship = trpc.portal.shipNotice.useMutation({
    onSuccess: () => { toast.success("اتبعت إشعار الشحن"); setQty({}); setReference(""); setKey(crypto.randomUUID()); refresh(); },
    onError: (err) => toast.error(err.message || "تعذر إرسال الإشعار"),
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!q.data) return <p className="text-sm">أمر الشراء مش موجود.</p>;
  const { order, items, shipments } = q.data.data;
  const open = order.status === "ordered" || order.status === "partial";
  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([poItemId, quantity]) => ({ poItemId, quantity }));

  return (
    <div className="space-y-6">
      <Link href={`/${locale}/portal`} className="text-sm text-[var(--t2)] hover:underline">← أوامر الشراء</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-bold" dir="ltr">{order.poNumber}</h1>
          <p className="text-sm text-[var(--t3)]">
            {PO_STATUS[order.status] ?? order.status} · <span data-testid="portal-supplier-status">{SUPPLIER_STATUS[order.supplierStatus]}</span>
            {order.expectedDeliveryAt && ` · التسليم ${formatDate(order.expectedDeliveryAt)}`}
            {order.proposedDeliveryAt && ` · اقترحت ${formatDate(order.proposedDeliveryAt)}`}
          </p>
        </div>
        {order.orderTotalMinor !== null && <Money minor={order.orderTotalMinor} currency={order.currency} className="text-lg font-bold" />}
      </div>

      {open && (
        <section aria-labelledby="answer-title" className="space-y-3 rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <h2 id="answer-title" className="font-semibold">ردّك على الطلب</h2>
          {order.supplierStatus !== "confirmed" && (
            <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate({ poId: order.id })}>تأكيد أمر الشراء</Button>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); propose.mutate({ poId: order.id, date: new Date(date), note: note || undefined }); }}
          >
            <label className="text-sm">موعد تسليم مقترح
              <input type="date" required className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-sm grow">ملاحظة
              <input maxLength={1000} className="mt-1 block h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Button type="submit" variant="outline" disabled={propose.isPending}>اقتراح موعد</Button>
          </form>
        </section>
      )}

      <section aria-labelledby="items-title" className="space-y-2">
        <h2 id="items-title" className="font-semibold">البنود</h2>
        <div className="overflow-x-auto rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="bg-raised text-[var(--t2)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">البند</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">المطلوب</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">اتبعت</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">اتستلم</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">السعر</th>
                {open && <th scope="col" className="px-3 py-2 text-start font-medium">هتشحن دلوقتي</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const left = i.quantity - i.shippedQuantity;
                return (
                  <tr key={i.id} className="border-t border-[var(--rim1)]">
                    <td className="px-3 py-1.5">{i.productName}{i.variantName ? ` — ${i.variantName}` : ""} <span className="text-xs text-[var(--t3)]" dir="ltr">{i.sku}</span></td>
                    <td className="px-3 py-1.5 tabular-nums">{i.quantity}</td>
                    <td className="px-3 py-1.5 tabular-nums">{i.shippedQuantity}</td>
                    <td className="px-3 py-1.5 tabular-nums">{i.receivedQuantity ?? 0}</td>
                    <td className="px-3 py-1.5">{i.unitPriceMinor !== null ? <Money minor={i.unitPriceMinor} currency={order.currency} /> : "—"}</td>
                    {open && (
                      <td className="px-3 py-1.5">
                        <input type="number" min={0} max={left} inputMode="numeric" aria-label={`كمية الشحن ${i.sku ?? i.productName}`}
                          disabled={left <= 0}
                          className="h-8 w-20 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                          value={qty[i.id] ?? ""}
                          onChange={(e) => { setQty((p) => ({ ...p, [i.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })); setKey(crypto.randomUUID()); }} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); ship.mutate({ poId: order.id, lines, reference: reference || undefined, idempotencyKey: key }); }}
          >
            <label className="text-sm">رقم البوليصة أو المرجع
              <input maxLength={200} className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <Button type="submit" disabled={lines.length === 0 || ship.isPending}>إرسال إشعار الشحن</Button>
          </form>
        )}
      </section>

      {shipments.length > 0 && (
        <section aria-labelledby="ship-title" className="space-y-2">
          <h2 id="ship-title" className="font-semibold">إشعارات الشحن</h2>
          <ul className="divide-y divide-[var(--rim1)] rounded-md border border-[var(--rim1)] bg-[var(--surface)] text-sm">
            {shipments.map((s) => (
              <li key={s.id} className="p-3">{formatDate(s.shippedAt)}{s.reference ? ` · ${s.reference}` : ""}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
