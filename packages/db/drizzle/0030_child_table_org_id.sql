-- Give the two child tables their own org_id, ahead of RLS.
--
-- `purchase_order_items` and `return_items` were the only domain tables without
-- one. They are isolated today purely by their parent: you can only reach a
-- line through the purchase order or return that owns it.
--
-- That is enough for a WHERE clause an author remembers to write, but not for a
-- row-level policy. A policy that has to join to the parent to decide
-- visibility is a policy whose correctness depends on the planner, and it
-- cannot be expressed as the same simple `org_id = current_setting(...)`
-- predicate every other table uses. One shape for all tables is worth a
-- denormalised column.
--
-- Backfilled from the parent, then made NOT NULL, so the column can never be
-- silently absent the way product_variants.org_id was.

ALTER TABLE "purchase_order_items" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "purchase_order_items" i
   SET "org_id" = po."org_id"
  FROM "purchase_orders" po
 WHERE po."id" = i."po_id";--> statement-breakpoint
-- Any row whose parent vanished is unreachable and unattributable; there is no
-- correct org to assign it, so it goes rather than becoming a NULL that blocks
-- the NOT NULL below. `public` on production is empty, so in practice this
-- deletes nothing.
DELETE FROM "purchase_order_items" WHERE "org_id" IS NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_items_org_id_idx" ON "purchase_order_items" ("org_id");--> statement-breakpoint

ALTER TABLE "return_items" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "return_items" ri
   SET "org_id" = r."org_id"
  FROM "order_returns" r
 WHERE r."id" = ri."return_id";--> statement-breakpoint
DELETE FROM "return_items" WHERE "org_id" IS NULL;--> statement-breakpoint
ALTER TABLE "return_items" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "return_items_org_id_idx" ON "return_items" ("org_id");--> statement-breakpoint

-- A line must belong to the same org as its parent. Without this the new column
-- is just a second place for the truth to live, free to drift from the first —
-- and a drifted org_id under RLS means a row visible to the wrong tenant.
--
-- Enforced with a COMPOSITE foreign key, not a CHECK: a CHECK constraint in
-- Postgres cannot contain a subquery, so `CHECK (org_id = (SELECT ...))` is
-- rejected outright. Pointing (parent_id, org_id) at the parent's (id, org_id)
-- makes a mismatched pair unrepresentable, and the database enforces it on
-- every write with no trigger to maintain.
--
-- The parent needs an explicit UNIQUE on (id, org_id) to be referenced that
-- way, even though `id` alone is already the primary key.
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_po_org_fk"
  FOREIGN KEY ("po_id", "org_id")
  REFERENCES "purchase_orders" ("id", "org_id") ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "order_returns"
  ADD CONSTRAINT "order_returns_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_return_org_fk"
  FOREIGN KEY ("return_id", "org_id")
  REFERENCES "order_returns" ("id", "org_id") ON DELETE CASCADE;
