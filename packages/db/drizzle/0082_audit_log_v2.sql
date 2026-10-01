-- 0082: audit_log v2 — who/how/outcome columns, and append-only enforced by the database.
--
-- CX-05. audit_log is the one authoritative record of actions, and until now
-- nothing stopped it being rewritten: 0031's default privileges hand irth_app
-- UPDATE and DELETE on every table, and the owner role could always rewrite it.
--
-- ADDITIVE on purpose. The packet planned to rename table_name -> resource_type
-- and drop record_id; the audit viewer (routers/audit.ts), every withAudit call
-- and several integration tests read those columns today, so they stay.
-- resource_id (text) sits beside record_id (uuid) because not every audited
-- subject has a uuid key.
--
-- Defaults keep every existing writer valid: a row that says nothing is a user
-- acting through the admin app, successfully. The BEFORE INSERT trigger copies
-- user_id -> actor_id and record_id -> resource_id when a writer leaves them
-- unset, so raw inserts (webhooks, tests) stay filterable by the new columns
-- without each call site having to remember.
--
-- Append-only, two layers:
--   1. REVOKE UPDATE, DELETE from irth_app (MIGRATIONS.md rule 6).
--   2. A BEFORE UPDATE OR DELETE row trigger that raises — the owner role
--      (neondb_owner, BYPASSRLS) is not subject to grants on its own table, so
--      only a trigger stops it. TRUNCATE does not fire row triggers; the
--      integration harness relies on that, and irth_app has no TRUNCATE grant.
-- The backfill UPDATEs below run before the trigger exists.

ALTER TABLE "audit_log"
  ADD COLUMN "actor_kind" text NOT NULL DEFAULT 'user',
  ADD COLUMN "actor_id" text,
  ADD COLUMN "on_behalf_of" text,
  ADD COLUMN "channel" text NOT NULL DEFAULT 'admin',
  ADD COLUMN "outcome" text NOT NULL DEFAULT 'success',
  ADD COLUMN "before" jsonb,
  ADD COLUMN "after" jsonb,
  ADD COLUMN "reason" text,
  ADD COLUMN "request_id" text,
  ADD COLUMN "correlation_id" text,
  ADD COLUMN "ip" text,
  ADD COLUMN "ua" text,
  ADD COLUMN "resource_id" text;--> statement-breakpoint

UPDATE "audit_log" SET "actor_id" = "user_id", "resource_id" = "record_id"::text;--> statement-breakpoint
-- Rows whose writer is known from the action name.
UPDATE "audit_log" SET "actor_kind" = 'webhook', "channel" = 'webhook'
  WHERE "action" IN ('BOSTA_WEBHOOK_STATUS_UPDATE', 'PAYMOB_WEBHOOK', 'SHOPIFY_ORDER_BLOCKED',
                     'SHOPIFY_ORDER_CREATE', 'SHOPIFY_ORDER_UPDATE', 'SHOPIFY_ORDER_CANCEL');--> statement-breakpoint
UPDATE "audit_log" SET "actor_kind" = 'cron', "channel" = 'cron'
  WHERE "action" = 'SHOPIFY_ORDER_REIMPORTED';--> statement-breakpoint
UPDATE "audit_log" SET "outcome" = 'denied' WHERE "action" = 'PERMISSION_DENIED';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_log_org_created_idx" ON "audit_log" ("org_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_resource_idx" ON "audit_log" ("org_id", "table_name", "resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_actor_idx" ON "audit_log" ("org_id", "actor_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "audit_log_fill_v2"() RETURNS trigger AS $$
BEGIN
  NEW."actor_id" := COALESCE(NEW."actor_id", NEW."user_id");
  NEW."resource_id" := COALESCE(NEW."resource_id", NEW."record_id"::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "audit_log_fill_v2" BEFORE INSERT ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_fill_v2"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "audit_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "audit_log_immutable" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_immutable"();--> statement-breakpoint

-- RLS (0031/0032) and SELECT/INSERT for irth_app are unchanged.
REVOKE UPDATE, DELETE ON "audit_log" FROM "irth_app";
