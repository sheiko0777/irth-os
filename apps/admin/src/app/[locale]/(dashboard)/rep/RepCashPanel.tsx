'use client';

import { useState } from "react";
import { toast } from "sonner";
import { currency, fromMinor, toDecimalString } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";

const STATUS_LABELS = { submitted: "مستني المكتب يعدّ", confirmed: "اتستلمت" } as const;

/**
 * The cash I hold (collected, not yet handed over) and the end-of-day
 * handover. The handover keeps one idempotency key until it succeeds.
 */
export function RepCashPanel() {
  const can = useCan();
  const utils = trpc.useUtils();
  const cash = trpc.deliveries.myCash.useQuery();
  const [declared, setDeclared] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const submit = trpc.deliveries.submitHandover.useMutation({
    onSuccess: () => {
      toast.success("اتسلّمت العهدة، مستنية تأكيد المكتب");
      setKey(crypto.randomUUID());
      setDeclared(null);
      void utils.deliveries.myCash.invalidate();
    },
    onError: (err) => toast.error(err.message || "تعذر تسليم العهدة"),
  });

  const open = cash.data?.data.open ?? [];
  const handovers = cash.data?.data.handovers ?? [];
  const totalMinor = open.reduce((sum, c) => sum + c.amountMinor, 0n);
  const prefill = totalMinor > 0n ? toDecimalString(fromMinor(totalMinor, currency("EGP"))) : "";

  return (
    <section className="space-y-3 rounded-lg border border-[var(--rim1)] bg-[var(--surface)] p-4" aria-labelledby="rep-cash-title">
      <div className="flex items-center justify-between">
        <h2 id="rep-cash-title" className="font-semibold">العهدة اللي معايا</h2>
        <Money minor={totalMinor} className="text-lg font-bold" data-testid="rep-cash-total" />
      </div>
      <p className="text-xs text-[var(--t3)]">{open.length} طلب اتحصّل ولسه ماتسلّمش.</p>

      {totalMinor > 0n && can("repCash", "handover") && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate({ declared: declared ?? prefill, idempotencyKey: key });
          }}
        >
          <label className="text-sm">
            المبلغ اللي هتسلّمه (ج.م)
            <input
              inputMode="decimal"
              dir="ltr"
              className="mt-1 block h-9 w-32 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
              value={declared ?? prefill}
              onChange={(e) => setDeclared(e.target.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={submit.isPending}>
            {submit.isPending ? "جارٍ التسليم…" : "تسليم العهدة"}
          </Button>
        </form>
      )}

      {handovers.length > 0 && (
        <ul className="divide-y divide-[var(--rim1)] text-sm">
          {handovers.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2">
              <span>{STATUS_LABELS[h.status]}</span>
              <Money minor={h.receivedMinor ?? h.expectedMinor} currency={h.currency} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
