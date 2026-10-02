-- 0087: customer identities, per-brand relationships, merge log (DM-06, additive half).
--
-- A customer becomes the group-level person; the ways we recognise them live in
-- customer_identities, scoped to the connection they came from:
--
--   kind         shopify | woocommerce | email | phone | whatsapp | instagram
--   external_id  the provider's id (Shopify GID), or the normalised address
--                (email lower(trim()), phone as stored)
--   verified     true when the provider vouches for it (a Shopify customer id),
--                false for a typed-in email/phone
--
-- UNIQUE NULLS NOT DISTINCT (org_id, kind, connection_id, external_id): unlike
-- inbound_deliveries/order_import_candidates, a NULL connection_id IS deduped
-- here, so an email or phone identity with no connection exists once per org.
--
-- customer_brand_relationships carries per-brand consent and order stats;
-- customer_merges is the append-only log of explicit merges (same guard as
-- audit_log in 0082: REVOKE UPDATE, DELETE from irth_app plus a row trigger
-- that refuses the owner role too).
--
-- Nothing is dropped from customers yet: shopify_customer_id,
-- marketing_consent, total_orders and total_spent_minor move in the
-- destructive half of DM-06. findOrCreateCustomer keeps its behaviour and
-- additionally records identities.
--
-- Every child uses a composite same-org FK, so customers gains UNIQUE (id, org_id).

ALTER TABLE "customers" ADD CONSTRAINT "customers_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint

CREATE TABLE "customer_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "customer_id" uuid NOT NULL,
  "connection_id" uuid REFERENCES "shopify_connections"("id"),
  "kind" text NOT NULL,
  "external_id" text NOT NULL,
  "verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "customer_identities_customer_same_org_fk"
    FOREIGN KEY ("customer_id", "org_id") REFERENCES "customers"("id", "org_id"),
  CONSTRAINT "customer_identities_kind_check"
    CHECK ("kind" IN ('shopify', 'woocommerce', 'email', 'phone', 'whatsapp', 'instagram')),
  CONSTRAINT "customer_identities_external_id_check"
    CHECK (length(btrim("external_id")) > 0),
  CONSTRAINT "customer_identities_key_uq"
    UNIQUE NULLS NOT DISTINCT ("org_id", "kind", "connection_id", "external_id")
);--> statement-breakpoint

CREATE INDEX "customer_identities_customer_idx" ON "customer_identities" ("customer_id");--> statement-breakpoint

COMMENT ON COLUMN "customer_identities"."connection_id" IS
  'Still REFERENCES shopify_connections(id); CX-12 repoints it to connections(id, org_id).';--> statement-breakpoint

CREATE TABLE "customer_brand_relationships" (
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "customer_id" uuid NOT NULL,
  "brand_id" uuid NOT NULL,
  "marketing_consent" boolean NOT NULL DEFAULT false,
  "consent_source" text,
  "consent_at" timestamptz,
  "first_order_at" timestamptz,
  "last_order_at" timestamptz,
  "order_count" integer NOT NULL DEFAULT 0,
  "spent_minor" bigint NOT NULL DEFAULT 0,
  "currency" char(3),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("customer_id", "brand_id"),
  CONSTRAINT "customer_brand_relationships_customer_same_org_fk"
    FOREIGN KEY ("customer_id", "org_id") REFERENCES "customers"("id", "org_id"),
  CONSTRAINT "customer_brand_relationships_brand_same_org_fk"
    FOREIGN KEY ("brand_id", "org_id") REFERENCES "brands"("id", "org_id"),
  CONSTRAINT "customer_brand_relationships_order_count_check" CHECK ("order_count" >= 0)
);--> statement-breakpoint

CREATE INDEX "customer_brand_relationships_org_brand_idx"
  ON "customer_brand_relationships" ("org_id", "brand_id");--> statement-breakpoint

CREATE TABLE "customer_merges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "winner_id" uuid NOT NULL,
  "loser_id" uuid NOT NULL,
  "merged_by" text,
  "merged_at" timestamptz NOT NULL DEFAULT now(),
  "reason" text,
  CONSTRAINT "customer_merges_winner_same_org_fk"
    FOREIGN KEY ("winner_id", "org_id") REFERENCES "customers"("id", "org_id"),
  CONSTRAINT "customer_merges_loser_same_org_fk"
    FOREIGN KEY ("loser_id", "org_id") REFERENCES "customers"("id", "org_id"),
  CONSTRAINT "customer_merges_distinct_check" CHECK ("winner_id" <> "loser_id")
);--> statement-breakpoint

CREATE INDEX "customer_merges_org_merged_at_idx" ON "customer_merges" ("org_id", "merged_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "customer_merges_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'customer_merges is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "customer_merges_immutable" BEFORE UPDATE OR DELETE ON "customer_merges"
  FOR EACH ROW EXECUTE FUNCTION "customer_merges_immutable"();--> statement-breakpoint

-- RLS: same NULLIF shape as 0083/0085.
ALTER TABLE "customer_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "customer_identities_tenant_isolation" ON "customer_identities"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "customer_brand_relationships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_brand_relationships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "customer_brand_relationships_tenant_isolation" ON "customer_brand_relationships"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "customer_merges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_merges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "customer_merges_tenant_isolation" ON "customer_merges"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_identities", "customer_brand_relationships" TO "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "customer_merges" TO "irth_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "customer_merges" FROM "irth_app";--> statement-breakpoint

-- Backfill. Shopify ids become verified identities on the org's one
-- shopify_connections row (NULL when the org has zero or several — the
-- webhook records the connection-scoped identity on the next delivery).
INSERT INTO "customer_identities" ("org_id", "customer_id", "connection_id", "kind", "external_id", "verified")
SELECT c."org_id", c."id", one."connection_id", 'shopify', btrim(c."shopify_customer_id"), true
  FROM "customers" c
  LEFT JOIN (
    SELECT "org_id", (array_agg("id"))[1] AS "connection_id"
      FROM "shopify_connections"
     GROUP BY "org_id"
    HAVING count(*) = 1
  ) one ON one."org_id" = c."org_id"
 WHERE c."shopify_customer_id" IS NOT NULL AND btrim(c."shopify_customer_id") <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Emails as unverified, connection-less identities. Two customers sharing an
-- email in one org: the older keeps the identity, the other gets none here and
-- is never merged here — merging stays an explicit operation.
INSERT INTO "customer_identities" ("org_id", "customer_id", "connection_id", "kind", "external_id", "verified")
SELECT c."org_id", c."id", NULL, 'email', lower(btrim(c."email")), false
  FROM "customers" c
 WHERE c."email" IS NOT NULL AND btrim(c."email") <> ''
 ORDER BY c."created_at" NULLS LAST, c."id"
ON CONFLICT DO NOTHING;
