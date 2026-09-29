import { orderStatusEnum } from '@irth/db';
import { getTranslations } from 'next-intl/server';
import { serverCaller } from '@/server/caller';
import { FilterTabs, type FilterTab } from '@/components/ui/FilterTabs';
import { SearchField } from '@/components/ui/SearchField';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { OrdersClient, type OrderRow } from './OrdersClient';

const PAGE_SIZE = 50;

type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

/**
 * Pipeline order, then terminal states — the same reading order as PipelineBar.
 *
 * The tab list is derived from the schema enum rather than hand-written, so a
 * status added to the database shows up here automatically and one that does
 * not exist cannot be offered. Writing it by hand caught exactly that: the list
 * included `returned`, which statusMaps has a label for but the enum has never
 * contained, and tsc rejected it.
 */
const RANK: Record<string, number> = {
    pending: 0,
    confirmed: 1,
    shipped: 2,
    delivered: 3,
    payment_failed: 4,
    cancelled: 5,
};

const TAB_ORDER: readonly OrderStatus[] = [...orderStatusEnum.enumValues].sort(
    (a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99),
);

function isOrderStatus(v: string | undefined): v is OrderStatus {
    return !!v && (orderStatusEnum.enumValues as readonly string[]).includes(v);
}

export default async function OrdersPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; status?: string; q?: string; blocked?: string }>;
}) {
    const { locale } = await params;
    const { page: pageStr, status: statusParam, q, blocked } = await searchParams;
    const blockedOnly = blocked === '1';
    const page = Math.max(1, parseInt(pageStr ?? '1', 10));
    const t = await getTranslations('orders');

    // An unknown ?status= is dropped rather than passed through — the router
    // would reject it and the whole page would error on a hand-edited URL.
    const status = isOrderStatus(statusParam) ? statusParam : undefined;
    const search = q?.trim() || undefined;

    const caller = await serverCaller();
    const response = await caller.orders.list({ page, pageSize: PAGE_SIZE, status, search, blockedOnly });
    // A failed list used to render as an empty table — "no orders" — which
    // tells the owner there is no work when the load simply failed. Let the
    // dashboard error boundary say so instead.
    if (response.error) {
        throw new Error(`orders.list failed: ${String(response.error)}`);
    }
    const total = response.meta?.total ?? 0;

    const counts = new Map(
        (response.meta?.statusCounts ?? []).map((s) => [s.status, s.count]),
    );
    const allCount = [...counts.values()].reduce((sum, n) => sum + n, 0);

    const tabs: FilterTab[] = [
        { label: t('allStatuses'), count: allCount },
        // A status with nothing in it is noise in the strip, so it is dropped —
        // except the one currently selected, which has to stay reachable or the
        // active tab would vanish from under the user.
        ...TAB_ORDER.filter((s) => (counts.get(s) ?? 0) > 0 || s === status).map((s) => ({
            value: s,
            label: t(`status.${s}`),
            count: counts.get(s) ?? 0,
        })),
    ];

    const orders: OrderRow[] = response.data.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        blocked: o.importStatus === 'blocked',
        assignedRepMemberId: o.assignedRepMemberId,
        totalAmountMinor: o.totalAmountMinor,
        createdAt: o.createdAt,
    }));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold text-[var(--t1)]">{t('title')}</h1>
                <SearchField param="q" placeholder={t('search')} />
            </div>

            {/* Blocked imports are shown above everything: an order that
                could not be imported completely needs a person, not a filter. */}
            {(response.meta?.blockedCount ?? 0) > 0 && (
                <Link
                    href={blockedOnly ? `/${locale}/orders` : `/${locale}/orders?blocked=1`}
                    className="flex items-center gap-2 rounded-md border border-[var(--warning)] px-3 py-2 text-sm text-[var(--warning)]"
                >
                    <AlertTriangle size={16} />
                    {t('blockedFilter')}: <span className="tabular-nums" dir="ltr">{response.meta?.blockedCount}</span>
                </Link>
            )}

            <FilterTabs param="status" tabs={tabs} />

            <OrdersClient
                orders={orders}
                locale={locale}
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                filtered={!!status || !!search || blockedOnly}
            />
        </div>
    );
}