import { serverCaller } from "@/server/caller";
import CourierClient, { type CourierShipment, type CourierRemittance } from "./CourierClient";

export const metadata = { title: 'تسوية COD | IRTH' };

export default async function CourierPage() {
    const caller = await serverCaller();

    const [summaryRes, shipmentsRes, remittancesRes] = await Promise.all([
        caller.courier.summary(),
        caller.courier.shipments.list({}),
        caller.courier.remittances.list({}),
    ]);

    if (summaryRes.error || shipmentsRes.error || remittancesRes.error) {
        return <div className="text-[var(--crimson)] p-4 font-cairo">حدث خطأ أثناء تحميل بيانات الشحن والتسوية</div>;
    }

    const summary = summaryRes.data as unknown as {
        totalShipments: number;
        pendingCod: number;
        remittedCod: number;
        activeRemittances: number;
    };

    const shipments = shipmentsRes.data as unknown as CourierShipment[];
    const remittances = remittancesRes.data as unknown as CourierRemittance[];

    return (
        <div className="space-y-6" dir="rtl">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold font-cairo text-[var(--t1)]">التسوية والشحن (COD)</h1>
            </div>

            <CourierClient
                summary={summary}
                initialShipments={shipments}
                initialRemittances={remittances}
            />
        </div>
    );
}
