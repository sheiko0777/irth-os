'use client';

import { useState } from "react";
import { toast } from "sonner";
import { currency, fromMinor, toDecimalString } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { BalanceCard } from "@/components/mobile/BalanceCard";
import { Wallet } from "lucide-react";

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
    <div className="space-y-3">
      <BalanceCard
        id="rep-cash-title"
        label="العهدة اللي معايا"
        minor={totalMinor}
        icon={<Wallet />}
        data-testid="rep-cash-total"
        sub={`${open.length} طلب اتحصّل ولسه ماتسلّمش.`}
      >
        {totalMinor > 0n && can("repCash", "handover") && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate({ declared: declared ?? prefill, idempotencyKey: key });
            }}
          >
            <label className="grow text-sm text-[var(--hero-muted)]">
              المبلغ اللي هتسلّمه (ج.م)
              <input
                inputMode="decimal"
                dir="ltr"
                className="mt-1 block min-h-11 w-full rounded-[var(--control-radius)] border border-white/25 bg-white/10 px-3 text-base text-[var(--hero-fg)] placeholder:text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                value={declared ?? prefill}
                onChange={(e) => setDeclared(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={submit.isPending}
              className="bg-white text-[var(--hero-to)] shadow-none hover:bg-white/90"
            >
              {submit.isPending ? "جارٍ التسليم…" : "تسليم العهدة"}
            </Button>
          </form>
        )}
      </BalanceCard>

      {handovers.length > 0 && (
        <section aria-labelledby="rep-handovers" className="glass rounded-[var(--card-radius)] p-4">
          <h3 id="rep-handovers" className="mb-2 text-sm font-semibold">التسليمات</h3>
          <ul className="divide-y divide-[var(--separator)] text-sm">
            {handovers.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={
                      "size-2 rounded-full " + (h.status === "confirmed" ? "bg-[var(--success)]" : "bg-[var(--warning)]")
                    }
                    aria-hidden="true"
                  />
                  {STATUS_LABELS[h.status]}
                </span>
                <Money minor={h.receivedMinor ?? h.expectedMinor} currency={h.currency} className="font-semibold" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
