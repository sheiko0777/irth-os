import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { RepCashManager } from "./RepCashManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { Wallet } from "lucide-react";

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
      <PageHeader
        eyebrow="العمليات"
        title={"عهدة المناديب"}
        description={"الفلوس اللي المناديب حصّلوها، والتسليمات اللي مستنية تتعدّ. التأكيد بيسجّل المبلغ اللي اتستلم فعلًا، والعجز بيتسوّى بقيد لوحده."}
        icon={<Wallet />}
      />
      <RepCashManager />
    </div>
  );
}
