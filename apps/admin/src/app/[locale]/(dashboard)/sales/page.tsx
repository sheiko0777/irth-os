import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { NewSaleForm } from "./NewSaleForm";
import { SalesLists } from "./SalesLists";

/**
 * مبيعاتي (PR-2b): the sales rep's screen — a new order or quote for one of
 * their customers, and their orders and quotes. The procedures are the gate;
 * this page only refuses to render without sales.view.
 */
export default async function SalesPage() {
  const caller = await serverCaller();
  try {
    await caller.sales.customers({});
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">مبيعاتي</h1>
        <p className="mt-1 text-sm text-[var(--t3)]">طلب أو عرض سعر لعملائك، بأسعار القوائم المسموحة لك. الأسعار بيحسبها النظام.</p>
      </div>
      <NewSaleForm />
      <SalesLists />
    </div>
  );
}
