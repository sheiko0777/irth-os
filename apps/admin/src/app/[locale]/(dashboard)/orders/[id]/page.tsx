import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusUpdater } from "./StatusUpdater";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string, locale: string }> }) {
    const { id, locale } = await params;
    const t = await getTranslations("orders");
    const caller = await serverCaller();

    const response = await caller.orders.getById({ id });

    if (response.error || !response.data) {
        return <div>Order not found</div>;
    }

    const { order, items, history } = response.data;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">
                    {t("detail.title")} #{order.orderNumber}
                </h1>
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
                                        <TableCell>{item.sku}</TableCell>
                                        <TableCell>{item.quantity}</TableCell>
                                        <TableCell className="text-end">{item.price} ج.م</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("detail.history")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {history.length === 0 ? (
                            <p className="text-muted-foreground">لا يوجد سجلات تتبع</p>
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
                                            <TableCell>{record.trackingNumber || '-'}</TableCell>
                                            <TableCell>{record.status || '-'}</TableCell>
                                            <TableCell>{new Date(record.createdAt).toLocaleString()}</TableCell>
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
