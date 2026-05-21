import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { KanbanBoard } from "@/components/orders/KanbanBoard";
import { OrderStatus } from "@/lib/orderTypes";
import { KanbanCardProps } from "@/components/orders/KanbanCard";

export default async function OrdersPage() {
    const t = await getTranslations("orders");
    const caller = await serverCaller();

    // Fetch orders (fetching a large page size since we want them all on the board)
    const ordersResponse = await caller.orders.list({
        page: 1,
        pageSize: 1000,
    });

    if (ordersResponse.error) {
        return <div>Error loading orders</div>;
    }

    const { data: orders } = ordersResponse;

    const kanbanOrders: KanbanCardProps[] = orders.map(
        (order: {
            id: string;
            orderNumber: string;
            status: string;
            totalAmount: number;
            createdAt: string | Date;
            // The list procedure does not include customerName, so we'll leave it empty or default
        }) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            customerName: '', // Customer name not in list query
            total: `${order.totalAmount} ج.م`,
            createdAt: format(new Date(order.createdAt), 'PPpp', { locale: ar }),
            status: order.status as OrderStatus,
        })
    );

    const totalCount = orders.length;
    const pendingCount = orders.filter((o: { status: string }) => o.status === 'pending').length;
    const deliveredCount = orders.filter((o: { status: string }) => o.status === 'delivered').length;

    return (
        <div className="space-y-6 flex flex-col h-full">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">لوحة الطلبات</h1>
            </div>

            <div className="flex gap-4">
                <div className="bg-white p-4 rounded-lg border border-gray-200 flex-1 flex flex-col">
                    <span className="text-sm text-gray-500">إجمالي الطلبات</span>
                    <span className="text-2xl font-bold text-gray-900">{totalCount}</span>
                </div>
                <div className="bg-white p-4 rounded-lg border border-gray-200 flex-1 flex flex-col">
                    <span className="text-sm text-gray-500">قيد الانتظار</span>
                    <span className="text-2xl font-bold text-amber-600">{pendingCount}</span>
                </div>
                <div className="bg-white p-4 rounded-lg border border-gray-200 flex-1 flex flex-col">
                    <span className="text-sm text-gray-500">تم التسليم</span>
                    <span className="text-2xl font-bold text-emerald-600">{deliveredCount}</span>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                <KanbanBoard initialOrders={kanbanOrders} />
            </div>
        </div>
    );
}
