'use client';

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDate } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, CheckCircle2, ChevronRight, ClipboardList, Package, Truck, Wallet } from "lucide-react";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";
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

  if (q.isLoading) return <Skeleton className="h-64 w-full rounded-[var(--card-radius)]" />;
  if (!q.data) return <p className="text-sm">أمر الشراء مش موجود.</p>;
  const { order, items, shipments } = q.data.data;
  const open = order.status === "ordered" || order.status === "partial";
  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([poItemId, quantity]) => ({ poItemId, quantity }));
  const inputClass =
    "mt-1 block min-h-11 w-full rounded-[var(--control-radius)] border border-[var(--input-border)] bg-[var(--surface)] px-3 text-base focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-soft)]";

  return (
    <div className="space-y-5">
      <Link
        href={`/${locale}/portal`}
        className="inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--accent-soft)]"
      >
        <ChevronRight size={16} aria-hidden="true" /> أوامر الشراء
      </Link>

      {/* The order at a glance: the one navy card on the screen. */}
      <section aria-labelledby="po-title" className="surface-hero rounded-[calc(var(--card-radius)+6px)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--hero-muted)]">أمر شراء</p>
            <h1 id="po-title" className="mt-0.5 font-mono text-xl font-semibold text-[var(--hero-fg)]" dir="ltr">{order.poNumber}</h1>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold" data-testid="portal-supplier-status">
            {SUPPLIER_STATUS[order.supplierStatus]}
          </span>
        </div>
        {order.orderTotalMinor !== null && (
          <p className="mt-5 text-[2rem] font-semibold leading-none tracking-tight">
            <Money minor={order.orderTotalMinor} currency={order.currency} emphasis />
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-[var(--control-radius)] bg-white/10 p-3">
            <dt className="text-xs text-[var(--hero-muted)]">الحالة</dt>
            <dd className="mt-1 font-semibold">{PO_STATUS[order.status] ?? order.status}</dd>
          </div>
          <div className="rounded-[var(--control-radius)] bg-white/10 p-3">
            <dt className="text-xs text-[var(--hero-muted)]">{order.proposedDeliveryAt ? "اقترحت" : "التسليم"}</dt>
            <dd className="mt-1 font-semibold">
              {order.proposedDeliveryAt
                ? formatDate(order.proposedDeliveryAt)
                : order.expectedDeliveryAt
                  ? formatDate(order.expectedDeliveryAt)
                  : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {open && (
        <section aria-labelledby="answer-title" className="glass space-y-4 rounded-[var(--card-radius)] p-4">
          <h2 id="answer-title" className="text-base font-semibold">ردّك على الطلب</h2>
          {order.supplierStatus !== "confirmed" && (
            <Button type="button" className="w-full sm:w-auto" disabled={confirm.isPending} onClick={() => confirm.mutate({ poId: order.id })}>
              <CheckCircle2 aria-hidden="true" /> تأكيد أمر الشراء
            </Button>
          )}
          <form
            className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end"
            onSubmit={(e) => { e.preventDefault(); propose.mutate({ poId: order.id, date: new Date(date), note: note || undefined }); }}
          >
            <label className="text-sm">موعد تسليم مقترح
              <input type="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-sm">ملاحظة
              <input maxLength={1000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Button type="submit" variant="outline" disabled={propose.isPending}>
              <CalendarClock aria-hidden="true" /> اقتراح موعد
            </Button>
          </form>
        </section>
      )}

      <section aria-labelledby="items-title" className="space-y-3">
        <h2 id="items-title" className="text-base font-semibold">البنود</h2>
        {/* One card per line, on every width: one set of controls, so each
            quantity field has exactly one label. */}
        <ul className="space-y-2">
          {items.map((i) => {
            const left = i.quantity - i.shippedQuantity;
            const shippedPct = i.quantity > 0 ? Math.min(100, Math.round((i.shippedQuantity / i.quantity) * 100)) : 0;
            return (
              <li key={i.id} className="glass space-y-3 rounded-[var(--card-radius)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]" aria-hidden="true">
                      <Package size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{i.productName}{i.variantName ? ` — ${i.variantName}` : ""}</p>
                      <p className="font-mono text-xs text-[var(--text-secondary)]" dir="ltr">{i.sku}</p>
                    </div>
                  </div>
                  {i.unitPriceMinor !== null && (
                    <Money minor={i.unitPriceMinor} currency={order.currency} className="shrink-0 font-semibold" />
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-[var(--raised)] p-2">
                    <dt className="text-[var(--text-secondary)]">المطلوب</dt>
                    <dd className="mt-0.5 text-base font-semibold tabular-nums">{i.quantity}</dd>
                  </div>
                  <div className="rounded-lg bg-[var(--raised)] p-2">
                    <dt className="text-[var(--text-secondary)]">اتبعت</dt>
                    <dd className="mt-0.5 text-base font-semibold tabular-nums">{i.shippedQuantity}</dd>
                  </div>
                  <div className="rounded-lg bg-[var(--raised)] p-2">
                    <dt className="text-[var(--text-secondary)]">اتستلم</dt>
                    <dd className="mt-0.5 text-base font-semibold tabular-nums">{i.receivedQuantity ?? 0}</dd>
                  </div>
                </dl>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-[var(--raised)]"
                  role="progressbar"
                  aria-label={`نسبة الشحن ${i.sku ?? i.productName}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={shippedPct}
                >
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${shippedPct}%` }} />
                </div>
                {open && (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>هتشحن دلوقتي <span className="text-xs text-[var(--text-secondary)]">(باقي {left})</span></span>
                    <input
                      type="number" min={0} max={left} inputMode="numeric" aria-label={`كمية الشحن ${i.sku ?? i.productName}`}
                      disabled={left <= 0}
                      className="min-h-11 w-24 rounded-[var(--control-radius)] border border-[var(--input-border)] bg-[var(--surface)] px-3 text-center text-base disabled:opacity-50"
                      value={qty[i.id] ?? ""}
                      onChange={(e) => { setQty((p) => ({ ...p, [i.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })); setKey(crypto.randomUUID()); }}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        {open && (
          <form
            className="glass grid gap-3 rounded-[var(--card-radius)] p-4 sm:grid-cols-[1fr_auto] sm:items-end"
            onSubmit={(e) => { e.preventDefault(); ship.mutate({ poId: order.id, lines, reference: reference || undefined, idempotencyKey: key }); }}
          >
            <label className="text-sm">رقم البوليصة أو المرجع
              <input maxLength={200} className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <Button type="submit" disabled={lines.length === 0 || ship.isPending}>
              <Truck aria-hidden="true" /> إرسال إشعار الشحن
            </Button>
          </form>
        )}
      </section>

      {shipments.length > 0 && (
        <section aria-labelledby="ship-title" className="space-y-3">
          <h2 id="ship-title" className="text-base font-semibold">إشعارات الشحن</h2>
          <ol className="glass divide-y divide-[var(--separator)] rounded-[var(--card-radius)] text-sm">
            {shipments.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]" aria-hidden="true">
                  <Truck size={16} />
                </span>
                <span className="font-medium">{formatDate(s.shippedAt)}</span>
                {s.reference && <span className="ms-auto font-mono text-xs text-[var(--text-secondary)]" dir="ltr">{s.reference}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <MobileTabBar
        label="أقسام البوابة"
        activeHref={`/${locale}/portal#portal-orders-section`}
        items={[
          { href: `/${locale}/portal#balance-title`, label: "كشف الحساب", icon: <Wallet /> },
          { href: `/${locale}/portal#portal-orders-section`, label: "أوامر الشراء", icon: <ClipboardList /> },
        ]}
      />
    </div>
  );
}
