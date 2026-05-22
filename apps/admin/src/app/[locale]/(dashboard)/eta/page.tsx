import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EtaActions from "./EtaActions";

const STATUS_COLORS: Record<string, string> = {
    pending: "bg-[var(--gold)] text-black",
    submitted: "bg-[var(--emerald)] text-white",
    valid: "bg-[var(--emerald)] text-white",
    rejected: "bg-[var(--crimson)] text-white",
    cancelled: "bg-[var(--rim1)] text-[var(--t2)]",
    error: "bg-[var(--crimson)] text-white",
};

export default async function EtaPage() {
    const t = await getTranslations();
    const caller = await serverCaller();
    const response = await caller.eta.list({});

    if (response.error) {
        return <div className="text-[var(--crimson)] p-4">خطأ في تحميل الفواتير الإلكترونية</div>;
    }

    const invoices = response.data;

    return (
        <div className="space-y-6" dir="rtl">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold font-cairo text-[var(--t1)]">الفواتير الإلكترونية (هيئة الزكاة)</h1>
                <EtaActions />
            </div>

            <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-4 text-sm font-cairo text-[var(--t2)]">
                <p>يتم تقديم الفواتير الإلكترونية تلقائياً لهيئة الزكاة والضريبة والجمارك (ETA) وفقاً للمتطلبات القانونية المصرية.</p>
            </div>

            <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                <Table>
                    <TableHeader className="bg-[var(--rim1)]">
                        <TableRow>
                            <TableHead className="text-right">رقم الطلب</TableHead>
                            <TableHead className="text-right">رقم UUID (هيئة الزكاة)</TableHead>
                            <TableHead className="text-right">الحالة</TableHead>
                            <TableHead className="text-right">تاريخ الإرسال</TableHead>
                            <TableHead className="text-right">إجراءات</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoices.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-[var(--t2)] py-8 font-cairo">
                                    لا توجد فواتير إلكترونية بعد
                                </TableCell>
                            </TableRow>
                        ) : (
                            invoices.map((inv) => (
                                <TableRow key={inv.id} className="border-b border-[var(--rim1)]">
                                    <TableCell className="font-mono text-xs text-[var(--t2)]">{inv.orderId.slice(0, 8)}…</TableCell>
                                    <TableCell className="font-mono text-xs text-[var(--t2)]">
                                        {inv.etaUuid ? inv.etaUuid.slice(0, 12) + '…' : '—'}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={STATUS_COLORS[inv.status] ?? "bg-[var(--rim1)]"}>
                                            {inv.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-[var(--t2)] text-sm">
                                        {inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString('ar-EG') : '—'}
                                    </TableCell>
                                    <TableCell>
                                        <EtaActions orderId={inv.orderId} invoiceStatus={inv.status} />
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
