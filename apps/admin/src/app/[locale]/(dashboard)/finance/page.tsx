import { getTranslations } from "next-intl/server";
import { formatMoney, fromMinor } from "@irth/domain";
import { EmptyState } from '@/components/ui/EmptyState';
import { serverCaller } from "@/server/caller";
import { AiQueryForm } from "./AiQueryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/ui/KpiCard";

export const revalidate = 0; // Don't cache finance reports

export default async function FinancePage() {
    const t = await getTranslations("finance");
    const caller = await serverCaller();

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const startDateStr = firstDayOfMonth.toISOString();
    const endDateStr = today.toISOString();

    const [pnlRes, codRes, vatRes] = await Promise.all([
        caller.finance.pnl({ startDate: startDateStr, endDate: endDateStr }),
        caller.finance.codReconciliation({ startDate: startDateStr, endDate: endDateStr }),
        caller.finance.vatReport({ startDate: startDateStr, endDate: endDateStr })
    ]);

    if (pnlRes.error || codRes.error || vatRes.error) {
        return <div className="text-[var(--crimson)]">حدث خطأ أثناء تحميل بيانات المالية.</div>;
    }

    const pnl = pnlRes.data;
    const codRows = codRes.data;
    const vat = vatRes.data;

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-[var(--t1)]">{t("title")}</h1>
            <p className="text-[var(--t2)]">الفترة: {firstDayOfMonth.toLocaleDateString('ar-EG')} - {today.toLocaleDateString('ar-EG')}</p>

            {/* P&L Summary */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-[var(--t1)]">{t("pnl")}</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {/* Revenue is the hero here too — one gold fill per screen. */}
                    <KpiCard
                        id="fin-revenue"
                        variant="hero"
                        title="إجمالي الإيرادات"
                        value={formatMoney(pnl.totalRevenue)}
                    />
                    <KpiCard
                        id="fin-orders"
                        title="إجمالي الطلبات"
                        value={pnl.totalOrders.toLocaleString('ar-EG')}
                    />
                    <KpiCard
                        id="fin-aov"
                        title="متوسط قيمة الطلب"
                        value={formatMoney(pnl.avgOrderValue)}
                    />
                    <KpiCard
                        id="fin-cancelled"
                        title="طلبات ملغاة"
                        value={pnl.cancelledOrders.toLocaleString('ar-EG')}
                    />
                </div>
            </section>

            {/* VAT Report */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-[var(--t1)]">{t("vat")}</h2>
                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-[var(--t2)]">الإيراد الإجمالي</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-[var(--t1)]">{formatMoney(vat.grossRevenue)}</div>
                        </CardContent>
                    </Card>
                    <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-[var(--t2)]">قيمة ضريبة القيمة المضافة (14%)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-[var(--crimson)]">{formatMoney(vat.vatAmount)}</div>
                        </CardContent>
                    </Card>
                    <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-[var(--t2)]">الإيراد الصافي</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-[var(--emerald)]">{formatMoney(vat.netRevenue)}</div>
                        </CardContent>
                    </Card>
                </div>
            </section>

            {/* COD Reconciliation */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-[var(--t1)]">{t("cod")}</h2>
                <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-[var(--rim1)] hover:bg-transparent">
                                <TableHead className="text-start">رقم الطلب</TableHead>
                                <TableHead className="text-start">المبلغ</TableHead>
                                <TableHead className="text-start">التاريخ</TableHead>
                                <TableHead className="text-start">الحالة</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {codRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="p-0"><EmptyState title="لا توجد بيانات في هذه الفترة" hint="الأرقام بتتحسب من الطلبات المسلَّمة خلال الشهر الحالي." /></TableCell>
                                </TableRow>
                            ) : (
                                codRows.map((row) => (
                                    <TableRow key={row.orderId} className="border-[var(--rim1)] hover:bg-[var(--rim1)]/50">
                                        <TableCell className="font-mono">{row.orderNumber}</TableCell>
                                        <TableCell>{formatMoney(fromMinor(row.amount))}</TableCell>
                                        <TableCell>{new Date(row.createdAt).toLocaleDateString('ar-EG')}</TableCell>
                                        <TableCell>
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[var(--emerald)]/10 text-[var(--emerald)]">
                                                {row.status === 'delivered' ? 'تم التوصيل' : row.status}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </Card>
            </section>

            {/* AI Query Form */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-[var(--t1)]">{t("ai")}</h2>
                <Card className="bg-[var(--surface)] border-[var(--rim1)]">
                    <CardContent className="pt-6">
                        <AiQueryForm />
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}
