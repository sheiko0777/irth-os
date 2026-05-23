'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { BulkOrderActions } from '@/components/BulkOrderActions';
import { ExportButton } from '@/components/ExportButton';

const STATUS_LABELS: Record<string, string> = {
    pending:        'قيد الانتظار',
    confirmed:      'مؤكد',
    payment_failed: 'فشل الدفع',
    shipped:        'تم الشحن',
    delivered:      'تم التسليم',
    cancelled:      'ملغي',
};

const STATUS_COLORS: Record<string, string> = {
    pending:        'bg-amber-100 text-amber-800',
    confirmed:      'bg-blue-100 text-blue-800',
    payment_failed: 'bg-red-100 text-red-800',
    shipped:        'bg-purple-100 text-purple-800',
    delivered:      'bg-green-100 text-green-800',
    cancelled:      'bg-gray-100 text-gray-700',
};

export interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: string | number;
    createdAt: string | Date;
}

interface Props {
    orders: OrderRow[];
    locale: string;
}

export function OrdersClient({ orders, locale }: Props) {
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
        <div className="font-cairo" dir="rtl">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold text-[var(--t1)]">الطلبات</h1>
                <div className="flex items-center gap-2">
                    <ExportButton type="orders" label="تصدير الطلبات" />
                </div>
            </div>

            {/* Table */}
            <div className="bg-[var(--surface)] rounded-md border border-[var(--rim1)] overflow-hidden">
                <div className="overflow-x-auto">
                    <table key={key} className="w-full text-right">
                        <thead className="bg-gray-50 border-b border-[var(--rim1)]">
                            <tr>
                                <th className="px-4 py-3 w-10">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                        className="cursor-pointer"
                                        aria-label="تحديد الكل"
                                    />
                                </th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">رقم الطلب</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الحالة</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الإجمالي</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">التاريخ</th>
                                <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--rim1)]">
                            {orders.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--t2)]">
                                        لا توجد طلبات
                                    </td>
                                </tr>
                            ) : (
                                orders.map((order) => (
                                    <tr key={order.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(order.id)}
                                                onChange={() => toggleOne(order.id)}
                                                className="cursor-pointer"
                                                aria-label={`تحديد ${order.orderNumber}`}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm font-mono text-[var(--t1)]" dir="ltr">
                                            {order.orderNumber}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <span
                                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                    STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-700'
                                                }`}
                                            >
                                                {STATUS_LABELS[order.status] ?? order.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-[var(--t1)]" dir="ltr">
                                            {Number(order.totalAmount).toLocaleString('ar-EG', {
                                                minimumFractionDigits: 2,
                                            })}{' '}
                                            ج.م
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
                                                    عرض
                                                </Link>
                                                <Link
                                                    href={`/${locale}/orders/${order.id}/print`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[var(--t2)] hover:underline cursor-pointer"
                                                >
                                                    طباعة
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
        </div>
    );
}
