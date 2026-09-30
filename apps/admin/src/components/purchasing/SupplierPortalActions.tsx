'use client';

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Money } from "@/components/ui/Money";

/**
 * Per supplier (PR-3): open their portal account, and see their statement
 * and pay them. UX only — purchasing.portalAccounts and purchasing.pay are
 * enforced on the server, and a payment is refused above what is owed.
 */
export function SupplierPortalActions({ supplier }: { supplier: { id: string; name: string } }) {
  const can = useCan();
  const [dialog, setDialog] = useState<"account" | "pay" | null>(null);
  return (
    <>
      {can("purchasing", "portalAccounts") && (
        <Button variant="outline" size="sm" onClick={() => setDialog("account")}>حساب بوابة</Button>
      )}
      {can("purchasing", "view") && (
        <Button variant="outline" size="sm" onClick={() => setDialog("pay")}>كشف حساب</Button>
      )}
      {dialog === "account" && <PortalAccountDialog supplier={supplier} onClose={() => setDialog(null)} />}
      {dialog === "pay" && <StatementDialog supplier={supplier} canPay={can("purchasing", "pay")} onClose={() => setDialog(null)} />}
    </>
  );
}

function PortalAccountDialog({ supplier, onClose }: { supplier: { id: string; name: string }; onClose: () => void }) {
  const [name, setName] = useState(supplier.name);
  const [username, setUsername] = useState("");
  const create = trpc.purchasing.suppliers.createPortalAccount.useMutation({
    onError: (err) => toast.error(err.message || "تعذر إنشاء الحساب"),
  });
  const created = create.data?.data;
  return (
    <FormDialog open title={`حساب بوابة — ${supplier.name}`} onClose={onClose}>
      {created ? (
        <div className="space-y-2 text-sm">
          <p>اتعمل الحساب. ابعت للمورد اسم المستخدم وكلمة السر المؤقتة دي — مش هتظهر تاني، وهيغيّرها أول ما يدخل.</p>
          <p>اسم المستخدم: <span dir="ltr" className="font-mono">{created.username}</span></p>
          <p>كلمة السر المؤقتة: <span dir="ltr" className="font-mono" data-testid="supplier-temp-password">{created.temporaryPassword}</span></p>
          <Button type="button" onClick={onClose}>تم</Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({ supplierId: supplier.id, name, username }); }}>
          <label className="block text-sm">اسم الشخص
            <input required maxLength={80} className="mt-1 block h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
              value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">اسم المستخدم أو رقم الموبايل
            <input required minLength={3} maxLength={30} dir="ltr" className="mt-1 block h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
              value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <Button type="submit" disabled={create.isPending}>إنشاء حساب البوابة</Button>
        </form>
      )}
    </FormDialog>
  );
}

function StatementDialog({ supplier, canPay, onClose }: { supplier: { id: string; name: string }; canPay: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const st = trpc.purchasing.suppliers.statement.useQuery({ supplierId: supplier.id });
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"bank" | "cash">("bank");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const pay = trpc.purchasing.suppliers.recordPayment.useMutation({
    onSuccess: () => {
      toast.success("اتسجّلت الدفعة");
      setAmount(""); setReference(""); setKey(crypto.randomUUID());
      void utils.purchasing.suppliers.statement.invalidate({ supplierId: supplier.id });
    },
    onError: (err) => toast.error(err.message || "تعذر تسجيل الدفعة"),
  });
  const data = st.data?.data;
  return (
    <FormDialog open title={`كشف حساب — ${supplier.name}`} onClose={onClose} width="640px">
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <div><dt className="text-[var(--t3)]">المستلم</dt><dd><Money minor={data?.receivedMinor ?? 0n} /></dd></div>
          <div><dt className="text-[var(--t3)]">المدفوع</dt><dd><Money minor={data?.paidMinor ?? 0n} /></dd></div>
          <div><dt className="text-[var(--t3)]">المستحق</dt><dd className="font-bold"><Money minor={data?.outstandingMinor ?? 0n} /></dd></div>
        </dl>
        <ul className="divide-y divide-[var(--rim1)] rounded-md border border-[var(--rim1)]">
          {(data?.rows ?? []).map((r) => (
            <li key={r.poId ?? "unallocated"} className="flex justify-between p-2">
              <span dir="ltr">{r.poNumber ?? "دفعات غير مخصصة"}</span>
              <span><Money minor={r.receivedMinor} /> / <Money minor={r.paidMinor} /></span>
            </li>
          ))}
        </ul>
        {canPay && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            pay.mutate({ supplierId: supplier.id, amount, method, reference: reference || undefined, idempotencyKey: key });
          }}>
            <label>المبلغ (ج.م)
              <input required inputMode="decimal" dir="ltr" className="mt-1 block h-9 w-28 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={amount} onChange={(e) => { setAmount(e.target.value); setKey(crypto.randomUUID()); }} />
            </label>
            <label>الطريقة
              <select className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={method} onChange={(e) => setMethod(e.target.value as "bank" | "cash")}>
                <option value="bank">تحويل بنكي</option>
                <option value="cash">نقدي</option>
              </select>
            </label>
            <label>المرجع
              <input maxLength={200} className="mt-1 block h-9 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <Button type="submit" disabled={pay.isPending}>تسجيل دفعة</Button>
          </form>
        )}
      </div>
    </FormDialog>
  );
}
