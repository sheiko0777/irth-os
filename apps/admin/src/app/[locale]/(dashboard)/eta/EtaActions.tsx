'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/button';
import { submitPendingAction } from './actions';
import { RefreshCw, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function EtaActions() {
    const [isPending, startTransition] = useTransition();
    const [result, setResult] = useState<{ count?: number, error?: string } | null>(null);
    const router = useRouter();

    const handleSubmitPending = () => {
        startTransition(async () => {
            const res = await submitPendingAction();
            setResult(res as { count?: number, error?: string });
        });
    };

    const handleRefresh = () => {
        startTransition(() => {
            router.refresh();
        });
    };

    return (
        <div className="flex items-center gap-4">
            {result && (
                <div className={`text-sm ${result.error ? 'text-red-500' : 'text-emerald-600'}`}>
                    {result.error ? result.error : `تم إرسال ${result.count} فاتورة`}
                </div>
            )}

            <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isPending}
                className="gap-2"
            >
                <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
                تحديث الحالات
            </Button>

            <Button
                size="sm"
                onClick={handleSubmitPending}
                disabled={isPending}
                className="gap-2 bg-[var(--gold)] text-[var(--surface)] hover:bg-[var(--gold-br)]"
            >
                <Send className="h-4 w-4" />
                إرسال المعلقة
            </Button>
        </div>
    );
}
