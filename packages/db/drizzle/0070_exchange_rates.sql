-- 0070: exchange_rates — the ledger's FX rate source (DM-02).
--
-- One row = 1 unit of `base` equals rate_num/rate_den units of `quote` on
-- `as_of`. The rate is an exact bigint fraction so conversion never passes
-- through a float (packages/domain convertMinor rounds once, half-even).
-- lookupRate() takes the latest row with as_of <= the transaction date.
-- `approved_by` records who entered or approved a manual rate.

CREATE TYPE "fx_rate_source" AS ENUM ('ecb', 'cbe', 'manual');--> statement-breakpoint

CREATE TABLE "exchange_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "base" char(3) NOT NULL,
  "quote" char(3) NOT NULL,
  "rate_num" bigint NOT NULL,
  "rate_den" bigint NOT NULL,
  "as_of" date NOT NULL,
  "source" "fx_rate_source" NOT NULL,
  "approved_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "exchange_rates_org_pair_date_uq" UNIQUE ("org_id", "base", "quote", "as_of"),
  CONSTRAINT "exchange_rates_positive_ck" CHECK ("rate_num" > 0 AND "rate_den" > 0),
  CONSTRAINT "exchange_rates_distinct_pair_ck" CHECK ("base" <> "quote")
);--> statement-breakpoint

ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exchange_rates_tenant_isolation" ON "exchange_rates"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "exchange_rates" TO "irth_app";
