"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { submitPendingAction } from "./actions";

interface EtaActionsProps {
    orderId?: string;
    invoiceStatus?: string;
}

export default function EtaActions({ orderId, invoiceStatus }: EtaActionsProps) {
    const [isPending, startTransition] = useTransition();

    const submitMutation = trpc.eta.submit.useMutation({
        onSuccess: (res) => {
            if (res.error) toast.error(`خطأ: ${res.error}`);
            else toast.success('تم إرسال الفاتورة بنجاح');
        },
        onError: () => toast.error('فشل إرسال الفاتورة'),
    });

    const checkMutation = trpc.eta.checkStatus.useMutation({
        onSuccess: (res) => {
            if (res.error) toast.error(`خطأ: ${res.error}`);
            else toast.success(`الحالة: ${res.data?.status ?? 'غير معروف'}`);
        },
        onError: () => toast.error('فشل التحقق من الحالة'),
    });

    if (!orderId) {
        return (
            <Button
                size="sm"
                variant="outline"
                className="font-cairo text-xs"
                disabled={isPending}
                onClick={() => {
                    startTransition(async () => {
                        const result = await submitPendingAction();
                        if (result.error) toast.error(`خطأ: ${result.error}`);
                        else toast.success(`تم إرسال ${result.data?.submitted} فاتورة`);
                    });
                }}
            >
                {isPending ? 'جارٍ الإرسال…' : 'إرسال الطلبات المعلقة'}
            </Button>
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
        </div>
    );
}
