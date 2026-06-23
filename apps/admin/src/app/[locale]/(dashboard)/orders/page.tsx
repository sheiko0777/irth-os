import { serverCaller } from '@/server/caller';
import { OrdersClient, type OrderRow } from './OrdersClient';

const PAGE_SIZE = 50;

export default async function OrdersPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string }>;
}) {
    const { locale } = await params;
    const { page: pageStr } = await searchParams;
    const page = Math.max(1, parseInt(pageStr ?? '1', 10));

    const caller = await serverCaller();

    const response = await caller.orders.list({ page, pageSize: PAGE_SIZE });
    const total = response.meta?.total ?? 0;

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

    return <OrdersClient orders={orders} locale={locale} page={page} pageSize={PAGE_SIZE} total={total} />;
}
