'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useCan } from '@/lib/permissions';

/**
 * Assigning orders to a delivery rep from the orders list (PR-2a). UX only:
 * orders.assignRep refuses without orders.assign, and refuses orders that are
 * not out for delivery or whose cash a rep already collected.
 */
function useReps(enabled: boolean) {
  return trpc.orders.reps.useQuery(undefined, { enabled, staleTime: 60_000 });
}

export function RepName({ memberId }: { memberId: string | null }) {
  const can = useCan();
  const reps = useReps(can('orders', 'assign') && memberId !== null);
  if (!memberId) return <>—</>;
  const rep = reps.data?.data.find((r) => r.memberId === memberId);
  return <>{rep ? rep.name ?? rep.username ?? 'مندوب' : 'مندوب'}</>;
}

export function AssignRepControl({ orderIds, onSuccess }: { orderIds: string[]; onSuccess: () => void }) {
  const can = useCan();
  const router = useRouter();
  const allowed = can('orders', 'assign');
  const reps = useReps(allowed);
  const [memberId, setMemberId] = useState('');
  const assign = trpc.orders.assignRep.useMutation({
    onSuccess: ({ data }) => {
      if (data.skipped > 0) {
        toast.warning(`اتسند ${data.assigned.length} طلب، و${data.skipped} مش ممكن يتسند (مش في حالة توصيل أو اتحصّل).`);
      } else {
        toast.success(`اتسند ${data.assigned.length} طلب`);
      }
      onSuccess();
      router.refresh();
    },
    onError: (err) => toast.error(err.message || 'تعذر الإسناد'),
  });

  if (!allowed) return null;
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="إسناد لمندوب"
        value={memberId}
        onChange={(e) => setMemberId(e.target.value)}
        className="text-sm border border-[var(--rim1)] rounded-md px-2 py-1 bg-[var(--surface)] text-[var(--t1)]"
      >
        <option value="">اختار مندوب…</option>
        {(reps.data?.data ?? []).map((r) => (
          <option key={r.memberId} value={r.memberId}>{r.name ?? r.username}</option>
        ))}
        <option value="none">إلغاء الإسناد</option>
      </select>
      <button
        type="button"
        disabled={!memberId || assign.isPending}
        onClick={() => assign.mutate({ orderIds, memberId: memberId === 'none' ? null : memberId })}
        className="border border-[var(--rim1)] text-sm px-3 py-1.5 rounded-md hover:bg-raised disabled:opacity-50 cursor-pointer"
      >
        {assign.isPending ? 'جارٍ الإسناد…' : 'إسناد'}
      </button>
    </div>
  );
}
