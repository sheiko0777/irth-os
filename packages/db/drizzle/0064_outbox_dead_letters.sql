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
-- RLS is added in 0065, not here -- this file was already applied (without
-- RLS) against the shared integration-test branch before that gap was
-- caught, and migrate.mjs's ledger is filename-keyed, so editing an
-- already-applied file's content in place would silently never re-run
-- there. A follow-up migration is the correct fix, not a rewrite of this
-- one.
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
