import { eq, sql, type SQL } from 'drizzle-orm';
import { orders } from './schema';
import { customers } from './schema/customers';
import type { EffectiveAccess } from './permissions';

/**
 * The code half of a rep's narrowing (CLAUDE.md rule 3), shared by apps/admin
 * and apps/api so the two cannot disagree. 0077/0078's policies hold the same
 * line inside a scoped transaction; these hold it in the query itself, which
 * matters most where a read still runs on the unscoped connection.
 *
 * Undefined = not narrowed (staff, suppliers). A rep without a member id
 * matches nothing — fail closed, like the database.
 */
export function orderRepCondition(access: Pick<EffectiveAccess, 'principalKind' | 'memberId'>): SQL | undefined {
  if (access.principalKind === 'delivery_rep') {
    return access.memberId ? eq(orders.assignedRepMemberId, access.memberId) : sql`false`;
  }
  if (access.principalKind === 'sales_rep') {
    if (!access.memberId) return sql`false`;
    return sql`(${orders.createdByMemberId} = ${access.memberId} OR ${orders.customerId} IN (
      SELECT c.id FROM customers c WHERE c.org_id = ${orders.orgId} AND c.sales_rep_member_id = ${access.memberId}))`;
  }
  return undefined;
}

export function customerRepCondition(access: Pick<EffectiveAccess, 'principalKind' | 'memberId'>): SQL | undefined {
  if (access.principalKind !== 'sales_rep') return undefined;
  return access.memberId ? eq(customers.salesRepMemberId, access.memberId) : sql`false`;
}
