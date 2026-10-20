import { getTranslations } from "next-intl/server";
import { formatDate, fromMinor, isZero } from "@irth/domain";
import { Money } from "@/components/ui/Money";
import { EmptyState } from '@/components/ui/EmptyState';
import { serverCaller } from "@/server/caller";
import { AiQueryForm } from "./AiQueryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Boxes, Landmark, PiggyBank, Receipt, ShoppingCart, TrendingUp, Undo2, Wallet, XCircle } from "lucide-react";

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
    // Presentation only: the ledger total is kept as-is, the screen just
    // stops presenting an unknown cost as a real zero.
    const cogsUnknown = isZero(pnl.cogs);
    const ESTIMATED = t("estimated");

    return (
        <div className="space-y-8">
            <PageHeader
                eyebrow="المالية والتقارير"
                title={t("title")}
                description={`الفترة: ${formatDate(firstDayOfMonth)} - ${formatDate(today)}`}
                icon={<Landmark />}
            />

            {/* P&L Summary */}
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("pnl")}</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {/* Revenue is the hero here too — one navy hero per screen. */}
                    <KpiCard
                        id="fin-revenue"
                        icon={<Wallet />}
                        variant="hero"
                        title="إجمالي الإيرادات"
                        value={<Money value={pnl.totalRevenue} emphasis />}
                    />
                    <KpiCard
                        id="fin-orders"
                        icon={<ShoppingCart />}
                        title="إجمالي الطلبات"
                        value={pnl.totalOrders}
                    />
                    <KpiCard
                        id="fin-aov"
                        icon={<Receipt />}
                        title="متوسط قيمة الطلب"
                        value={<Money value={pnl.avgOrderValue} emphasis />}
                    />
                    <KpiCard
                        id="fin-cancelled"
                        icon={<XCircle />}
                        title="طلبات ملغاة"
                        value={pnl.cancelledOrders}
                    />
                </div>

                {/* The breakdown that makes this an actual P&L rather than a sales
                    total: everything below comes from the double-entry ledger
                    (packages/db/src/ledger.ts), not from summing order rows. */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {/* No cost posted means "unknown", not "free": 0.00 here made
                        gross profit equal revenue and read as a 100% margin. */}
                    <KpiCard
                        id="fin-cogs"
                        icon={<Boxes />}
                        title="تكلفة البضاعة المباعة"
                        value={
                            cogsUnknown ? (
                                <span
                                    className="inline-flex rounded-full bg-[var(--raised)] px-2.5 py-1 text-xs font-medium tracking-normal text-[var(--text-secondary)]"
                                    data-testid="cogs-not-calculated"
                                >
                                    {t("cogsNotCalculated")}
                                </span>
                            ) : (
                                <Money value={pnl.cogs} emphasis />
                            )
                        }
                        sub={cogsUnknown ? t("cogsNotCalculatedHint") : undefined}
                    />
                    <KpiCard
                        id="fin-gross-profit"
                        icon={<TrendingUp />}
                        title="مجمل الربح"
                        value={<Money value={pnl.grossProfit} emphasis />}
                        sub={cogsUnknown ? ESTIMATED : undefined}
                    />
                    <KpiCard
                        id="fin-returns"
                        icon={<Undo2 />}
                        title="مرتجعات ومسموحات"
                        value={<Money value={pnl.returns} emphasis />}
                    />
                    <KpiCard
                        id="fin-net-income"
                        icon={<PiggyBank />}
                        title="صافي الدخل"
                        value={<Money value={pnl.netIncome} emphasis />}
                        sub={cogsUnknown ? ESTIMATED : undefined}
                    />
                </div>
            </section>

            {/* VAT Report */}
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("vat")}</h2>
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-[var(--t2)]">الإيراد الإجمالي</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-[var(--t1)]"><Money value={vat.grossRevenue} /></div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-[var(--t2)]">قيمة ضريبة القيمة المضافة (14%)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {/* Neutral: a VAT amount or a net figure is not good or bad news —
                                red/green is kept for deltas. */}
                            <div className="text-2xl font-bold text-[var(--t1)]"><Money value={vat.vatAmount} /></div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-[var(--t2)]">الإيراد الصافي</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-[var(--t1)]"><Money value={vat.netRevenue} /></div>
                        </CardContent>
                    </Card>
                </div>
            </section>

            {/* COD Reconciliation */}
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("cod")}</h2>
                <Card className="overflow-hidden">
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
                                    <TableRow key={row.orderId}>
                                        <TableCell className="font-mono">{row.orderNumber}</TableCell>
                                        <TableCell><Money value={fromMinor(row.amount)} /></TableCell>
                                        <TableCell>{formatDate(row.createdAt)}</TableCell>
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
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("ai")}</h2>
                <Card>
                    <CardContent className="pt-6">
                        <AiQueryForm />
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}
