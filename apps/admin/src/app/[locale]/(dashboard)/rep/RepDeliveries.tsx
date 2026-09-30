'use client';

import { useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Package, Phone, Truck } from "lucide-react";
import { currency, fromMinor, toDecimalString } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";

type Undelivered = "failed" | "returned";

/**
 * One card per assigned order: who, where, how much to collect, and the three
 * outcomes. Each order keeps one idempotency key until its delivery succeeds,
 * so a retried tap on a weak connection cannot deliver or collect twice (the
 * server also refuses a second collection per order outright).
 */
export function RepDeliveries() {
  const utils = trpc.useUtils();
  const today = trpc.deliveries.today.useQuery();
  const keys = useRef(new Map<string, string>());
  const keyFor = (orderId: string) => {
    let k = keys.current.get(orderId);
    if (!k) { k = crypto.randomUUID(); keys.current.set(orderId, k); }
    return k;
  };
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ orderId: string; kind: "deliver" | Undelivered } | null>(null);

  const refresh = () => {
    void utils.deliveries.today.invalidate();
    void utils.deliveries.myCash.invalidate();
  };
  const deliver = trpc.deliveries.markDelivered.useMutation({
    onSuccess: (_res, vars) => {
      keys.current.delete(vars.orderId);
      toast.success("اتسجّل التسليم");
      setOpen(null);
      refresh();
    },
    onError: (err) => toast.error(err.message || "تعذر تسجيل التسليم"),
  });
  const undelivered = trpc.deliveries.markUndelivered.useMutation({
    onSuccess: () => {
      toast.success("اتسجّل");
      setOpen(null);
      refresh();
    },
    onError: (err) => toast.error(err.message || "تعذر التسجيل"),
  });

  if (today.isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = today.data?.data ?? [];
  if (rows.length === 0) {
    return <EmptyState icon={Truck} title="مفيش طلبات مسندة ليك دلوقتي" hint="لما المكتب يسند لك طلبات هتظهر هنا." />;
  }

  return (
    <ul className="space-y-3" aria-label="الطلبات المسندة">
      {rows.map((o) => {
        const phone = o.shippingAddress?.phone ?? o.buyer?.phone ?? null;
        const address = [o.shippingAddress?.address1, o.shippingAddress?.address2, o.shippingAddress?.city].filter(Boolean).join("، ");
        const due = o.codDueMinor;
        const prefill = due > 0n ? toDecimalString(fromMinor(due, currency(o.currency))) : "";
        const isOpen = open?.orderId === o.id;
        return (
          <li key={o.id} className="glass space-y-4 rounded-[var(--card-radius)] p-4" data-testid="rep-order">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]" aria-hidden="true">
                  <Package size={20} />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{o.shippingAddress?.name ?? o.buyer?.name ?? "—"}</p>
                  <p className="font-mono text-xs text-[var(--text-secondary)]" dir="ltr">{o.orderNumber}</p>
                  <p className="mt-1 inline-flex items-start gap-1 text-sm text-[var(--text-secondary)]">
                    <MapPin size={14} className="mt-1 shrink-0" aria-hidden="true" />
                    {address || "—"}
                  </p>
                  {o.customerNote && <p className="mt-1 text-xs text-[var(--text-secondary)]">ملاحظة: {o.customerNote}</p>}
                </div>
              </div>
              <div className="shrink-0 text-end">
                <p
                  className={
                    "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                    (due > 0n ? "bg-[var(--warning-bg)] text-[var(--warning)]" : "bg-[var(--success-bg)] text-[var(--success)]")
                  }
                >
                  {due > 0n ? "تحصيل" : "مدفوع"}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  <Money minor={due > 0n ? due : o.totalAmountMinor} currency={o.currency} />
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button type="button" className="col-span-2" onClick={() => setOpen({ orderId: o.id, kind: "deliver" })}>
                <CheckCircle2 aria-hidden="true" /> تم التسليم
              </Button>
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--control-radius)] bg-[var(--success-bg)] px-4 text-sm font-medium text-[var(--success)] transition-colors hover:brightness-95 sm:col-span-1"
                >
                  <Phone size={16} aria-hidden="true" /> اتصال
                </a>
              )}
              <Button type="button" variant="outline" onClick={() => setOpen({ orderId: o.id, kind: "failed" })}>فشل</Button>
              <Button type="button" variant="outline" onClick={() => setOpen({ orderId: o.id, kind: "returned" })}>مرتجع</Button>
            </div>

            {isOpen && open.kind === "deliver" && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  deliver.mutate({
                    orderId: o.id,
                    collected: due > 0n ? (amounts[o.id] ?? prefill) : undefined,
                    idempotencyKey: keyFor(o.id),
                  });
                }}
              >
                {due > 0n && (
                  <label className="text-sm">
                    المبلغ المحصّل (ج.م)
                    <input
                      inputMode="decimal"
                      dir="ltr"
                      className="mt-1 block min-h-11 w-36 rounded-[var(--control-radius)] border border-[var(--input-border)] bg-[var(--surface)] px-3 text-base"
                      value={amounts[o.id] ?? prefill}
                      onChange={(e) => setAmounts((a) => ({ ...a, [o.id]: e.target.value }))}
                    />
                  </label>
                )}
                <Button type="submit" disabled={deliver.isPending}>
                  {deliver.isPending ? "جارٍ التسجيل…" : due > 0n ? "تأكيد التسليم والتحصيل" : "تأكيد التسليم"}
                </Button>
              </form>
            )}

            {isOpen && open.kind !== "deliver" && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const kind = open.kind as Undelivered;
                  undelivered.mutate({ orderId: o.id, outcome: kind, reason: reasons[o.id] ?? "" });
                }}
              >
                <label className="text-sm grow">
                  {open.kind === "failed" ? "سبب عدم التسليم" : "سبب الإرجاع"}
                  <input
                    required
                    maxLength={500}
                    className="mt-1 block min-h-11 w-full rounded-[var(--control-radius)] border border-[var(--input-border)] bg-[var(--surface)] px-3 text-base"
                    value={reasons[o.id] ?? ""}
                    onChange={(e) => setReasons((r) => ({ ...r, [o.id]: e.target.value }))}
                  />
                </label>
                <Button type="submit" variant="outline" disabled={undelivered.isPending}>تسجيل</Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
