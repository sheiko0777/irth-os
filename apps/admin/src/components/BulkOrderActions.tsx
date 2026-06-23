'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS_OPTIONS = [
    { value: 'pending',        label: 'قيد الانتظار' },
    { value: 'confirmed',      label: 'مؤكد' },
    { value: 'payment_failed', label: 'فشل الدفع' },
    { value: 'shipped',        label: 'تم الشحن' },
    { value: 'delivered',      label: 'تم التسليم' },
    { value: 'cancelled',      label: 'ملغي' },
] as const;

type StatusValue = typeof STATUS_OPTIONS[number]['value'];

interface Props {
    selectedIds: string[];
    onSuccess: () => void;
}

export function BulkOrderActions({ selectedIds, onSuccess }: Props) {
    const [status, setStatus] = useState<StatusValue>('confirmed');

    const mutation = trpc.bulk.bulkUpdateOrderStatus.useMutation({
        onSuccess: () => {
            toast.success(`تم تحديث ${selectedIds.length} طلب بنجاح`);
            onSuccess();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء التحديث');
        },
    });

    if (selectedIds.length === 0) return null;

    const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--surface)] border-t border-[var(--rim1)] shadow-lg font-cairo"
            dir="rtl"
        >
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
                <span className="text-sm text-[var(--t2)]">
                    {selectedIds.length} طلب محدد
                </span>

                <select
                    value={status}
                    onChange={(e: { target: { value: string } }) =>
                        setStatus(e.target.value as StatusValue)
                    }
                    className="text-sm border border-[var(--rim1)] rounded px-2 py-1 bg-[var(--surface)] text-[var(--t1)] cursor-pointer"
                >
                    {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>

                <ConfirmDialog
                    title="تأكيد تحديث الحالة"
                    description={`سيتم تغيير حالة ${selectedIds.length} طلب إلى «${statusLabel}». هل تريد المتابعة؟`}
                    confirmLabel="تطبيق"
                    destructive={false}
                    pending={mutation.isPending}
                    onConfirm={() => mutation.mutate({ ids: selectedIds, status })}
                >
                    <button
                        disabled={mutation.isPending}
                        className="bg-[var(--gold)] text-white text-sm px-4 py-1.5 rounded hover:opacity-90 disabled:opacity-50 cursor-pointer transition-opacity"
                    >
                        {mutation.isPending ? 'جارٍ التحديث...' : 'تطبيق'}
                    </button>
                </ConfirmDialog>
            </div>
        </div>
    );
}
