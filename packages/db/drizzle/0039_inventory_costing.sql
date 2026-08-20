-- Weighted-average costing: the missing piece that made COGS underivable.
--
-- Nothing in this schema has ever recorded what a unit of stock COST — only
-- what it SELLS for (product_variants.price_minor) and, separately, what a
-- supplier line was ordered at (purchase_order_items.unit_cost_minor, which
-- nothing propagates past the purchase order itself). Every inventory
-- movement is silent about cost, so at the moment revenue is recognised there
-- is no figure to debit COGS with — finance.pnl could only ever report gross
-- sales, never a margin.
--
-- WHY WEIGHTED-AVERAGE, NOT FIFO/LIFO/LOT TRACKING
--
-- Those need to know WHICH specific units of a variant left the warehouse,
-- which needs lot or batch identity somewhere in the stock model. Nothing here
-- has that, and building it is a much larger schema change than "the ledger
-- needs a cost figure to post." Weighted-average needs only one running number
-- per inventory item, updated on every receipt — the smallest model that
-- makes COGS a real, derivable figure rather than an estimate with no basis at
-- all.
--
-- "average_cost_minor" is added to inventory_items — one running per-unit
-- figure. "cost_minor" is added to inventory_movements and order_items — the
-- cost BASIS captured AT THE MOMENT of that specific movement, not recomputed
-- later. The average keeps moving after a movement posts; the movement's own
-- recorded cost must not, or COGS for an order would silently change value
-- depending on when someone happened to query it.

ALTER TABLE "inventory_items" ADD COLUMN "average_cost_minor" bigint;--> statement-breakpoint
COMMENT ON COLUMN "inventory_items"."average_cost_minor" IS
  'Weighted-average cost per unit, in minor units. NULL until the first receipt with a known unit cost updates it — an item that has only ever been manually adjusted, never purchased, has no cost basis to average.';--> statement-breakpoint

-- Total cost of the specific movement (unit cost x quantity at the time it
-- happened), not a per-unit figure — this is what COGS/inventory-value
-- postings need directly, without re-deriving a multiplication at every read.
ALTER TABLE "inventory_movements" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
COMMENT ON COLUMN "inventory_movements"."cost_minor" IS
  'Total cost of this movement (quantity x unit cost at the time), in minor units. NULL for movements with no known cost basis (e.g. a manual adjustment with no purchase behind it).';--> statement-breakpoint

-- The cost basis for this order line, captured when stock was decremented for
-- it (apps/api order creation) rather than reconstructed later by joining back
-- through inventory_movements' free-text note field. finance's order-delivered
-- posting sums this column directly.
ALTER TABLE "order_items" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
COMMENT ON COLUMN "order_items"."cost_minor" IS
  'Cost basis for this line at the moment stock was decremented, in minor units. NULL if the item had no cost basis yet (never received with a known unit cost) — COGS for that line is then unknown, not zero, and is reported as a gap rather than silently treated as free stock.';
