import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { NewSaleForm } from "./NewSaleForm";
import { SalesLists } from "./SalesLists";
import { PageHeader } from "@/components/ui/PageHeader";
import { Briefcase } from "lucide-react";

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
      <PageHeader
        eyebrow="عام"
        title={"مبيعاتي"}
        description={"طلب أو عرض سعر لعملائك، بأسعار القوائم المسموحة لك. الأسعار بيحسبها النظام."}
        icon={<Briefcase />}
      />
      <NewSaleForm />
      <SalesLists />
    </div>
  );
}
