-- Make tenant isolation canonical: org_id becomes uuid everywhere, with a
-- foreign key to organizations.
--
-- WHY THIS MATTERS
--
-- 21 tables stored org_id as uuid; 15 stored it as text. `organizations.id` is
-- uuid, so the text columns compared bytes where the uuid columns compare
-- canonical values. A uuid has several equal textual forms — hyphenated,
-- unhyphenated, upper or lower case — and text equality treats them as
-- different orgs.
--
-- Demonstrated on a throwaway branch before writing this: inserting one
-- inventory row whose org_id was the unhyphenated form of the SAME org made it
-- invisible to the application. `where org_id = '1111...-...'` returned 6 rows
-- while `where org_id::uuid = ...::uuid` returned 7. The row existed, belonged
-- to that org, and was absent from every list, count and export.
--
-- A text column also cannot carry a foreign key to a uuid primary key, which
-- is why all 15 of these tables had no FK to organizations at all: no cascade,
-- and nothing preventing rows pointing at an org that never existed.
--
-- BEFORE RUNNING ON DATA YOU CARE ABOUT
--
-- The conversion is deliberately strict — `USING org_id::uuid` aborts the whole
-- migration if any row holds a value that is not a uuid. That is the intended
-- behaviour: silently dropping or nulling such a row would be losing a tenant's
-- data. To find them first:
--
--   SELECT 'inventory_items' t, org_id FROM inventory_items
--   WHERE org_id !~* '^\{?[0-9a-f]{8}-?([0-9a-f]{4}-?){3}[0-9a-f]{12}\}?$'
--   UNION ALL ... (repeat per table below)
--
-- Rows already stored in a non-canonical form convert cleanly; ::uuid
-- normalises them, which also merges the split silently created earlier.

ALTER TABLE "campaigns"                ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "customer_segments"        ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "customer_segment_members" ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "gift_cards"               ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "gift_card_transactions"   ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "inventory_items"          ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements"      ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "org_settings"             ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "outbox_events"            ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "price_lists"              ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "price_list_items"         ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "shipping_zones"           ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "shipping_rates"           ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "stocktaking_sessions"     ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "stocktaking_items"        ALTER COLUMN "org_id" TYPE uuid USING "org_id"::uuid;--> statement-breakpoint

-- Now that the types match, the reference the text columns could never carry.
-- Guarded so a re-run is a no-op rather than an error.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campaigns','customer_segments','customer_segment_members','gift_cards',
    'gift_card_transactions','inventory_items','inventory_movements',
    'org_settings','outbox_events','price_lists','price_list_items',
    'shipping_zones','shipping_rates','stocktaking_sessions','stocktaking_items'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE',
        t, t || '_org_id_organizations_id_fk'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
--> statement-breakpoint

-- Every tenant-scoped query filters on org_id, so it should be indexed. Most of
-- these had no index on it either.
CREATE INDEX IF NOT EXISTS "campaigns_org_id_idx"                ON "campaigns" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_segments_org_id_idx"        ON "customer_segments" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_segment_members_org_id_idx" ON "customer_segment_members" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_cards_org_id_idx"               ON "gift_cards" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_card_transactions_org_id_idx"   ON "gift_card_transactions" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_org_id_idx"          ON "inventory_items" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_org_id_idx"      ON "inventory_movements" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_settings_org_id_idx"             ON "org_settings" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_org_id_idx"            ON "outbox_events" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_lists_org_id_idx"              ON "price_lists" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_list_items_org_id_idx"         ON "price_list_items" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipping_zones_org_id_idx"           ON "shipping_zones" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipping_rates_org_id_idx"           ON "shipping_rates" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stocktaking_sessions_org_id_idx"     ON "stocktaking_sessions" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stocktaking_items_org_id_idx"        ON "stocktaking_items" ("org_id");
