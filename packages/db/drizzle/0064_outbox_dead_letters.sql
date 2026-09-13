-- 0064: outbox dead-letters.
--
-- Once an outbox_events row's attempts reaches the claim query's ceiling
-- (attempts < 5 in processOutbox), it is permanently excluded from every
-- future claim -- but today it just sits in outbox_events forever,
-- processed=false, invisible. Only campaign.recipient.send events get any
-- visibility today (the recipient row itself is marked 'failed' directly,
-- see finalizeDeadLetteredCampaignRecipient in outboxWorker.ts). The other
-- four event types (shopify.product.push, eta.invoice.issue, org.invite.sent,
-- order.confirmed/order.shipped) have no equivalent -- a permanently-stuck
-- Shopify push or invite email today just rots, unseen, forever.
--
-- This gives every event type the same durable resting place: on the
-- attempt that reaches the ceiling, the row moves from outbox_events into
-- here (see recordEventFailure in outboxWorker.ts) instead of staying
-- stuck in place.
--
-- replayed_at/replayed_by are reserved for a future re-queue action --
-- deliberately not wired to anything in this migration's own PR.
CREATE TABLE "outbox_dead_letters" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
    "event_type" text NOT NULL,
    "payload" text NOT NULL,
    "attempts" integer NOT NULL,
    "last_error" text NOT NULL,
    "failed_at" timestamp DEFAULT now() NOT NULL,
    "replayed_at" timestamp,
    "replayed_by" text
);
--> statement-breakpoint
CREATE INDEX "outbox_dead_letters_org_id_idx" ON "outbox_dead_letters" ("org_id");
--> statement-breakpoint
CREATE INDEX "outbox_dead_letters_failed_at_idx" ON "outbox_dead_letters" ("failed_at");
--> statement-breakpoint

-- Every table with an org_id gets RLS -- see rlsCoverage.test.ts, which
-- fails the build on any table that skips this (0045/0047 both did, by
-- omission, and that test is what turned it from invisible into a red
-- build). outbox_events itself has RLS too, swept up by 0031's one-time
-- catalogue loop; RLS is not inherited, so every table created afterward,
-- this one included, must opt in explicitly.
--
-- This does not fight the worker's own design: processOutbox connects as
-- the owning role (BYPASSRLS), which is why it can drain every org's dead
-- letters in one sweep despite this policy existing. FORCE still matters
-- as a safety net against a future caller that reaches this table through
-- a tenant-scoped `SET LOCAL ROLE irth_app` session.
ALTER TABLE "outbox_dead_letters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox_dead_letters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "outbox_dead_letters_tenant_isolation" ON "outbox_dead_letters"
  USING (org_id = (SELECT current_setting('app.org_id', true))::uuid)
  WITH CHECK (org_id = (SELECT current_setting('app.org_id', true))::uuid);
