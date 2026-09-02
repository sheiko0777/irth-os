'use client';
import { formatMoney, fromMinor } from '@irth/domain';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BulkOrderActions } from '@/components/BulkOrderActions';
import { ExportButton } from '@/components/ExportButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PaginationNav } from '@/components/ui/PaginationNav';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ShoppingCart } from 'lucide-react';

export interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    totalAmountMinor: bigint;
    createdAt: string | Date;
}

interface Props {
    orders: OrderRow[];
    locale: string;
    page: number;
    pageSize: number;
    total: number;
    /** Drives the empty-state copy: "no orders yet" vs "nothing matched". */
    filtered?: boolean;
}

export function OrdersClient({ orders, locale, page, pageSize, total, filtered }: Props) {
    const t = useTranslations('orders');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [key, setKey] = useState(0);

    const allSelected = orders.length > 0 && selectedIds.length === orders.length;

    const toggleAll = () => {
        setSelectedIds(allSelected ? [] : orders.map((o) => o.id));
    };

    const toggleOne = (id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const handleSuccess = useCallback(() => {
        setSelectedIds([]);
        setKey((k) => k + 1); // force re-render to clear state
    }, []);

    return (
        <div>
            {/* The heading and search live in the server page now, above the
                filter tabs; only the export action belongs to the table. */}
            <div className="flex items-center justify-end mb-3">
                <ExportButton type="orders" label={t('actions.export')} />
            </div>

            {/* Table */}
            <div className="bg-[var(--surface)] rounded-md border border-[var(--rim1)] overflow-hidden">
                <div className="overflow-x-auto">
                    <table key={key} className="w-full text-start">
                        <thead className="bg-raised border-b border-[var(--rim1)]">
                            <tr>
                                <th className="px-4 py-3 w-10">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                        className="cursor-pointer"
                                        aria-label={t('table.selectAll')}
                                    />
                                </th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">{t('table.orderNumber')}</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">{t('table.status')}</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">{t('table.totalAmount')}</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">{t('table.date')}</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">{t('table.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--rim1)]">
                            {orders.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-0">
                                        {/* "Nothing here" and "nothing matched"
                                            are different problems and need
                                            different next steps. */}
                                        <EmptyState
                                            icon={ShoppingCart}
                                            title={filtered ? t('empty.filteredTitle') : t('empty.title')}
                                            hint={
                                                filtered
                                                    ? t('empty.filteredHint')
                                                    : t('empty.hint')
                                            }
                                        />
                                    </td>
                                </tr>
                            ) : (
                                orders.map((order) => (
                                    <tr key={order.id} className="hover:bg-raised/50">
                                        <td className="px-4 py-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(order.id)}
                                                onChange={() => toggleOne(order.id)}
                                                className="cursor-pointer"
                                                aria-label={t('table.selectOrder', { orderNumber: order.orderNumber })}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm font-mono text-[var(--t1)]" dir="ltr">
                                            {order.orderNumber}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <StatusBadge status={order.status} domain="order" />
                                        </td>
                                        <td className="px-4 py-3 text-sm text-[var(--t1)]" dir="ltr">
                                            {formatMoney(fromMinor(order.totalAmountMinor))}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-[var(--t2)]">
                                            {order.createdAt
                                                ? new Date(order.createdAt).toLocaleDateString('ar-EG')
                                                : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <div className="flex gap-2 justify-end">
                                                <Link
                                                    href={`/${locale}/orders/${order.id}`}
                                                    className="text-[var(--gold)] hover:underline cursor-pointer"
                                                >
                                                    {t('actions.view')}
                                                </Link>
                                                <Link
                                                    href={`/${locale}/orders/${order.id}/print`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[var(--t2)] hover:underline cursor-pointer"
                                                >
                                                    {t('actions.print')}
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Fixed bulk bar — only visible when rows selected */}
            <BulkOrderActions selectedIds={selectedIds} onSuccess={handleSuccess} />

            <PaginationNav page={page} pageSize={pageSize} total={total} />
        </div>
    );
}
