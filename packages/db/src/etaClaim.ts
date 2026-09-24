import { and, eq, sql } from 'drizzle-orm';
import { etaInvoices } from './schema/etaInvoices';
import type { DbTx } from './index';

export type EtaClaim = 'claimed' | 'already_issued' | 'in_flight';

// A claim older than this is presumed dead (process killed mid-call) and may be
// retaken. ponytail: a claimant killed AFTER ETA accepted but before recording
// can still double-issue once the window lapses; closing that needs ETA-side
// lookup by internalId before re-issuing.
const STALE_CLAIM = sql`interval '15 minutes'`;

/**
 * Take the right to call ETA for this order. Every issuer (outbox worker,
 * admin submit, admin submitPending) must win this before issueInvoice, so two
 * of them racing for the same order cannot both file a tax invoice.
 */
export async function claimEtaIssuance(
  tx: Pick<DbTx, 'insert' | 'select'>,
  orgId: string,
  orderId: string,
): Promise<EtaClaim> {
  const [claimed] = await tx.insert(etaInvoices)
    .values({ orgId, orderId, status: 'submitting' })
    .onConflictDoUpdate({
      target: etaInvoices.orderId,
      set: { status: 'submitting', updatedAt: new Date() },
      setWhere: sql`${etaInvoices.orgId} = ${orgId}
        AND ${etaInvoices.status} NOT IN ('submitted', 'valid')
        AND (${etaInvoices.status} <> 'submitting' OR ${etaInvoices.updatedAt} < now() - ${STALE_CLAIM})`,
    })
    .returning({ id: etaInvoices.id });
  if (claimed) return 'claimed';

  const [row] = await tx.select({ status: etaInvoices.status }).from(etaInvoices)
    .where(and(eq(etaInvoices.orderId, orderId), eq(etaInvoices.orgId, orgId)));
  return row?.status === 'submitted' || row?.status === 'valid' ? 'already_issued' : 'in_flight';
}
