import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const searchParamsResolved = await searchParams;
    const t = await getTranslations("orders");
    const caller = await serverCaller();

    const search = typeof searchParamsResolved.search === "string" ? searchParamsResolved.search : undefined;
    const status = typeof searchParamsResolved.status === "string" ? (searchParamsResolved.status as "pending" | "confirmed" | "payment_failed" | "shipped" | "delivered" | "cancelled") : undefined;
    const page = typeof searchParamsResolved.page === "string" ? parseInt(searchParamsResolved.page, 10) : 1;

    const ordersResponse = await caller.orders.list({
        page,
        pageSize: 20,
        search,
        status,
    });

    if (ordersResponse.error) {
        return <div>Error loading orders</div>;
    }

    const { data: orders } = ordersResponse;

    const getStatusVariant = (status: string) => {
        switch (status) {
            case "delivered": return "default";
            case "cancelled": return "destructive";
            case "payment_failed": return "destructive";
            case "shipped": return "secondary";
            default: return "outline";
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
            </div>

            <div className="rounded-md border bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("table.orderNumber")}</TableHead>
                            <TableHead>{t("table.status")}</TableHead>
                            <TableHead>{t("table.totalAmount")}</TableHead>
                            <TableHead>{t("table.createdAt")}</TableHead>
                            <TableHead className="text-end">{t("table.actions")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center">No orders found.</TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order: { id: string, orderNumber: string, status: string, totalAmount: number, createdAt: string | Date }) => (
                                <TableRow key={order.id}>
                                    <TableCell className="font-medium">
                                        {order.orderNumber}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={getStatusVariant(order.status)}>
                                            {t(`status.${order.status}`)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        {order.totalAmount} ج.م
                                    </TableCell>
                                    <TableCell>
                                        {format(new Date(order.createdAt), 'PPpp', { locale: ar })}
                                    </TableCell>
                                    <TableCell className="text-end">
                                        <Link href={`/ar/orders/${order.id}`}>
                                            <Button variant="ghost" size="sm">
                                                عرض
                                            </Button>
                                        </Link>
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
