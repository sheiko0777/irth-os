'use client';

import { useRef, useState } from "react";
import { toast } from "sonner";
import { currency, fromMinor, toDecimalString } from "@irth/domain";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The office side of rep cash: per rep, what they hold; per handover, count
 * it (confirm) and, if short, write the shortage off. Each action keeps one
 * idempotency key per handover until it succeeds.
 */
export function RepCashManager() {
  const can = useCan();
  const utils = trpc.useUtils();
  const summary = trpc.repCash.summary.useQuery();
  const handovers = trpc.repCash.handovers.useQuery({});
  const keys = useRef(new Map<string, string>());
  const keyFor = (k: string) => {
    let v = keys.current.get(k);
    if (!v) { v = crypto.randomUUID(); keys.current.set(k, v); }
    return v;
  };
  const [received, setReceived] = useState<Record<string, string>>({});
  const refresh = () => { void utils.repCash.summary.invalidate(); void utils.repCash.handovers.invalidate(); };

  const confirm = trpc.repCash.confirm.useMutation({
    onSuccess: (_r, vars) => { keys.current.delete(`c:${vars.handoverId}`); toast.success("اتأكد استلام العهدة"); refresh(); },
    onError: (err) => toast.error(err.message || "تعذر التأكيد"),
  });
  const writeOff = trpc.repCash.writeOffShortage.useMutation({
    onSuccess: (_r, vars) => { keys.current.delete(`w:${vars.handoverId}`); toast.success("اتسوّى العجز"); refresh(); },
    onError: (err) => toast.error(err.message || "تعذر تسوية العجز"),
  });

  if (summary.isLoading || handovers.isLoading) return <Skeleton className="h-64 w-full" />;
  const reps = summary.data?.data.reps ?? [];
  const holding = summary.data?.data.holding ?? [];
  const nameOf = (memberId: string) => {
    const r = reps.find((x) => x.memberId === memberId);
    return r?.name ?? r?.username ?? "مندوب";
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="holding-title" className="space-y-2">
        <h2 id="holding-title" className="text-lg font-semibold">مع المناديب دلوقتي</h2>
        <div className="overflow-x-auto rounded-md border border-[var(--rim1)]">
          <table className="w-full text-sm">
            <thead className="bg-raised text-[var(--t2)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">المندوب</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">محصّل ولسه ماتسلّمش</th>
              </tr>
            </thead>
            <tbody>
              {reps.length === 0 && (
                <tr><td colSpan={2} className="px-3 py-4 text-[var(--t3)]">مفيش مناديب توصيل لسه. اعمل دور من نوع «مندوب توصيل» وحساب ليه.</td></tr>
              )}
              {reps.map((r) => {
                const rows = holding.filter((h) => h.memberId === r.memberId);
                return (
                  <tr key={r.memberId} className="border-t border-[var(--rim1)]">
                    <td className="px-3 py-2">{r.name ?? r.username}{r.status === "suspended" && " (موقوف)"}</td>
                    <td className="px-3 py-2">
                      {rows.length === 0 ? "—" : rows.map((h) => <Money key={h.currency} minor={h.openMinor} currency={h.currency} />)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="handovers-title" className="space-y-2">
        <h2 id="handovers-title" className="text-lg font-semibold">التسليمات</h2>
        <div className="overflow-x-auto rounded-md border border-[var(--rim1)]">
          <table className="w-full text-sm">
            <thead className="bg-raised text-[var(--t2)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">المندوب</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">المحصّل</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">قال إنه سلّم</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">اتستلم</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {(handovers.data?.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-[var(--t3)]">مفيش تسليمات.</td></tr>
              )}
              {(handovers.data?.data ?? []).map(({ handover: h, repName, repUsername }) => {
                const shortage = h.receivedMinor !== null ? h.expectedMinor - h.receivedMinor : 0n;
                const prefill = toDecimalString(fromMinor(h.declaredMinor, currency(h.currency)));
                return (
                  <tr key={h.id} className="border-t border-[var(--rim1)]" data-testid="handover-row">
                    <td className="px-3 py-2">{repName ?? repUsername ?? nameOf(h.memberId)}</td>
                    <td className="px-3 py-2"><Money minor={h.expectedMinor} currency={h.currency} /></td>
                    <td className="px-3 py-2"><Money minor={h.declaredMinor} currency={h.currency} /></td>
                    <td className="px-3 py-2">
                      {h.receivedMinor === null ? "—" : <Money minor={h.receivedMinor} currency={h.currency} />}
                      {shortage > 0n && (
                        <span className="ms-2 text-xs text-[var(--warning)]">
                          عجز <Money minor={shortage} currency={h.currency} />{h.writtenOffMinor !== null && " (اتسوّى)"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {h.status === "submitted" && can("repCash", "confirm") && (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            confirm.mutate({ handoverId: h.id, received: received[h.id] ?? prefill, idempotencyKey: keyFor(`c:${h.id}`) });
                          }}
                        >
                          <input
                            aria-label="المبلغ اللي اتستلم (ج.م)"
                            inputMode="decimal"
                            dir="ltr"
                            className="h-8 w-28 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2"
                            value={received[h.id] ?? prefill}
                            onChange={(e) => setReceived((r) => ({ ...r, [h.id]: e.target.value }))}
                          />
                          <Button type="submit" size="sm" disabled={confirm.isPending}>تأكيد الاستلام</Button>
                        </form>
                      )}
                      {h.status === "confirmed" && shortage > 0n && h.writtenOffMinor === null && can("repCash", "writeOff") && (
                        <Button
                          type="button" size="sm" variant="outline" disabled={writeOff.isPending}
                          onClick={() => writeOff.mutate({ handoverId: h.id, idempotencyKey: keyFor(`w:${h.id}`) })}
                        >
                          تسوية العجز
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
