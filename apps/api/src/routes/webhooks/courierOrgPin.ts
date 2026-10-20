import { envVar } from '../../utils/env';

/**
 * The org the platform-wide courier webhook secrets belong to.
 *
 * BOSTA_WEBHOOK_SECRET / ARAMEX_WEBHOOK_TOKEN are one value for the whole
 * deployment, and these webhooks carry no session: the tenant is chosen from
 * the payload (a tracking number, or a businessReference order id) by a lookup
 * that runs with no org filter. Anyone who knows the shared secret - every
 * merchant who configures the webhook in their own courier account - could
 * therefore forge delivery/COD events for ANOTHER tenant's shipments, or point
 * a businessReference at another tenant's order and overwrite its shipment.
 *
 * Pinning the shared-secret path to a single org removes that: a request
 * authenticated by the shared secret may only ever touch that org's rows.
 * Same pattern as Shopify's legacy single-tenant path (SHOPIFY_ORG_ID), which
 * is the fallback here so an existing deployment is protected without a new
 * variable. Other tenants need their own per-connection webhook secret.
 *
 * Returns null when neither variable is set. The handlers then behave as they
 * did before (unpinned) so a deployment that never set either keeps working,
 * and we say so loudly, once, because that state is the vulnerable one.
 */
let warnedUnpinned = false;

export function pinnedCourierOrgId(): string | null {
  const orgId = envVar('COURIER_WEBHOOK_ORG_ID') ?? envVar('SHOPIFY_ORG_ID') ?? null;
  if (!orgId && !warnedUnpinned) {
    warnedUnpinned = true;
    console.error(
      'COURIER_WEBHOOK_ORG_ID (or SHOPIFY_ORG_ID) is not set: shared-secret courier webhooks are not pinned to one tenant, '
      + 'so any holder of the shared secret can affect any tenant. Set COURIER_WEBHOOK_ORG_ID to the owning org id.',
    );
  }
  return orgId;
}

/** Test seam: forget that the unpinned warning was already emitted. */
export function resetCourierOrgPinWarning(): void {
  warnedUnpinned = false;
}
