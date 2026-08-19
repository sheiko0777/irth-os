'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface Props {
  type: 'markRemitted' | 'reconcile';
  remittanceId?: string;
  shipmentId?: string;
  status?: string;
  codCollected?: boolean;
  codRemitted?: boolean;
}

export default function CourierActions({ type, remittanceId, shipmentId, status, codCollected, codRemitted }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const markRemittedMutation = trpc.courier.shipments.markRemitted.useMutation({
    onSuccess: () => router.refresh(),
  });

  const reconcileMutation = trpc.courier.remittances.reconcile.useMutation({
    onSuccess: () => router.refresh(),
  });

  const handleMarkRemitted = async () => {
    if (!shipmentId) return;
    setLoading(true);
    try {
      // Typically the user would input a remittance reference, using a placeholder 'MANUAL'
      await markRemittedMutation.mutateAsync({ shipmentId, remittanceId: 'MANUAL_REMITTANCE' });
    } finally {
      setLoading(false);
    }
  };

  const handleReconcile = async () => {
    if (!remittanceId) return;
    setLoading(true);
    try {
      await reconcileMutation.mutateAsync({ remittanceId });
    } finally {
      setLoading(false);
    }
  };

  if (type === 'markRemitted') {
    if (!codCollected || codRemitted) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleMarkRemitted}
        disabled={loading}
        className="text-[var(--gold)] border-[var(--gold-br)] hover:bg-[var(--gold-bg)] h-8"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
        تعليم كمسدد
      </Button>
    );
  }

  if (type === 'reconcile') {
    if (status === 'reconciled') return null;
    return (
      <Button
        variant="default"
        size="sm"
        onClick={handleReconcile}
        disabled={loading}
        className="bg-[var(--emerald)] hover:bg-[var(--emerald)]/90 text-void h-8"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
        إجراء تسوية
      </Button>
    );
  }

  return null;
}
