-- 0069: dimension tables (legal_entities, brands, channels, warehouses) — DM-01.
--
-- The org stays the single RLS root (the IRTH group). Under it:
--   legal_entities  accounting boundary (functional currency, document prefix,
--                   recognition point, tax registration)
--   brands          analytic dimension only; replaces the one-value `brand`
--                   enum ('irth') that products/organizations stamped
--   channels        where an order comes from: brand + selling entity + kind
--   warehouses      physical location ONLY. Legal ownership of stock is a
--                   column on the stock position (later), never the warehouse.
-- Every table carries UNIQUE (id, org_id) so children can use the composite
-- (x_id, org_id) FK from 0030/0038: a channel whose brand or entity belongs to
-- another org is unrepresentable.
--
-- Defaults: every org — existing ones via the backfill below, new ones via the
-- AFTER INSERT trigger — gets entity IRTH (EGP), brand IRTH, warehouse MAIN and
-- channel shopify-main, and organizations.stock_owner_entity_id points at the
-- entity. A trigger rather than app code because orgs are created from several
-- places (platformAdmin.createOrg, integration tests, future onboarding); one
-- database rule covers all of them. stock_owner_entity_id stays NULLABLE: the
-- AFTER INSERT row exists for a moment without it, and the trigger always sets
-- it in the same statement.
--
-- The seed function is SECURITY DEFINER (runs as the migration owner, which
-- holds BYPASSRLS) so it works no matter which role inserts the org — the new
-- org's id is not yet in app.org_id, so an irth_app session could not write
-- these rows under RLS itself.

CREATE TYPE "legal_entity_kind" AS ENUM ('operating', 'elimination');--> statement-breakpoint
CREATE TYPE "recognition_point" AS ENUM ('delivered', 'shipped', 'paid', 'invoiced');--> statement-breakpoint
CREATE TYPE "channel_kind" AS ENUM ('shopify', 'woocommerce', 'pos', 'whatsapp', 'b2b', 'marketplace');--> statement-breakpoint

CREATE TABLE "legal_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "kind" "legal_entity_kind" NOT NULL DEFAULT 'operating',
  "functional_currency" char(3) NOT NULL DEFAULT 'EGP',
  "document_prefix" text NOT NULL,
  "recognition_point" "recognition_point" NOT NULL DEFAULT 'delivered',
  "tax_registration_no" text,
  "country" char(2) NOT NULL DEFAULT 'EG',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "legal_entities_org_code_uq" UNIQUE ("org_id", "code"),
  CONSTRAINT "legal_entities_id_org_uq" UNIQUE ("id", "org_id")
);--> statement-breakpoint

CREATE TABLE "brands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "brands_org_code_uq" UNIQUE ("org_id", "code"),
  CONSTRAINT "brands_id_org_uq" UNIQUE ("id", "org_id")
);--> statement-breakpoint

CREATE TABLE "warehouses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "address" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "warehouses_org_code_uq" UNIQUE ("org_id", "code"),
  CONSTRAINT "warehouses_id_org_uq" UNIQUE ("id", "org_id")
);--> statement-breakpoint

CREATE TABLE "channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "kind" "channel_kind" NOT NULL,
  "brand_id" uuid NOT NULL,
  "selling_entity_id" uuid NOT NULL,
  "default_warehouse_id" uuid,
  "currency" char(3) NOT NULL DEFAULT 'EGP',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "channels_org_code_uq" UNIQUE ("org_id", "code"),
  CONSTRAINT "channels_id_org_uq" UNIQUE ("id", "org_id"),
  CONSTRAINT "channels_brand_same_org_fk" FOREIGN KEY ("brand_id", "org_id") REFERENCES "brands"("id", "org_id"),
  CONSTRAINT "channels_entity_same_org_fk" FOREIGN KEY ("selling_entity_id", "org_id") REFERENCES "legal_entities"("id", "org_id"),
  CONSTRAINT "channels_warehouse_same_org_fk" FOREIGN KEY ("default_warehouse_id", "org_id") REFERENCES "warehouses"("id", "org_id")
);--> statement-breakpoint

-- RLS: same NULLIF policy shape as 0038, explicit grants.
ALTER TABLE "legal_entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "legal_entities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "legal_entities_tenant_isolation" ON "legal_entities"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "brands_tenant_isolation" ON "brands"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "warehouses_tenant_isolation" ON "warehouses"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "channels_tenant_isolation" ON "channels"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "legal_entities", "brands", "warehouses", "channels" TO "irth_app";--> statement-breakpoint

ALTER TABLE "organizations" ADD COLUMN "presentation_currency" char(3) NOT NULL DEFAULT 'EGP';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stock_owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stock_owner_same_org_fk"
  FOREIGN KEY ("stock_owner_entity_id", "id") REFERENCES "legal_entities"("id", "org_id");--> statement-breakpoint

CREATE FUNCTION "seed_org_dimensions"(p_org_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity uuid;
  v_brand uuid;
  v_warehouse uuid;
BEGIN
  INSERT INTO legal_entities (org_id, code, name, name_ar, document_prefix)
    VALUES (p_org_id, 'IRTH', 'IRTH', 'إرث', 'IRT') RETURNING id INTO v_entity;
  INSERT INTO brands (org_id, code, name, name_ar)
    VALUES (p_org_id, 'IRTH', 'IRTH', 'إرث') RETURNING id INTO v_brand;
  INSERT INTO warehouses (org_id, code, name)
    VALUES (p_org_id, 'MAIN', 'Main warehouse') RETURNING id INTO v_warehouse;
  INSERT INTO channels (org_id, code, name, kind, brand_id, selling_entity_id, default_warehouse_id)
    VALUES (p_org_id, 'shopify-main', 'Shopify', 'shopify', v_brand, v_entity, v_warehouse);
  UPDATE organizations SET stock_owner_entity_id = v_entity WHERE id = p_org_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "seed_org_dimensions"(uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION "organizations_seed_dimensions"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM seed_org_dimensions(NEW.id);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "organizations_seed_dimensions"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "organizations_seed_dimensions"
  AFTER INSERT ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION "organizations_seed_dimensions"();--> statement-breakpoint

-- Backfill every existing org.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM organizations WHERE stock_owner_entity_id IS NULL LOOP
    PERFORM seed_org_dimensions(r.id);
  END LOOP;
END $$;--> statement-breakpoint

-- products.brand (enum) -> products.brand_id (FK, nullable: shared
-- ingredients/packaging carry no brand). Every existing product was 'irth'.
ALTER TABLE "products" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_same_org_fk"
  FOREIGN KEY ("brand_id", "org_id") REFERENCES "brands"("id", "org_id");--> statement-breakpoint
UPDATE "products" p SET "brand_id" = b."id"
  FROM "brands" b WHERE b."org_id" = p."org_id" AND b."code" = 'IRTH';--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "brand";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "brand";--> statement-breakpoint
DROP TYPE "brand";
