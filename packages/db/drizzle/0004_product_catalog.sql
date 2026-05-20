CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp DEFAULT now()
);

ALTER TABLE "products" ADD COLUMN "category_id" uuid;
ALTER TABLE "products" ADD COLUMN "name_ar" text;
ALTER TABLE "products" ADD COLUMN "sku" text;
ALTER TABLE "products" ADD COLUMN "description_ar" text;
ALTER TABLE "products" ADD COLUMN "price" numeric(12, 2);
ALTER TABLE "products" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;
ALTER TABLE "products" ADD COLUMN "stock" integer DEFAULT 0 NOT NULL;
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "products" ADD COLUMN "images" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "products" ALTER COLUMN "name" SET DATA TYPE text;
ALTER TABLE "products" DROP COLUMN IF EXISTS "is_active";

UPDATE "products" SET "sku" = "id"::text, "price" = 0 WHERE "sku" IS NULL;

ALTER TABLE "products" ALTER COLUMN "sku" SET NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_sku_unique" UNIQUE("sku");
ALTER TABLE "products" ALTER COLUMN "price" SET NOT NULL;

ALTER TABLE "product_variants" ADD COLUMN "name" text;
ALTER TABLE "product_variants" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb;

UPDATE "product_variants" SET "name" = "sku" WHERE "name" IS NULL;

ALTER TABLE "product_variants" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "product_variants" ALTER COLUMN "sku" SET DATA TYPE text;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_sku_unique" UNIQUE("sku");

DO $$ BEGIN
 ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
