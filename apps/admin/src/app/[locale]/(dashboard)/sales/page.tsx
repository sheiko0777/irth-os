import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";
import { NewSaleForm } from "./NewSaleForm";
import { SalesLists } from "./SalesLists";
import { PageHeader } from "@/components/ui/PageHeader";
import { Briefcase, FilePlus2, Receipt, ScrollText } from "lucide-react";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";

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
    <div className="pb-tabbar mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="عام"
        title={"مبيعاتي"}
        description={"طلب أو عرض سعر لعملائك، بأسعار القوائم المسموحة لك. الأسعار بيحسبها النظام."}
        icon={<Briefcase />}
      />
      <div id="new-sale" className="scroll-mt-24">
        <NewSaleForm />
      </div>
      <SalesLists />
      <MobileTabBar
        label="أقسام مبيعاتي"
        items={[
          { href: "#new-sale", label: "جديد", icon: <FilePlus2 /> },
          { href: "#my-orders", label: "طلباتي", icon: <Receipt /> },
          { href: "#my-quotes", label: "العروض", icon: <ScrollText /> },
        ]}
      />
    </div>
  );
}
