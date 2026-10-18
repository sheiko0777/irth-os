import { courierShipments, type DbInstance } from '@irth/db';
import { and, eq } from 'drizzle-orm';

type ShipmentResolution =
  | { status: 'ambiguous' }
  | { status: 'resolved'; shipment: typeof courierShipments.$inferSelect | undefined };

export async function resolveCourierShipmentByTracking(
  db: Pick<DbInstance, 'select'>,
  courier: 'bosta' | 'aramex',
  trackingNumber: string,
  /**
   * Restrict the lookup to one org. The shared-secret webhooks pass the org that
   * secret belongs to (see courierOrgPin.ts), so a request authenticated by it
   * can never resolve - or collide with - another tenant's shipment.
   */
  orgId?: string | null,
): Promise<ShipmentResolution> {
  // This lookup selects the tenant before an org context exists. Waybill
  // numbers can collide across tenants: restrict the courier and never guess.
  const matches = await db.select().from(courierShipments)
    .where(and(
      eq(courierShipments.courier, courier),
      eq(courierShipments.trackingNumber, trackingNumber),
      orgId ? eq(courierShipments.orgId, orgId) : undefined,
    ))
    .limit(2);

  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'resolved', shipment: matches[0] };
}
