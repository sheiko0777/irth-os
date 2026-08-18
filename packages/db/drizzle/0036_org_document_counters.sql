-- Per-tenant document counters, replacing count(*) + 1.
--
-- THE DEFECT BEING REPLACED
--
-- Three document numbers were each derived by counting the tenant's existing
-- rows and adding one:
--
--     SELECT count(*) FROM orders WHERE org_id = $1;   -- N
--     orderNumber = 'IRT-2026-' || lpad(N + 1, 4, '0')
--
-- That is read-then-write. At READ COMMITTED — Postgres's default, and what
-- this application runs — two concurrent creates both observe N and both
-- construct N+1. Migration 0035 added the unique indexes that turn the
-- resulting duplicate into a loud failure instead of a silent merge, but a
-- failure is still the wrong outcome for two customers legitimately ordering at
-- the same moment.
--
-- It is also O(rows) on every single create: the count scans the tenant's whole
-- table to produce one integer.
--
-- WHY A COUNTER TABLE RATHER THAN A POSTGRES SEQUENCE
--
-- A sequence is the obvious reach, and it is wrong for this:
--
--   - Sequences are explicitly NOT gapless. nextval() is non-transactional by
--     design, so a rolled-back order permanently burns its number. For an
--     invoice-like series that a tax authority may audit, gaps are a question
--     to answer rather than a detail.
--   - A sequence is global. Per-tenant numbering would need one sequence per
--     org per kind, created on the fly — DDL on a customer-facing code path.
--
-- An UPDATE ... RETURNING against a counter row is transactional: it takes a
-- row lock, so concurrent callers for the same (org, kind) serialise, and the
-- increment rolls back with the transaction that claimed it. Genuinely gapless.
--
-- The cost is that concurrent creates of the same document kind within ONE
-- tenant serialise on this row. That is the correct trade for a sequential
-- business document, and the contention is per-tenant-per-kind, so tenants
-- never block each other.
--
-- WHY last_value AND NOT next_value
--
-- `last_value` holds the number most recently handed out, so the table starts
-- empty and the first call inserts 1. A `next_value` column would need seeding
-- with 1 for every org at creation time, and any org that missed the seed would
-- silently start from whatever the default was.

CREATE TABLE IF NOT EXISTS "org_document_counters" (
  "org_id" uuid NOT NULL,
  -- 'order' | 'return' | 'purchase_order'. Text rather than an enum so adding
  -- a document kind is a code change, not a migration.
  "kind" text NOT NULL,
  "last_value" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "org_document_counters_pkey" PRIMARY KEY ("org_id", "kind")
);--> statement-breakpoint

-- RLS is NOT inherited: the loop in 0031 ran once over the tables that existed
-- then. A new tenant table added later gets nothing unless its own migration
-- says so, which is exactly how a table ends up readable across tenants while
-- looking covered.
ALTER TABLE "org_document_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_document_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "org_document_counters_tenant_isolation" ON "org_document_counters";--> statement-breakpoint

-- Same predicate as every other tenant table, including the NULLIF from 0032:
-- current_setting(name, true) returns '' rather than NULL once anything has set
-- it on the backend, and ''::uuid raises 22P02 on every query.
CREATE POLICY "org_document_counters_tenant_isolation" ON "org_document_counters"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

-- The default privileges from 0031 cover tables created afterwards, but grant
-- explicitly so this does not depend on that having been applied first.
GRANT SELECT, INSERT, UPDATE ON "org_document_counters" TO irth_app;--> statement-breakpoint

-- No DELETE grant. Removing a counter row would restart that tenant's numbering
-- at 1 and collide with every document it has already issued.
REVOKE DELETE ON "org_document_counters" FROM irth_app;--> statement-breakpoint

-- Seed from what already exists, so numbering continues rather than restarting
-- over documents issued under the old count(*)+1 scheme.
--
-- MAX of the number, not count(*): if a row was ever deleted the count is lower
-- than the highest number issued, and seeding from it hands out a number that
-- is already taken — which the 0035 indexes would then reject.
--
-- `substring(x from '(\d+)$')` takes only the TRAILING run of digits. Stripping
-- all non-digits instead would fold the year in: 'IRT-2026-0001' becomes
-- 20260001, seeding the counter eight orders of magnitude high and making the
-- next order IRT-2026-20260002. The prefixes differ per document kind
-- ('IRT-2026-0001', 'RMA-0001', 'PO-0001'), so anchoring on the tail is the one
-- rule that reads all three correctly.
--
-- Rows whose number has no trailing digits yield NULL, which MAX skips, rather
-- than failing the whole migration.
INSERT INTO "org_document_counters" ("org_id", "kind", "last_value")
SELECT org_id, 'order', COALESCE(MAX(substring(order_number from '(\d+)$')::bigint), 0)
FROM "orders" GROUP BY org_id
ON CONFLICT ("org_id", "kind") DO NOTHING;--> statement-breakpoint

INSERT INTO "org_document_counters" ("org_id", "kind", "last_value")
SELECT org_id, 'return', COALESCE(MAX(substring(return_number from '(\d+)$')::bigint), 0)
FROM "order_returns" GROUP BY org_id
ON CONFLICT ("org_id", "kind") DO NOTHING;--> statement-breakpoint

INSERT INTO "org_document_counters" ("org_id", "kind", "last_value")
SELECT org_id, 'purchase_order', COALESCE(MAX(substring(po_number from '(\d+)$')::bigint), 0)
FROM "purchase_orders" GROUP BY org_id
ON CONFLICT ("org_id", "kind") DO NOTHING;
