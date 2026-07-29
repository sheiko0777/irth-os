'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { trpc } from '@/lib/trpc';

type ExportType = 'orders' | 'inventory' | 'customers';

interface Props {
    type: ExportType;
    label: string;
    startDate?: string;
    endDate?: string;
}

const HEADERS: Record<ExportType, string[]> = {
    orders:    ['رقم الطلب', 'اسم العميل', 'الحالة', 'الإجمالي', 'تاريخ الإنشاء', 'طريقة الدفع'],
    inventory: ['المنتج', 'المتغير', 'SKU', 'الكمية', 'نقطة إعادة الطلب', 'منخفض'],
    customers: ['الاسم', 'البريد الإلكتروني', 'الهاتف', 'نقاط الولاء', 'الطلبات', 'الإجمالي', 'تاريخ التسجيل'],
};

function rowToValues(type: ExportType, row: Record<string, unknown>): string[] {
    if (type === 'orders') {
        return [
            String(row.orderNumber ?? ''),
            String(row.customerName ?? ''),
            String(row.status ?? ''),
            String(row.totalAmount ?? ''),
            row.createdAt ? new Date(row.createdAt as string).toLocaleDateString('ar-EG') : '',
            String(row.paymentMethod ?? ''),
        ];
    }
    if (type === 'inventory') {
        return [
            String(row.productName ?? ''),
            String(row.variantName ?? ''),
            String(row.sku ?? ''),
            String(row.quantity ?? ''),
            String(row.reorderPoint ?? ''),
            row.isLow ? 'نعم' : 'لا',
        ];
    }
    // customers
    return [
        String(row.name ?? ''),
        String(row.email ?? ''),
        String(row.phone ?? ''),
        String(row.loyaltyPoints ?? ''),
        String(row.totalOrders ?? ''),
        String(row.totalSpent ?? ''),
        row.createdAt ? new Date(row.createdAt as string).toLocaleDateString('ar-EG') : '',
    ];
}

function toCsv(type: ExportType, rows: Record<string, unknown>[]): string {
    const headers = HEADERS[type];
    const lines = [
        headers.join(','),
        ...rows.map((row) =>
            rowToValues(type, row)
                .map((v) => `"${v.replace(/"/g, '""')}"`)
                .join(',')
        ),
    ];
    return '﻿' + lines.join('\r\n');
}

function download(filename: string, csv: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function ExportButton({ type, label, startDate, endDate }: Props) {
    const [loading, setLoading] = useState(false);
    const utils = trpc.useUtils();

    const handleExport = async () => {
        setLoading(true);
        try {
            let rows: Record<string, unknown>[] = [];

            if (type === 'orders') {
                const sd = startDate ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
                const ed = endDate ?? new Date().toISOString().slice(0, 10);
                const result = await utils.bulk.exportOrders.fetch({ startDate: sd, endDate: ed });
                rows = result.data as Record<string, unknown>[];
            } else if (type === 'inventory') {
                const result = await utils.bulk.exportInventory.fetch();
                rows = result.data as Record<string, unknown>[];
            } else {
                const result = await utils.bulk.exportCustomers.fetch();
                rows = result.data as Record<string, unknown>[];
            }

            const csv = toCsv(type, rows);
            const ts = new Date().toISOString().slice(0, 10);
            download(`${type}-${ts}.csv`, csv);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleExport}
            disabled={loading}
            className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] text-sm px-3 py-1.5 rounded hover:bg-raised disabled:opacity-50 cursor-pointer transition-colors"
        >
            <Download className="w-4 h-4" />
            {loading ? 'جارٍ التصدير...' : label}
        </button>
    );
}
