-- 0085: order_import_candidates — the staging row between a provider delivery
-- and a real order (OR-03).
--
-- A candidate is one provider order, hydrated (OR-05) and normalised into the
-- CandidateOrder shape (OR-02), waiting to be validated and promoted. Nothing
-- here is an order yet: no stock moves, nothing is posted. Promotion into
-- orders/order_items happens in OR-10 and stamps promoted_order_id.
--
--   status       hydrating   created, provider order still being fetched
--                blocked     hydrated but a blocker stops promotion — these
--                            rows are the "Import blocked" queue
--                promoted    became an order (promoted_order_id is set)
--                superseded  a newer source_updated_at version replaced it
--                discarded   deliberately dropped (test order, duplicate, ...)
--   normalized   the CandidateOrder jsonb (null until hydration finishes).
--   sections     per-section fetch status, e.g. {"buyer": {"status": "loaded"}}.
--   blockers     [{code, section, detail, nextAction}].
--
-- One row per provider order VERSION: UNIQUE (provider, connection_id,
-- source_order_id, source_updated_at). A re-delivery of the same version
-- upserts onto it; an edit in the provider (new updated_at) is a new row and
-- the old one is marked superseded. As with inbound_deliveries, a NULL
-- connection_id is never equal to another, so rows without a connection are
-- not deduplicated by this key.
--
-- connection_id still references shopify_connections(id), like
-- inbound_deliveries. CX-12 repoints it to connections(id, org_id).
--
-- promoted_order_id is a composite same-org FK onto orders(id, org_id)
-- (orders_id_org_id_key, 0077), so a candidate cannot point at another org's
-- order.

CREATE TABLE "order_import_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "connection_id" uuid REFERENCES "shopify_connections"("id"),
  "provider" text NOT NULL DEFAULT 'shopify',
  "source_order_id" text NOT NULL,
  "source_order_number" text,
  "source_updated_at" timestamptz NOT NULL,
  "inbound_delivery_id" uuid REFERENCES "inbound_deliveries"("id"),
  "status" text NOT NULL DEFAULT 'hydrating',
  "normalized" jsonb,
  "sections" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "blockers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "line_count" integer,
  "api_version" text,
  "connector_version" text,
  "promoted_order_id" uuid,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_import_candidates_promoted_order_same_org_fk"
    FOREIGN KEY ("promoted_order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  CONSTRAINT "order_import_candidates_provider_check"
    CHECK ("provider" ~ '^[a-z][a-z0-9_]{1,40}$'),
  CONSTRAINT "order_import_candidates_status_check"
    CHECK ("status" IN ('hydrating', 'blocked', 'promoted', 'superseded', 'discarded')),
  CONSTRAINT "order_import_candidates_sections_check"
    CHECK (jsonb_typeof("sections") = 'object'),
  CONSTRAINT "order_import_candidates_blockers_check"
    CHECK (jsonb_typeof("blockers") = 'array'),
  CONSTRAINT "order_import_candidates_line_count_check"
    CHECK ("line_count" IS NULL OR "line_count" >= 0),
  CONSTRAINT "order_import_candidates_promoted_has_order_check"
    CHECK ("status" <> 'promoted' OR "promoted_order_id" IS NOT NULL)
);--> statement-breakpoint

CREATE UNIQUE INDEX "order_import_candidates_source_version_idx"
  ON "order_import_candidates" ("provider", "connection_id", "source_order_id", "source_updated_at");--> statement-breakpoint
CREATE INDEX "order_import_candidates_org_status_updated_idx"
  ON "order_import_candidates" ("org_id", "status", "updated_at");--> statement-breakpoint
CREATE INDEX "order_import_candidates_inbound_delivery_idx"
  ON "order_import_candidates" ("inbound_delivery_id");--> statement-breakpoint

COMMENT ON COLUMN "order_import_candidates"."connection_id" IS
  'Still REFERENCES shopify_connections(id); CX-12 repoints it to connections(id, org_id).';--> statement-breakpoint

-- RLS: same NULLIF shape as 0050/0052/0083/0084.
ALTER TABLE "order_import_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_import_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "order_import_candidates_tenant_isolation" ON "order_import_candidates"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "order_import_candidates" TO irth_app;
