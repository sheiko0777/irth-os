'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface RestockButtonProps {
    returnId: string;
    itemId: string;
}

export function RestockButton({ returnId, itemId }: RestockButtonProps) {
    const t = useTranslations("returns");
    const router = useRouter();

    const restockMutation = trpc.returns.restock.useMutation({
        onSuccess: () => {
            toast.success(t("restockSuccess"));
            router.refresh();
        },
        onError: (err) => {
            toast.error(err.message || t("restockError"));
        }
    });

    const handleRestock = () => {
        restockMutation.mutate({ returnId, itemId });
    };

    return (
        <Button
            size="sm"
            variant="outline"
            onClick={handleRestock}
            disabled={restockMutation.isPending}
        >
            {restockMutation.isPending ? t("restocking") : t("restock")}
        </Button>
    );
}
