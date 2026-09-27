import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { RepDeliveries } from "./RepDeliveries";
import { RepCashPanel } from "./RepCashPanel";
import { Truck, Wallet } from "lucide-react";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";

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
    <div className="pb-tabbar mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">توصيلاتي</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">الطلبات المسندة ليك والفلوس اللي معاك.</p>
      </div>
      <RepCashPanel />
      <section id="rep-orders" aria-labelledby="rep-orders-title" className="scroll-mt-24 space-y-3">
        <h2 id="rep-orders-title" className="text-base font-semibold">طلبات النهارده</h2>
        <RepDeliveries />
      </section>
      <MobileTabBar
        label="أقسام توصيلاتي"
        items={[
          { href: "#rep-orders", label: "الطلبات", icon: <Truck /> },
          { href: "#rep-cash-title", label: "العهدة", icon: <Wallet /> },
        ]}
      />
    </div>
  );
}
