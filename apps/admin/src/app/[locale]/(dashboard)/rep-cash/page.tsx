import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { RepCashManager } from "./RepCashManager";

/**
 * عهدة المناديب (PR-2a): what each delivery rep holds, and the handovers
 * waiting to be counted. The procedures are the gate.
 */
export default async function RepCashPage() {
  const caller = await serverCaller();
  try {
    await caller.repCash.summary();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">عهدة المناديب</h1>
        <p className="mt-1 text-sm text-[var(--t3)]">
          الفلوس اللي المناديب حصّلوها، والتسليمات اللي مستنية تتعدّ. التأكيد بيسجّل المبلغ اللي اتستلم فعلًا، والعجز بيتسوّى بقيد لوحده.
        </p>
      </div>
      <RepCashManager />
    </div>
  );
}
