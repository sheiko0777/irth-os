'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useCan } from '@/lib/permissions';

/**
 * The customer's sales rep, changeable in place by whoever holds
 * customers.assign (PR-2b). UX only: customers.assignSalesRep refuses anyone
 * else and any member who is not an active sales rep.
 */
export function SalesRepCell({ customerId, customerName, memberId }: { customerId: string; customerName: string; memberId: string | null }) {
  const can = useCan();
  const router = useRouter();
  const allowed = can('customers', 'assign');
  const reps = trpc.customers.salesReps.useQuery(undefined, { enabled: allowed, staleTime: 60_000 });
  const assign = trpc.customers.assignSalesRep.useMutation({
    onSuccess: () => { toast.success('اتغيّر مندوب المبيعات'); router.refresh(); },
    onError: (err) => toast.error(err.message || 'تعذر الإسناد'),
  });
  if (!allowed) return <>—</>;
  return (
    <select
      aria-label={`مندوب مبيعات ${customerName}`}
      value={memberId ?? ''}
      disabled={assign.isPending}
      onChange={(e) => assign.mutate({ customerIds: [customerId], memberId: e.target.value || null })}
      className="h-8 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-2 text-xs"
    >
      <option value="">بدون مندوب</option>
      {(reps.data?.data ?? []).map((r) => (
        <option key={r.memberId} value={r.memberId}>{r.name ?? r.username}</option>
      ))}
    </select>
  );
}
