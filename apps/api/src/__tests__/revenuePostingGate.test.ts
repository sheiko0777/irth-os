/**
 * Fails the build if a route can move an order to 'delivered' without booking
 * the sale.
 *
 * WHY
 *
 * Three code paths transition an order to 'delivered':
 *
 *   apps/admin/src/server/routers/orders.ts  updateStatus (tRPC)
 *   apps/api/src/routes/orders.ts            PATCH /:id/status
 *   apps/api/src/routes/webhooks/bosta.ts    courier delivery scan
 *
 * Only the first ever posted revenue. The other two wrote the audit row,
 * notified the customer and queued the ETA e-invoice, and booked no revenue, no
 * VAT, no COGS and no receivable. The API route's own comment even claimed the
 * transition "can post ledger entries (revenue, COGS)" while the transaction
 * below it posted none — so the file asserted the very thing it failed to do,
 * which is why review never caught it.
 *
 * The courier webhook is the path that fires in real operations. The effect was
 * that a parcel is delivered, an ETA tax invoice is filed for the sale, and the
 * sale never reaches the ledger. Reports read the ledger (CLAUDE.md rule 2), so
 * the books understated revenue while the tax authority had already been told.
 *
 * WHAT THIS CHECKS
 *
 * Membership is behavioural, not a hardcoded file list: a route file that both
 * UPDATEs `orders` and mentions the 'delivered' status is a file that can cause
 * this posting, so it must call `postOrderDeliveredEntry`. Files that update
 * orders without ever mentioning 'delivered' (paymob, which only moves an order
 * to confirmed/payment_failed; shopify, which syncs other fields) are out of
 * scope and stay out until the day one of them grows a delivered transition —
 * at which point this test starts requiring the posting there too.
 *
 * The guard for whether a given call actually posts lives inside
 * postOrderDeliveredEntry, not here. This test only proves the call exists; the
 * integration suite proves it books the right entry exactly once.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../routes');

/** Every .ts file under src/routes, recursing into the webhooks/ subtree. */
function routeFiles(dir: string = ROUTES): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('revenue posting gate', () => {
  it('every route that can deliver an order books the sale', () => {
    const files = routeFiles();

    // Guard against the scanner silently matching nothing — the same failure
    // mode serializationGate and tenancyGate protect against. A gate that
    // passes because it found no files is not a gate.
    expect(files.length).toBeGreaterThan(5);

    const offenders = files.filter((file) => {
      const src = readFileSync(file, 'utf8');
      const canDeliver = /\.update\(\s*orders\s*\)/.test(src) && /['"]delivered['"]/.test(src);
      return canDeliver && !src.includes('postOrderDeliveredEntry');
    });

    expect(
      offenders.map((f) => path.relative(ROUTES, f)),
      'these routes transition an order to delivered without posting revenue',
    ).toEqual([]);
  });
});
