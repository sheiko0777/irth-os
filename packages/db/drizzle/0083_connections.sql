-- 0083: connections + connection_secrets — one encrypted credential store for every provider (CX-07).
--
-- Today each provider keeps its credential its own way: shopify_connections
-- holds an AES-GCM token under SHOPIFY_TOKEN_ENCRYPTION_KEY, Bosta/Paymob/ETA
-- read a single global Worker secret, and org_settings carries a few
-- encrypted values under SETTINGS_ENCRYPTION_KEY. That allows one store per
-- provider per deployment and no rotation story. This file adds the generic
-- home; nothing is moved here yet (the Shopify move is CX-12, and the
-- explicit import op in apps/api/src/integrations/kernel/secrets.ts only
-- copies a credential when someone calls it).
--
-- connections        one row per provider account (a Shopify store, a Bosta
--                    business, a Paymob merchant). Non-secret config only.
--                    brand_id / legal_entity_id are nullable now and use the
--                    composite (x_id, org_id) FKs from 0069; DM's tenancy
--                    follow-up tightens them.
-- connection_secrets one row per (connection, secret name). ENVELOPE
--                    encryption: the value is AES-256-GCM under a fresh
--                    per-row data key (DEK); the DEK is AES-256-GCM-wrapped
--                    under the key-encryption key (KEK) named by key_version,
--                    read from the Worker/Vercel secret
--                    CONNECTION_SECRETS_KEY_V<key_version> (base64, 32 bytes).
--                    Both layers bind org_id/connection_id/name as GCM
--                    additional data, so a row copied onto another connection
--                    does not decrypt. Rotating the KEK only re-wraps DEKs;
--                    ciphertext is untouched. Plaintext never reaches the DB.
--
-- KEY LOSS = EVERY CONNECTION LOST. The KEK is not stored anywhere in the
-- database. The owner keeps each CONNECTION_SECRETS_KEY_V<n> (base64) in a
-- password manager; a restore drill (docs/db/RESTORE.md) must include
-- re-entering it as a Worker and Vercel secret. Without it the rows are
-- unreadable and every provider must be reconnected by hand.

CREATE TABLE "connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "provider" text NOT NULL,
  "family" text NOT NULL,
  "name" text NOT NULL,
  "external_account_id" text,
  "brand_id" uuid,
  "legal_entity_id" uuid,
  "status" text NOT NULL DEFAULT 'pending',
  "priority" integer NOT NULL DEFAULT 0,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "health" jsonb,
  "last_error" text,
  "last_health_at" timestamp,
  "last_webhook_at" timestamp,
  "disabled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "connections_id_org_uq" UNIQUE ("id", "org_id"),
  CONSTRAINT "connections_org_provider_account_uq" UNIQUE ("org_id", "provider", "external_account_id"),
  CONSTRAINT "connections_family_check" CHECK ("family" IN ('storefront', 'courier', 'payment', 'messaging', 'tax')),
  CONSTRAINT "connections_status_check" CHECK ("status" IN ('pending', 'active', 'degraded', 'disabled')),
  CONSTRAINT "connections_config_object_check" CHECK (jsonb_typeof("config") = 'object'),
  CONSTRAINT "connections_brand_same_org_fk" FOREIGN KEY ("brand_id", "org_id") REFERENCES "brands"("id", "org_id"),
  CONSTRAINT "connections_entity_same_org_fk" FOREIGN KEY ("legal_entity_id", "org_id") REFERENCES "legal_entities"("id", "org_id")
);--> statement-breakpoint
CREATE INDEX "connections_org_family_idx" ON "connections" ("org_id", "family", "priority");--> statement-breakpoint

CREATE TABLE "connection_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "connection_id" uuid NOT NULL,
  "name" text NOT NULL,
  "key_version" integer NOT NULL,
  "wrapped_dek" text NOT NULL,
  "dek_iv" text NOT NULL,
  "ciphertext" text NOT NULL,
  "iv" text NOT NULL,
  "last4" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "rotated_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "connection_secrets_connection_name_uq" UNIQUE ("connection_id", "name"),
  CONSTRAINT "connection_secrets_key_version_check" CHECK ("key_version" > 0),
  CONSTRAINT "connection_secrets_connection_same_org_fk" FOREIGN KEY ("connection_id", "org_id")
    REFERENCES "connections"("id", "org_id") ON DELETE CASCADE
);--> statement-breakpoint
-- The KEK rotation job selects by version.
CREATE INDEX "connection_secrets_key_version_idx" ON "connection_secrets" ("key_version");--> statement-breakpoint
-- Tenant predicate (RLS and every org-scoped read) leads with org_id.
CREATE INDEX "connection_secrets_org_connection_idx" ON "connection_secrets" ("org_id", "connection_id");--> statement-breakpoint

-- RLS: same NULLIF policy shape as 0038/0069, explicit grants.
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "connections_tenant_isolation" ON "connections";--> statement-breakpoint
CREATE POLICY "connections_tenant_isolation" ON "connections"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "connection_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_secrets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "connection_secrets_tenant_isolation" ON "connection_secrets";--> statement-breakpoint
CREATE POLICY "connection_secrets_tenant_isolation" ON "connection_secrets"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "connections", "connection_secrets" TO "irth_app";
