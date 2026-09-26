import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { RepDeliveries } from "./RepDeliveries";
import { RepCashPanel } from "./RepCashPanel";

/**
 * توصيلاتي (PR-2a): the delivery rep's screen, built for a phone. The
 * procedures are the gate; this page only refuses to render for someone
 * without deliveries.view, so a direct link shows "not found".
 */
export default async function RepPage() {
  const caller = await serverCaller();
  try {
    await caller.deliveries.today();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">توصيلاتي</h1>
        <p className="mt-1 text-sm text-[var(--t3)]">الطلبات المسندة ليك والفلوس اللي معاك.</p>
      </div>
      <RepDeliveries />
      <RepCashPanel />
    </div>
  );
}
