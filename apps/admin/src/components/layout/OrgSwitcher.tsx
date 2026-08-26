'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

/**
 * Lets a user who belongs to 2+ orgs switch which one they're acting in.
 * Deliberately minimal — a plain <select>, not a redesign — since proving the
 * underlying mechanism (packages/db/src/orgContext.ts) works end to end is
 * the point of this pass, not the UI. Renders nothing for the (today, only)
 * common case of a single-org user.
 */
export function OrgSwitcher() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data } = trpc.me.get.useQuery();
  const switchOrg = trpc.me.switchOrg.useMutation({
    onSuccess: async () => {
      // Every cached procedure, not just me.get — react-query's cache is
      // still full of data scoped to the org the caller just left.
      await utils.invalidate();
      router.refresh();
    },
  });

  const orgs = data?.data.orgs ?? [];
  if (orgs.length <= 1) return null;

  return (
    <select
      value={data?.data.orgId}
      disabled={switchOrg.isPending}
      onChange={(e) => switchOrg.mutate({ orgId: e.target.value })}
      className="w-full text-xs rounded-md border px-2 py-1.5 outline-none"
      style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t2)' }}
    >
      {orgs.map((o) => (
        <option key={o.orgId} value={o.orgId}>
          {o.orgName}
        </option>
      ))}
    </select>
  );
}
