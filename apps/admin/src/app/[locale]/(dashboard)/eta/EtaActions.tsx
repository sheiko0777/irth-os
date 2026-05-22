"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { submitPendingAction } from "./actions";

interface EtaActionsProps {
    orderId?: string;
    invoiceStatus?: string;
}

export default function EtaActions({ orderId, invoiceStatus }: EtaActionsProps) {
    const [message, setMessage] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const submitMutation = trpc.eta.submit.useMutation({
        onSuccess: (res) => setMessage(res.error ? `خطأ: ${res.error}` : 'تم إرسال الفاتورة بنجاح'),
        onError: () => setMessage('فشل الإرسال'),
    });

    const checkMutation = trpc.eta.checkStatus.useMutation({
        onSuccess: (res) => setMessage(res.error ? `خطأ: ${res.error}` : `الحالة: ${res.data?.status}`),
        onError: () => setMessage('فشل التحقق'),
    });

    if (!orderId) {
        return (
            <div className="flex gap-2 items-center">
                <Button
                    size="sm"
                    variant="outline"
                    className="font-cairo text-xs"
                    disabled={isPending}
                    onClick={() => {
                        startTransition(async () => {
                            const result = await submitPendingAction();
                            setMessage(result.error ? `خطأ: ${result.error}` : `تم إرسال ${result.data?.submitted} فاتورة`);
                        });
                    }}
                >
                    {isPending ? 'جارٍ الإرسال…' : 'إرسال الطلبات المعلقة'}
                </Button>
                {message && <span className="text-xs text-[var(--t2)] font-cairo">{message}</span>}
            </div>
        );
    }

    return (
        <div className="flex gap-1 items-center">
            {(invoiceStatus === 'pending' || invoiceStatus === 'error') && (
                <Button
                    size="sm"
                    variant="outline"
                    className="font-cairo text-xs"
                    disabled={submitMutation.isPending}
                    onClick={() => submitMutation.mutate({ orderId })}
                >
                    {submitMutation.isPending ? '…' : 'إرسال'}
                </Button>
            )}
            {invoiceStatus === 'submitted' && (
                <Button
                    size="sm"
                    variant="outline"
                    className="font-cairo text-xs"
                    disabled={checkMutation.isPending}
                    onClick={() => checkMutation.mutate({ orderId })}
                >
                    {checkMutation.isPending ? '…' : 'تحقق'}
                </Button>
            )}
            {message && <span className="text-xs text-[var(--t2)]">{message}</span>}
        </div>
    );
}
