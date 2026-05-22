'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRouter } from 'next/navigation';

type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'restocked' | 'refunded' | 'exchanged';

interface UpdateStatusFormProps {
  returnId: string;
  currentStatus: string;
  adminNotes: string;
  refundAmount: string;
  resolutionType: string;
}

export default function UpdateStatusForm({
  returnId,
  currentStatus,
  adminNotes: initialAdminNotes,
  refundAmount: initialRefundAmount,
  resolutionType
}: UpdateStatusFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ReturnStatus>(currentStatus as ReturnStatus);
  const [adminNotes, setAdminNotes] = useState<string>(initialAdminNotes);
  const [refundAmount, setRefundAmount] = useState<string>(initialRefundAmount);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = trpc.returns.updateStatus.useMutation({
    onSuccess: () => {
      router.refresh();
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    }
  });

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError(null);

    updateMutation.mutate({
      id: returnId,
      status,
      adminNotes: adminNotes || undefined,
      refundAmount: refundAmount || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-cairo">
      <div>
        <label className="block text-sm text-[var(--t2)] mb-1">الحالة (Status)</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
        >
          <option value="requested">Requested</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="received">Received</option>
          <option value="restocked">Restocked</option>
          <option value="refunded">Refunded</option>
          <option value="exchanged">Exchanged</option>
        </select>
      </div>

      {(resolutionType === 'refund' || status === 'refunded') && (
        <div>
          <label className="block text-sm text-[var(--t2)] mb-1">المبلغ المسترد (Refund Amount)</label>
          <input
            type="number"
            step="0.01"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
            placeholder="0.00"
          />
        </div>
      )}

      <div>
        <label className="block text-sm text-[var(--t2)] mb-1">ملاحظات الإدارة (Admin Notes)</label>
        <textarea
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)] h-24 resize-none"
          placeholder="أدخل ملاحظات داخلية (Internal notes)..."
        />
      </div>

      {error && (
        <div className="text-[var(--crimson)] text-sm bg-[var(--crimson)]/10 p-2 rounded">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={updateMutation.isPending}
        className="w-full bg-[var(--t1)] text-[var(--surface)] font-bold py-2 px-4 rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {updateMutation.isPending ? 'جاري الحفظ...' : 'حفظ التغييرات (Save Changes)'}
      </button>
    </form>
  );
}
