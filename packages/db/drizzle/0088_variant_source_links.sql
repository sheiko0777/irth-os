-- 0088: variant_source_links — which provider variant is which local variant
-- (OR-07, additive half).
--
-- One row per (provider, connection, source_variant_id). Two connections may
-- link the same SKU string to two different local variants; nothing here keys
-- on SKU. A link is never created by SKU equality — only by an explicit
-- operator action (orderImport.mapLine / classifyCustomLine) or this backfill
-- of ids Shopify itself handed back on product push.
--
--   line_kind  mapped           the source variant is a stocked local variant
--              custom_nonstock  a custom/service line: no local variant, no stock
--   state      active           in use
--              pending_custom   classified but not yet resolved — no variant yet
--              deleted          the source variant no longer exists upstream
--
-- variant_id is NULL exactly when the line is custom_nonstock or the link is
-- pending_custom (variant_source_links_variant_presence_check), and is a
-- composite same-org FK onto product_variants(id, org_id), so a link cannot
-- point at another org's variant. product_variants gains UNIQUE (id, org_id).
--
-- Nothing is dropped yet: product_variants.shopify_variant_id and
-- shopify_inventory_item_id (and their unique indexes) go in the follow-up
-- once the webhook/outbox readers move to this table.

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint

CREATE TABLE "variant_source_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "connection_id" uuid NOT NULL REFERENCES "shopify_connections"("id"),
  "provider" text NOT NULL DEFAULT 'shopify',
  "source_variant_id" text NOT NULL,
  "source_product_id" text,
  "source_inventory_item_id" text,
  "variant_id" uuid,
  "line_kind" text NOT NULL DEFAULT 'mapped',
  "state" text NOT NULL DEFAULT 'active',
  "sku_snapshot" text,
  "title_snapshot" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "variant_source_links_variant_same_org_fk"
    FOREIGN KEY ("variant_id", "org_id") REFERENCES "product_variants"("id", "org_id"),
  CONSTRAINT "variant_source_links_provider_check"
    CHECK ("provider" ~ '^[a-z][a-z0-9_]{1,40}$'),
  CONSTRAINT "variant_source_links_source_variant_id_check"
    CHECK (length(btrim("source_variant_id")) > 0),
  CONSTRAINT "variant_source_links_line_kind_check"
    CHECK ("line_kind" IN ('mapped', 'custom_nonstock')),
  CONSTRAINT "variant_source_links_state_check"
    CHECK ("state" IN ('active', 'pending_custom', 'deleted')),
  CONSTRAINT "variant_source_links_variant_presence_check"
    CHECK (("variant_id" IS NULL) = ("line_kind" = 'custom_nonstock' OR "state" = 'pending_custom')),
  CONSTRAINT "variant_source_links_source_key"
    UNIQUE ("provider", "connection_id", "source_variant_id")
);--> statement-breakpoint

CREATE INDEX "variant_source_links_org_variant_idx" ON "variant_source_links" ("org_id", "variant_id");--> statement-breakpoint
CREATE INDEX "variant_source_links_inventory_item_idx"
  ON "variant_source_links" ("connection_id", "source_inventory_item_id");--> statement-breakpoint

COMMENT ON COLUMN "variant_source_links"."connection_id" IS
  'Still REFERENCES shopify_connections(id); CX-12 repoints it to connections(id, org_id).';--> statement-breakpoint

-- RLS: same NULLIF shape as 0083/0085/0087.
ALTER TABLE "variant_source_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "variant_source_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "variant_source_links_tenant_isolation" ON "variant_source_links"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "variant_source_links" TO "irth_app";--> statement-breakpoint

-- Backfill (idempotent: ON CONFLICT DO NOTHING). Every variant Shopify gave an
-- id to is linked on its org's one shopify_connections row
-- (shopify_connections_org_id_idx, 0047, allows at most one). An org with no
-- connection has nothing to link to and is skipped — the NOTICE below counts
-- those variants; they get a link the next time they are pushed or mapped.
INSERT INTO "variant_source_links"
  ("org_id", "connection_id", "provider", "source_variant_id", "source_product_id",
   "source_inventory_item_id", "variant_id", "sku_snapshot", "title_snapshot")
SELECT v."org_id", sc."id", 'shopify', btrim(v."shopify_variant_id"), p."shopify_product_id",
       NULLIF(btrim(v."shopify_inventory_item_id"), ''), v."id", v."sku",
       concat_ws(' / ', p."name", v."name")
  FROM "product_variants" v
  JOIN "shopify_connections" sc ON sc."org_id" = v."org_id"
  LEFT JOIN "products" p ON p."id" = v."product_id" AND p."org_id" = v."org_id"
 WHERE v."shopify_variant_id" IS NOT NULL AND btrim(v."shopify_variant_id") <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

DO $$
DECLARE skipped integer;
BEGIN
  SELECT count(*) INTO skipped
    FROM "product_variants" v
   WHERE v."shopify_variant_id" IS NOT NULL AND btrim(v."shopify_variant_id") <> ''
     AND NOT EXISTS (SELECT 1 FROM "shopify_connections" sc WHERE sc."org_id" = v."org_id");
  IF skipped > 0 THEN
    RAISE NOTICE '0088: % variant(s) with a shopify_variant_id belong to orgs with no shopify connection; not linked', skipped;
  END IF;
END $$;
