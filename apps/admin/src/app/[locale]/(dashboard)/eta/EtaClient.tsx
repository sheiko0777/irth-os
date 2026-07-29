'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export interface EtaInvoice {
    id: string;
    orderId: string;
    etaUuid: string | null;
    longId: string | null;
    qrCodeData: string | null;
    status: string;
    errorMessage: string | null;
    retryCount: number;
    submittedAt: Date | null;
    createdAt: Date;
}

interface EtaClientProps {
    invoices: EtaInvoice[];
}

import { StatusBadge } from '@/components/ui/StatusBadge';

const TAB_OPTIONS = [
    { label: 'الكل', value: 'all' },
    { label: 'مُصدرة', value: 'submitted' },
    { label: 'خطأ', value: 'error' },
    { label: 'ملغية', value: 'cancelled' },
];

export default function EtaClient({ invoices: initialInvoices }: EtaClientProps) {
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

    const utils = trpc.useUtils();

    const submitMutation = trpc.eta.submit.useMutation({
        onSuccess: () => {
            setPendingOrderId(null);
            utils.eta.list.invalidate();
        },
        onError: () => setPendingOrderId(null),
    });

    const checkMutation = trpc.eta.checkStatus.useMutation({
        onSuccess: () => {
            setPendingOrderId(null);
            utils.eta.list.invalidate();
        },
        onError: () => setPendingOrderId(null),
    });

    const cancelMutation = trpc.eta.cancel.useMutation({
        onSuccess: () => {
            setPendingOrderId(null);
            utils.eta.list.invalidate();
        },
        onError: () => setPendingOrderId(null),
    });

    const submitPendingMutation = trpc.eta.submitPending.useMutation({
        onSuccess: () => {
            utils.eta.list.invalidate();
        },
    });

    const handleSubmit = (orderId: string) => {
        setPendingOrderId(orderId);
        submitMutation.mutate({ orderId });
    };

    const handleCheckStatus = (orderId: string) => {
        setPendingOrderId(orderId);
        checkMutation.mutate({ orderId });
    };

    const handleCancel = (orderId: string) => {
        const reason = window.prompt('سبب الإلغاء:');
        if (reason) {
            setPendingOrderId(orderId);
            cancelMutation.mutate({ orderId, reason });
        }
    };

    const handleSubmitPending = () => {
        submitPendingMutation.mutate();
    };

    const filteredInvoices = initialInvoices.filter((inv) => {
        if (filterStatus === 'all') return true;
        if (filterStatus === 'submitted') return inv.status === 'submitted' || inv.status === 'valid';
        return inv.status === filterStatus;
    });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex gap-2 bg-[var(--surface)] p-1 rounded-md border border-[var(--rim1)]">
                    {TAB_OPTIONS.map((tab) => (
                        <button
                            key={tab.value}
                            onClick={() => setFilterStatus(tab.value)}
                            className={`px-4 py-2 text-sm rounded-md transition-colors ${
                                filterStatus === tab.value
                                    ? 'bg-[var(--rim1)] text-[var(--t1)]'
                                    : 'text-[var(--t2)] hover:text-[var(--t1)]'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <Button
                    onClick={handleSubmitPending}
                    disabled={submitPendingMutation.isPending}
                    className="bg-[var(--emerald)] text-white hover:bg-[var(--emerald)]/90"
                >
                    {submitPendingMutation.isPending ? 'جارٍ الإصدار…' : 'إصدار الكل المعلقة'}
                </Button>
            </div>

            <div className="rounded-md border border-[var(--rim1)] overflow-hidden bg-[var(--surface)]">
                <Table>
                    <TableHeader className="bg-[var(--rim1)]">
                        <TableRow>
                            <TableHead className="text-right text-[var(--t1)]">رقم الطلب</TableHead>
                            <TableHead className="text-right text-[var(--t1)]">الحالة</TableHead>
                            <TableHead className="text-right text-[var(--t1)]">UUID</TableHead>
                            <TableHead className="text-right text-[var(--t1)]">التاريخ</TableHead>
                            <TableHead className="text-right text-[var(--t1)]">إجراءات</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredInvoices.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-[var(--t2)] py-8">
                                    لا توجد فواتير
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredInvoices.map((inv) => {
                                const isRowPending = pendingOrderId === inv.orderId;
                                return (
                                    <TableRow key={inv.id} className="border-b border-[var(--rim1)]">
                                        <TableCell className="font-mono text-xs text-[var(--t2)]">
                                            {inv.orderId.slice(0, 8)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1 items-start">
                                                <StatusBadge status={inv.status} domain="eta" />
                                                {inv.status === 'error' && inv.errorMessage && (
                                                    <span className="text-[10px] text-[var(--crimson)]">
                                                        {inv.errorMessage}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-[var(--t2)]">
                                            {inv.etaUuid ? inv.etaUuid.slice(0, 8) : '—'}
                                        </TableCell>
                                        <TableCell className="text-[var(--t2)] text-sm">
                                            {inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString('ar-EG') : '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-2">
                                                {!inv.etaUuid && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-xs"
                                                        disabled={isRowPending}
                                                        onClick={() => handleSubmit(inv.orderId)}
                                                    >
                                                        إصدار
                                                    </Button>
                                                )}
                                                {inv.etaUuid && (inv.status === 'submitted' || inv.status === 'valid') && (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="text-xs"
                                                            disabled={isRowPending}
                                                            onClick={() => handleCheckStatus(inv.orderId)}
                                                        >
                                                            فحص الحالة
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            className="text-xs bg-[var(--crimson)] text-white hover:bg-[var(--crimson)]/90"
                                                            disabled={isRowPending}
                                                            onClick={() => handleCancel(inv.orderId)}
                                                        >
                                                            إلغاء
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
