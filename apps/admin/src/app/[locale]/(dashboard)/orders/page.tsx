import { serverCaller } from '@/server/caller';
import { OrdersClient, type OrderRow } from './OrdersClient';

export default async function OrdersPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const caller = await serverCaller();

    const response = await caller.orders.list({ page: 1, pageSize: 200 });

    const orders: OrderRow[] = response.error
        ? []
        : response.data.map((o: {
            id: string;
            orderNumber: string;
            status: string;
            totalAmount: string | number;
            createdAt: string | Date;
          }) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            totalAmount: o.totalAmount,
            createdAt: o.createdAt,
        }));

    return <OrdersClient orders={orders} locale={locale} />;
}
