'use client';

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";

/**
 * A new order or quote for one of my customers (PR-2b). The prices shown come
 * from sales.catalog, computed on the server for the chosen price list; the
 * order and the quote are priced again on the server when submitted, so what
 * is shown here is a preview, never an input. One idempotency key per
 * submission, kept until it succeeds.
 */
export function NewSaleForm() {
  const can = useCan();
  const utils = trpc.useUtils();
  const [customerId, setCustomerId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "online">("cod");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "" });

  const customers = trpc.sales.customers.useQuery({});
  const lists = trpc.sales.priceLists.useQuery();
  const catalog = trpc.sales.catalog.useQuery({ priceListId: priceListId || null, search: search || undefined });

  const reset = () => { setQty({}); setKey(crypto.randomUUID()); void utils.sales.invalidate(); };
  const placeOrder = trpc.sales.placeOrder.useMutation({
    onSuccess: ({ data }) => { toast.success(`اتعمل الطلب ${data.orderNumber}`); reset(); },
    onError: (err) => toast.error(err.message || "تعذر إنشاء الطلب"),
  });
  const createQuote = trpc.sales.createQuote.useMutation({
    onSuccess: ({ data }) => { toast.success(`اتحفظ عرض السعر ${data.quoteNumber}`); reset(); },
    onError: (err) => toast.error(err.message || "تعذر حفظ عرض السعر"),
  });
  const addCustomer = trpc.sales.addCustomer.useMutation({
    onSuccess: ({ data }) => {
      toast.success("اتضاف العميل");
      setNewCustomer({ name: "", phone: "", address: "" });
      setCustomerId(data.id);
      void utils.sales.customers.invalidate();
    },
    onError: (err) => toast.error(err.message || "تعذر إضافة العميل"),
  });

  const items = catalog.data?.data ?? [];
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([variantId, quantity]) => ({ variantId, quantity }));
  const preview = lines.reduce((sum, l) => {
    const v = items.find((i) => i.id === l.variantId);
    return v ? sum + v.unitPriceMinor * BigInt(l.quantity) : sum;
  }, 0n);
  const ready = customerId !== "" && lines.length > 0;
  const pending = placeOrder.isPending || createQuote.isPending;
  const base = { customerId, priceListId: priceListId || null, lines, idempotencyKey: key };

  return (
    <section className="space-y-4 rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4" aria-labelledby="new-sale-title">
      <h2 id="new-sale-title" className="font-semibold">طلب جديد</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          العميل
          <select
            className="mt-1 block h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
            value={customerId} onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">اختار عميل…</option>
            {(customers.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          قائمة الأسعار
          <select
            className="mt-1 block h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
            value={priceListId} onChange={(e) => { setPriceListId(e.target.value); setKey(crypto.randomUUID()); }}
          >
            <option value="">السعر الأساسي</option>
            {(lists.data?.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>

      {can("sales", "customers") && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--t2)]">عميل جديد</summary>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addCustomer.mutate({ name: newCustomer.name, phone: newCustomer.phone || undefined, address: newCustomer.address || undefined });
            }}
          >
            <label>اسم العميل
              <input required maxLength={200} className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} />
            </label>
            <label>الموبايل
              <input maxLength={30} dir="ltr" className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
            </label>
            <label>العنوان
              <input maxLength={500} className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={newCustomer.address} onChange={(e) => setNewCustomer((c) => ({ ...c, address: e.target.value }))} />
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={addCustomer.isPending}>إضافة العميل</Button>
          </form>
        </details>
      )}

      <input
        aria-label="بحث في المنتجات" placeholder="ابحث باسم المنتج أو الكود…" maxLength={100}
        className="h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2 text-sm"
        value={search} onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-80 overflow-y-auto rounded-md border border-[var(--rim1)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--raised)] text-[var(--t2)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">المنتج</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">المتاح</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">السعر</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">الكمية</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <tr key={v.id} className="border-t border-[var(--rim1)]">
                <td className="px-3 py-1.5">{v.productName} — {v.name} <span className="text-xs text-[var(--t3)]" dir="ltr">{v.sku}</span></td>
                <td className="px-3 py-1.5 tabular-nums">{v.available}</td>
                <td className="px-3 py-1.5">
                  <Money minor={v.unitPriceMinor} />
                  {v.unitPriceMinor < v.listPriceMinor && (
                    <span className="ms-1 text-xs text-[var(--t3)] line-through"><Money minor={v.listPriceMinor} /></span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number" min={0} max={10000} inputMode="numeric" aria-label={`كمية ${v.sku}`}
                    className="h-8 w-20 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                    value={qty[v.id] ?? ""}
                    onChange={(e) => { setQty((q) => ({ ...q, [v.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })); setKey(crypto.randomUUID()); }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">الإجمالي: <Money minor={preview} className="font-semibold" data-testid="sale-preview-total" /></p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="طريقة الدفع" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cod" | "online")}
            className="h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2 text-sm"
          >
            <option value="cod">دفع عند الاستلام</option>
            <option value="online">مدفوع</option>
          </select>
          {can("sales", "quote") && (
            <Button type="button" variant="outline" disabled={!ready || pending} onClick={() => createQuote.mutate(base)}>حفظ كعرض سعر</Button>
          )}
          {can("sales", "order") && (
            <Button type="button" disabled={!ready || pending} onClick={() => placeOrder.mutate({ ...base, paymentMethod })}>
              {placeOrder.isPending ? "جارٍ الإنشاء…" : "إنشاء الطلب"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
