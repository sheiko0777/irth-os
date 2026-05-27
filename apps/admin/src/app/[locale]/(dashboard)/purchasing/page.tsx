import { serverCaller } from "@/server/caller";
import { PurchasingClient } from "./PurchasingClient";

export default async function PurchasingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const caller = await serverCaller();

  // Fetch data in parallel
  const [suppliersResponse, poResponse] = await Promise.all([
    caller.purchasing.suppliers.list(),
    caller.purchasing.po.list({ page: 1, pageSize: 50 }),
  ]);

  if (suppliersResponse.error || poResponse.error) {
    return <div>حدث خطأ أثناء تحميل البيانات</div>;
  }

  return (
    <PurchasingClient
      suppliers={suppliersResponse.data}
      purchaseOrders={poResponse.data}
      locale={locale}
    />
  );
}
