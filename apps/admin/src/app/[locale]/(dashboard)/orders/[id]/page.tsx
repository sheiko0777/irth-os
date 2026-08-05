import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusUpdater } from "./StatusUpdater";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string, locale: string }> }) {
    const { id, locale } = await params;
    const t = await getTranslations("orders");
    const caller = await serverCaller();

    const response = await caller.orders.getById({ id });

    if (response.error || !response.data) {
        // Was a bare English <div>Order not found</div> with no way back — a
        // dead end on a URL an operator can easily reach from a stale link.
        return (
            <div className="rounded-xl border border-[var(--rim1)] bg-[var(--card-bg)]">
                <EmptyState
                    icon={PackageSearch}
                    title="الطلب غير موجود"
                    hint="يمكن يكون اتحذف، أو الرابط مش مظبوط."
                    action={{ label: "الرجوع للطلبات", href: `/${locale}/orders` }}
                />
            </div>
        );
    }

    const { order, items, history } = response.data;

    const itemsTotal = items.reduce(
        (sum: number, i: { quantity: number; price: string | number }) =>
            sum + Number(i.price) * i.quantity,
        0,
    );

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <Link
                    href={`/${locale}/orders`}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--t3)] transition-colors hover:text-[var(--gold)]"
                >
                    <ArrowRight size={13} />
                    الطلبات
                </Link>
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-bold tracking-tight text-[var(--t1)]">
                        {t("detail.title")}
                    </h1>
                    {/* The order number is data, not prose — forced LTR so the
                        hash and digits do not reorder inside the RTL heading. */}
                    <span className="font-mono text-xl text-[var(--gold)] tabular-nums" dir="ltr">
                        #{order.orderNumber}
                    </span>
                    {/* Current state belongs in the header. Previously the only
                        way to see it was to open the status dropdown. */}
                    <StatusBadge status={order.status} domain="order" />
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>{t("detail.updateStatus")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <StatusUpdater orderId={order.id} currentStatus={order.status} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("detail.items")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>الكمية</TableHead>
                                    <TableHead className="text-end">السعر</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item: { id: string, sku: string, quantity: number, price: string | number }) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-mono text-xs" dir="ltr">{item.sku}</TableCell>
                                        <TableCell className="tabular-nums" dir="ltr">
                                            {item.quantity.toLocaleString("ar-EG")}
                                        </TableCell>
                                        <TableCell className="text-end tabular-nums" dir="ltr">
                                            {Number(item.price).toLocaleString("ar-EG")} ج.م
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        {/* A line-item table with no sum makes the reader add it up
                            themselves, on a screen that is about money. */}
                        {items.length > 0 && (
                            <div className="mt-3 flex items-center justify-between border-t border-[var(--rim1)] pt-3">
                                <span className="text-xs text-[var(--t3)]">إجمالي الأصناف</span>
                                <span className="text-lg font-bold text-[var(--t1)] tabular-nums" dir="ltr">
                                    {itemsTotal.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("detail.history")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {history.length === 0 ? (
                            <EmptyState title="لا يوجد سجل تتبع" hint="التتبع بيبدأ لما الطلب يتسلّم لشركة الشحن." />
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>الشركة</TableHead>
                                        <TableHead>رقم التتبع</TableHead>
                                        <TableHead>الحالة</TableHead>
                                        <TableHead>التاريخ</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map((record: { id: string, provider: string, trackingNumber: string | null, status: string | null, createdAt: string | Date }) => (
                                        <TableRow key={record.id}>
                                            <TableCell>{record.provider}</TableCell>
                                            <TableCell className="font-mono text-xs" dir="ltr">
                                                {record.trackingNumber || "—"}
                                            </TableCell>
                                            <TableCell>{record.status || "—"}</TableCell>
                                            {/* toLocaleString() with no locale renders in the
                                                server's locale, not the user's. */}
                                            <TableCell className="tabular-nums" dir="ltr">
                                                {new Date(record.createdAt).toLocaleString("ar-EG")}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}