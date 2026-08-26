-- 0044: durable retry state for ETA invoice submission.
--
-- Delivery-triggered issueInvoice() used to be fire-and-forget (a bare
-- .then().catch() with no waitUntil, after orders.ts/bosta.ts's own
-- transaction had already committed) - now routed through the outbox
-- (eventType 'eta.invoice.issue'), whose worker needs somewhere durable to
-- record when a retry is next due.

ALTER TABLE "eta_invoices" ADD COLUMN "next_retry_at" timestamp;
--> statement-breakpoint

ALTER TABLE "eta_invoices" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint

-- created_at was declared without .notNull() despite outbox_events' identical
-- column being NOT NULL, and defaultNow() has always fired on every insert
-- (no code path leaves it null) - this just makes the schema honest.
ALTER TABLE "eta_invoices" ALTER COLUMN "created_at" SET NOT NULL;
--> statement-breakpoint

-- status stays TEXT, not a pgEnum: the admin router already writes 'error', a
-- 6th value the original column comment never listed, and converting to an
-- enum needs an audit of every value a LIVE column holds, which this pass
-- has not done. A CHECK gets the same "typo rejected at write time"
-- guarantee without ALTER TYPE ... ADD VALUE's separate-migration ceremony
-- (it cannot run in the same transaction as a statement that uses the new
-- value, which this repo's single-transaction-per-file migration runner
-- would otherwise require).
ALTER TABLE "eta_invoices" ADD CONSTRAINT "eta_invoices_status_check"
  CHECK (status IN ('pending','submitted','valid','rejected','cancelled','error'));
