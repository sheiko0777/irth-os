import { and, eq } from 'drizzle-orm';
import { inventoryItems, inventoryMovements } from './schema/inventory';
import type { DbTx } from './index';

/**
 * Rounds a bigint division to the nearest integer, ties to even.
 *
 * Duplicated from `packages/domain`'s `divideRoundHalfEven` rather than
 * imported: `packages/db/package.json` has zero workspace dependencies today
 * (drizzle-orm, postgres, zod only), and adding `@irth/domain` would need
 * `pnpm install` to link it — which this refactor cannot run here (10-30
 * minutes on this repo, and a killed run has corrupted node_modules before).
 * Eleven lines of pure bigint arithmetic duplicated, with this comment
 * explaining why, is a smaller cost than either breaking that dependency
 * boundary or blocking this work on an install.
 */
function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('division by zero');
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice < d) return sign * q;
  if (twice > d) return sign * (q + 1n);
  return sign * (q % 2n === 0n ? q : q + 1n);
}

/**
 * Weighted-average unit cost after receiving `inQty` units at `inCostMinor`
 * (total cost of the receipt, not per-unit) into a position that already held
 * `oldQty` units at `oldAvgMinor` per unit.
 *
 * Pure and exported so it is unit-testable without a database — the arithmetic
 * itself is where a costing bug would hide, not the plumbing around it.
 *
 * `oldAvgMinor: null` means the item has never had a cost basis (nothing has
 * ever been received into it with a known cost) — the new average is simply
 * this receipt's own unit cost.
 */
export function nextAverageCost(
  oldQty: number,
  oldAvgMinor: bigint | null,
  inQty: number,
  inCostMinor: bigint,
): bigint {
  if (inQty <= 0) throw new RangeError(`nextAverageCost: inQty must be positive, got ${inQty}`);
  const oldTotal = oldAvgMinor === null ? 0n : oldAvgMinor * BigInt(Math.max(oldQty, 0));
  const newTotalQty = BigInt(Math.max(oldQty, 0) + inQty);
  return roundHalfEven(oldTotal + inCostMinor, newTotalQty);
}

/**
 * Records a receipt: updates the item's running average cost and writes a
 * costed 'in' movement. Call inside the transaction that also increments
 * `inventory_items.quantity` — this does not touch quantity itself, so the
 * caller's own increment and this cost update must land together or the two
 * numbers drift apart.
 *
 * `totalCostMinor` is the TOTAL cost of the receipt (quantity x unit cost),
 * matching `inventory_movements.cost_minor`'s own meaning.
 */
export async function recordCostedReceipt(
  tx: Pick<DbTx, 'select' | 'update' | 'insert' | 'rollback'>,
  args: {
    orgId: string;
    itemId: string;
    quantity: number;
    totalCostMinor: bigint;
    note: string;
  },
): Promise<void> {
  // FOR UPDATE: two receipts landing on the same item in the same instant must
  // not both read the same starting average and both average against it — the
  // second would silently discard the first's contribution, the exact lost-
  // update shape fixed elsewhere in this codebase (customers.linkOrder,
  // inventory.adjust). Locking the row serialises them instead.
  const [item] = await tx
    .select({ quantity: inventoryItems.quantity, averageCostMinor: inventoryItems.averageCostMinor })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, args.itemId), eq(inventoryItems.orgId, args.orgId)))
    .for('update')
    .limit(1);

  // The caller is expected to have already resolved the item; if it vanished
  // between that read and this one, there is nothing to cost — the caller's
  // own quantity-increment write will independently fail to find the row.
  if (!item) return;

  const newAverage = nextAverageCost(item.quantity, item.averageCostMinor, args.quantity, args.totalCostMinor);

  // Quantity is NOT touched here — the caller owns that increment (it already
  // has its own guarded UPDATE for it). This must run BEFORE that increment:
  // `item.quantity` above has to be the count as it stood before this receipt,
  // or the average is computed against a total that already includes the units
  // being priced.
  await tx
    .update(inventoryItems)
    .set({ averageCostMinor: newAverage, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, args.itemId), eq(inventoryItems.orgId, args.orgId)));

  await tx.insert(inventoryMovements).values({
    orgId: args.orgId,
    itemId: args.itemId,
    type: 'in',
    quantity: args.quantity,
    costMinor: args.totalCostMinor,
    note: args.note,
  });
}
