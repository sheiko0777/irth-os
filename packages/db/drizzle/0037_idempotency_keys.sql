-- Idempotency keys: a retry re-reads the first response instead of re-applying.
--
-- THE PROBLEM
--
-- Every financial mutation here is currently "apply once per call". Networks do
-- not work that way. A client that times out, a mobile app on Egyptian mobile
-- data that loses the response, a double-tapped button, a proxy retry — all
-- produce a second identical request for one intended action. Today that
-- second request creates a second order, decrements stock twice, or tops up a
-- gift card twice.
--
-- The transaction work in P2/P3 makes each call atomic. Atomic is not
-- idempotent: two atomic calls still apply twice. Only a key the caller
-- supplies can tell "retry of the same intent" apart from "a second, genuine
-- request that happens to look identical" — the server cannot infer it, because
-- a customer ordering the same item twice in a minute is legitimate.
--
-- SHAPE
--
--   (org_id, key)          the caller's idempotency key, scoped per tenant so
--                          one org cannot probe or collide with another's.
--   request_fingerprint    hash of the request body. A key REUSED with different
--                          parameters is a client bug, and returning the first
--                          response would silently discard the second request's
--                          intent. Detected and rejected rather than guessed at.
--   state                  'in_progress' | 'completed'
--   response               the stored result, replayed on retry.
--
-- WHY A STATE COLUMN RATHER THAN JUST A RESULT ROW
--
-- The dangerous window is a retry arriving while the first attempt is still
-- running — exactly what a client timeout produces, since the client gives up
-- precisely because the server is slow. Without a marker claimed BEFORE the
-- work, both attempts see "no result yet" and both proceed. The row is inserted
-- 'in_progress' first; a concurrent retry sees it and is rejected with a
-- retry-later rather than duplicating the work.
--
-- WHY NOT A UNIQUE INDEX ON THE BUSINESS ROW INSTEAD
--
-- That only works where the operation creates exactly one row with a natural
-- key. It does not cover topping up a balance, decrementing stock, or anything
-- that updates rather than inserts — which is most of what needs this.

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "key" text NOT NULL,
  -- The procedure this key was used for. The same key value under two
  -- different operations is two different intents, not a retry.
  "operation" text NOT NULL,
  "request_fingerprint" text NOT NULL,
  "state" text NOT NULL DEFAULT 'in_progress',
  "response" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  CONSTRAINT "idempotency_keys_state_check"
    CHECK ("state" IN ('in_progress', 'completed')),
  -- A completed row must carry the response it is meant to replay; an
  -- in_progress row must not pretend to have one.
  CONSTRAINT "idempotency_keys_response_check"
    CHECK (("state" = 'completed' AND "response" IS NOT NULL)
        OR ("state" = 'in_progress' AND "response" IS NULL))
);--> statement-breakpoint

-- The uniqueness that does the actual work: the INSERT of an in_progress row
-- either succeeds (this caller owns the operation) or violates this index (a
-- retry). Per tenant AND per operation.
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_org_operation_key_idx"
  ON "idempotency_keys" ("org_id", "operation", "key");--> statement-breakpoint

-- For the sweep that clears expired keys.
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx"
  ON "idempotency_keys" ("created_at");--> statement-breakpoint

-- RLS is NOT inherited: the loop in 0031 ran once, over the tables that existed
-- then. A tenant table added later gets nothing unless its own migration says
-- so — which is how a table ends up readable across tenants while looking
-- covered.
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "idempotency_keys_tenant_isolation" ON "idempotency_keys";--> statement-breakpoint

-- Same predicate as every other tenant table, NULLIF included (0032):
-- current_setting(name, true) yields '' rather than NULL once anything has set
-- it on that backend, and ''::uuid raises 22P02 on every query.
CREATE POLICY "idempotency_keys_tenant_isolation" ON "idempotency_keys"
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO irth_app;
