import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import CourierActions from "./CourierActions";

const STATUS_COLORS: Record<string, string> = {
    delivered: "bg-[var(--emerald)] text-white",
    returned: "bg-[var(--crimson)] text-white",
    in_transit: "bg-[var(--gold)] text-black",
    picked_up: "bg-[var(--gold)] text-black",
    created: "bg-[var(--rim1)] text-[var(--t2)]",
    failed: "bg-[var(--crimson)] text-white",
};

const REMITTANCE_STATUS_COLORS: Record<string, string> = {
    pending: "bg-[var(--gold)] text-black",
    received: "bg-[var(--emerald)] text-white",
    reconciled: "bg-[var(--emerald)] text-white",
};

export default async function CourierPage() {
    const t = await getTranslations();
    const caller = await serverCaller();

    // Batch requests explicitly to improve latency
    const [summaryRes, shipmentsRes, remittancesRes] = await Promise.all([
        caller.courier.summary(),
        caller.courier.shipments.list({}),
        caller.courier.remittances.list({})
    ]);

    if (summaryRes.error || shipmentsRes.error || remittancesRes.error) {
        return <div className="text-[var(--crimson)] p-4 font-cairo">حدث خطأ أثناء تحميل بيانات الشحن والتسوية</div>;
    }

    const { totalCodCollected, totalCodRemitted, pendingRemittance } = summaryRes.data;
    const shipments = shipmentsRes.data;
    const remittances = remittancesRes.data;

    return (
        <div className="space-y-6" dir="rtl">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold font-cairo text-[var(--t1)]">التسوية والشحن (COD)</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-cairo">
                <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-6 flex flex-col justify-center items-center">
                    <p className="text-sm text-[var(--t2)] mb-2">إجمالي التحصيل (COD)</p>
                    <p className="text-3xl font-bold text-[var(--t1)]">{totalCodCollected.toFixed(2)} ج.م</p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-6 flex flex-col justify-center items-center">
                    <p className="text-sm text-[var(--t2)] mb-2">تسويات معلقة (Pending)</p>
                    <p className="text-3xl font-bold text-[var(--gold)]">{pendingRemittance.toFixed(2)} ج.م</p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-6 flex flex-col justify-center items-center">
                    <p className="text-sm text-[var(--t2)] mb-2">إجمالي المسدد (Remitted)</p>
                    <p className="text-3xl font-bold text-[var(--emerald)]">{totalCodRemitted.toFixed(2)} ج.م</p>
                </div>
            </div>

            <div className="space-y-4">
                <h2 className="text-xl font-bold font-cairo text-[var(--t1)]">التسويات</h2>
                <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                    <Table>
                        <TableHeader className="bg-[var(--rim1)]">
                            <TableRow>
                                <TableHead className="text-right">المرجع</TableHead>
                                <TableHead className="text-right">شركة الشحن</TableHead>
                                <TableHead className="text-right">القيمة</TableHead>
                                <TableHead className="text-right">عدد الشحنات</TableHead>
                                <TableHead className="text-right">الحالة</TableHead>
                                <TableHead className="text-right">إجراءات</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {remittances.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-[var(--t2)] py-8 font-cairo">
                                        لا توجد تسويات
                                    </TableCell>
                                </TableRow>
                            ) : (
                                remittances.map((rem) => (
                                    <TableRow key={rem.id} className="border-b border-[var(--rim1)]">
                                        <TableCell className="font-mono text-sm text-[var(--t2)]">{rem.remittanceReference}</TableCell>
                                        <TableCell className="text-sm text-[var(--t1)] capitalize">{rem.courier}</TableCell>
                                        <TableCell className="font-bold text-sm text-[var(--t1)]">{rem.amount}</TableCell>
                                        <TableCell className="text-sm text-[var(--t2)]">{rem.shipmentCount}</TableCell>
                                        <TableCell>
                                            <Badge className={REMITTANCE_STATUS_COLORS[rem.status] ?? "bg-[var(--rim1)]"}>
                                                {rem.status === 'reconciled' ? 'تمت التسوية' : rem.status === 'pending' ? 'معلق' : rem.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <CourierActions type="reconcile" remittanceId={rem.id} status={rem.status} />
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <div className="space-y-4">
                <h2 className="text-xl font-bold font-cairo text-[var(--t1)]">الشحنات</h2>
                <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                    <Table>
                        <TableHeader className="bg-[var(--rim1)]">
                            <TableRow>
                                <TableHead className="text-right">رقم التتبع</TableHead>
                                <TableHead className="text-right">شركة الشحن</TableHead>
                                <TableHead className="text-right">حالة الشحنة</TableHead>
                                <TableHead className="text-right">قيمة COD</TableHead>
                                <TableHead className="text-right">التحصيل والتسديد</TableHead>
                                <TableHead className="text-right">إجراءات</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {shipments.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-[var(--t2)] py-8 font-cairo">
                                        لا توجد شحنات
                                    </TableCell>
                                </TableRow>
                            ) : (
                                shipments.map((ship) => (
                                    <TableRow key={ship.id} className="border-b border-[var(--rim1)]">
                                        <TableCell className="font-mono text-xs text-[var(--t2)]">{ship.trackingNumber || '—'}</TableCell>
                                        <TableCell className="text-sm text-[var(--t1)] capitalize">{ship.courier}</TableCell>
                                        <TableCell>
                                            <Badge className={STATUS_COLORS[ship.courierStatus] ?? "bg-[var(--rim1)]"}>
                                                {ship.courierStatus}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-[var(--t1)]">
                                            {ship.codAmount ? `${ship.codAmount}` : '—'}
                                        </TableCell>
                                        <TableCell className="flex gap-2">
                                            {ship.codCollected && (
                                                <Badge className="bg-[var(--emerald)] text-white text-xs">تم التحصيل</Badge>
                                            )}
                                            {ship.codRemitted && (
                                                <Badge className="bg-[var(--emerald)] text-white text-xs">مسدد</Badge>
                                            )}
                                            {!ship.codRemitted && ship.codCollected && (
                                                <Badge className="bg-[var(--gold)] text-black text-xs">غير مسدد</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <CourierActions
                                                type="markRemitted"
                                                shipmentId={ship.id}
                                                codCollected={ship.codCollected}
                                                codRemitted={ship.codRemitted}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
