-- 0084: shopify_webhook_deliveries -> inbound_deliveries, the one durable inbox (OR-01).
--
-- The Shopify webhook route already has a durable inbox (claimDelivery /
-- markDeliveryProcessed in apps/api/src/routes/webhooks/shopify.ts), but it
-- only keeps the PARSED body as jsonb. jsonb normalises key order and
-- whitespace, so the bytes Shopify signed are gone: the HMAC cannot be
-- re-verified, a payload cannot be replayed byte-for-byte, and there is no
-- record of the API version or headers a delivery arrived with. This file
-- generalises the table instead of adding a second inbox:
--
--   provider        'shopify' today; any connector later (CX).
--   delivery_key    was webhook_id (X-Shopify-Webhook-Id). Dedup is now
--                   UNIQUE (provider, connection_id, delivery_key).
--   raw_body        the exact request bytes — the source of truth from here
--                   on. payload (jsonb) stays, nullable, for continuity.
--   headers         provider headers only (the route keeps x-shopify-*);
--                   never Authorization or cookies.
--   body_sha256     hex sha256 of raw_body.
--   api_version / event_id / triggered_at   from the provider's headers.
--   attempts        incremented on every failed processing attempt.
--   retention_until 24 months after receipt. A column default cannot read
--                   received_at, so it is now() + 24 months — identical at
--                   insert time, since received_at also defaults to now().
--
-- RENAMED IN PLACE, not recreated, so existing rows, the RLS flags, the
-- grants and the FKs survive. Rows that predate this file get raw_body
-- reconstructed from payload::text: that is NOT the original signed bytes
-- (jsonb already threw those away) and is the best that can be recovered.
--
-- connection_id still references shopify_connections(id). CX-12 moves Shopify
-- onto connections and repoints it to the composite connections(id, org_id).
--
-- Applies on a fresh database (0047 -> ... -> 0084) and on one with rows.

ALTER TABLE shopify_webhook_deliveries RENAME TO inbound_deliveries;--> statement-breakpoint
ALTER TABLE inbound_deliveries RENAME COLUMN webhook_id TO delivery_key;--> statement-breakpoint

-- Constraint names follow the table. Postgres generated these from 0047's
-- inline PRIMARY KEY / REFERENCES; guarded so an unexpected name is skipped
-- rather than aborting the file (CX-12 drops the connection FK by name).
DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['shopify_webhook_deliveries_pkey', 'inbound_deliveries_pkey'],
    ['shopify_webhook_deliveries_org_id_fkey', 'inbound_deliveries_org_id_fkey'],
    ['shopify_webhook_deliveries_connection_id_fkey', 'inbound_deliveries_connection_id_fkey']
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = pair[1] AND conrelid = 'public.inbound_deliveries'::regclass
    ) THEN
      EXECUTE pg_catalog.format('ALTER TABLE public.inbound_deliveries RENAME CONSTRAINT %I TO %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

ALTER INDEX IF EXISTS shopify_webhook_deliveries_org_received_idx RENAME TO inbound_deliveries_org_received_idx;--> statement-breakpoint
DROP INDEX IF EXISTS shopify_webhook_deliveries_connection_webhook_idx;--> statement-breakpoint

ALTER TABLE inbound_deliveries
  ADD COLUMN provider text NOT NULL DEFAULT 'shopify',
  ADD COLUMN raw_body bytea,
  ADD COLUMN headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN body_sha256 text,
  ADD COLUMN api_version text,
  ADD COLUMN event_id text,
  ADD COLUMN triggered_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN retention_until timestamptz NOT NULL DEFAULT (now() + interval '24 months');--> statement-breakpoint

-- Backfill existing rows. The ADD COLUMN default above stamped them with
-- now() + 24 months; their retention runs from when they were received.
UPDATE inbound_deliveries
   SET raw_body = convert_to(payload::text, 'UTF8')
 WHERE raw_body IS NULL;--> statement-breakpoint
UPDATE inbound_deliveries
   SET body_sha256 = encode(sha256(raw_body), 'hex'),
       retention_until = received_at + interval '24 months'
 WHERE body_sha256 IS NULL;--> statement-breakpoint

ALTER TABLE inbound_deliveries
  ALTER COLUMN raw_body SET NOT NULL,
  ALTER COLUMN body_sha256 SET NOT NULL,
  ALTER COLUMN payload DROP NOT NULL;--> statement-breakpoint

-- The route only ever wrote received / processed / failed, but the column had
-- no CHECK, so normalise anything else to 'failed' (retryable, and the old
-- value is kept in error) rather than let the CHECK abort the file.
UPDATE inbound_deliveries
   SET error = COALESCE(error || ' ', '') || '[0084: status was ' || quote_literal(status) || ']',
       status = 'failed'
 WHERE status NOT IN ('received', 'processing', 'processed', 'failed', 'blocked');--> statement-breakpoint

ALTER TABLE inbound_deliveries
  ADD CONSTRAINT inbound_deliveries_status_check
    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'blocked')),
  ADD CONSTRAINT inbound_deliveries_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,40}$');--> statement-breakpoint

CREATE UNIQUE INDEX inbound_deliveries_provider_connection_key_idx
  ON inbound_deliveries (provider, connection_id, delivery_key);--> statement-breakpoint

COMMENT ON COLUMN inbound_deliveries.connection_id IS
  'Still REFERENCES shopify_connections(id); CX-12 repoints it to connections(id, org_id).';--> statement-breakpoint

-- RLS: re-asserted here so the table is correct whatever its history (0050/0052
-- applied it under the old name; the rename keeps the flags but the policy
-- name should follow the table). Same NULLIF shape as 0050/0052/0083.
ALTER TABLE inbound_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE inbound_deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS shopify_webhook_deliveries_tenant_isolation ON inbound_deliveries;--> statement-breakpoint
DROP POLICY IF EXISTS inbound_deliveries_tenant_isolation ON inbound_deliveries;--> statement-breakpoint
CREATE POLICY inbound_deliveries_tenant_isolation ON inbound_deliveries
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_deliveries TO irth_app;
