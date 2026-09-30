-- 0077: delivery reps — order assignment, delivery attempts, COD custody (PR-2a).
--
-- A delivery rep (org_members.principal_kind = 'delivery_rep') delivers the
-- orders assigned to them, collects the cash on delivery, and hands the cash
-- over at the end of the day. Money moves through the ledger at each step:
--
--   delivered      Dr 1030 AR-COD     / Cr revenue, VAT  (postOrderDeliveredEntry, unchanged)
--   collected      Dr 1060 rep custody / Cr 1030 AR-COD
--   handover       Dr 1010 cash        / Cr 1060 rep custody   (amount actually received)
--   shortage       Dr 5030 shortage    / Cr 1060 rep custody   (a separate, approved entry)
--
-- Nothing here is ever edited to correct money: a collection is written once
-- per order (UNIQUE), a handover moves forward submitted → confirmed, and a
-- shortage is its own entry. The accounts 1060/5030 are seeded by
-- ensureChartOfAccounts on the next post, like every other standard account.
--
-- A rep sees only their own work, in the database as well as in the code
-- (CLAUDE.md rule 3). withOrgContext sets two more transaction-local settings:
--
--   app.principal_kind  the member's kind ('staff', 'delivery_rep', ...)
--   app.member_id       the member's org_members.id
--
-- The RESTRICTIVE policies below narrow a delivery rep to orders assigned to
-- them and to their own attempts, collections and handovers. They fail closed:
-- a rep transaction without app.member_id matches nothing.

-- Orders carry their rep ----------------------------------------------------------
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_org_id_key" UNIQUE ("id", "org_id");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "assigned_rep_member_id" uuid;--> statement-breakpoint
-- Composite, so a rep from another org is unrepresentable. Removing the member
-- unassigns the order; it does not delete it.
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_rep_same_org_fk"
  FOREIGN KEY ("assigned_rep_member_id", "org_id") REFERENCES "org_members"("id", "org_id")
  ON DELETE SET NULL ("assigned_rep_member_id");--> statement-breakpoint
CREATE INDEX "orders_org_assigned_rep_idx" ON "orders" ("org_id", "assigned_rep_member_id")
  WHERE "assigned_rep_member_id" IS NOT NULL;--> statement-breakpoint

-- Delivery attempts: an append-only log ------------------------------------------
CREATE TABLE "delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "order_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "outcome" text NOT NULL,
  "reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "delivery_attempts_order_same_org_fk"
    FOREIGN KEY ("order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  -- NO ACTION: a rep with delivery history is suspended, not deleted.
  CONSTRAINT "delivery_attempts_member_same_org_fk"
    FOREIGN KEY ("member_id", "org_id") REFERENCES "org_members"("id", "org_id"),
  CONSTRAINT "delivery_attempts_outcome_check" CHECK ("outcome" IN ('delivered', 'failed', 'returned')),
  CONSTRAINT "delivery_attempts_reason_length_check" CHECK ("reason" IS NULL OR length("reason") <= 500)
);--> statement-breakpoint
CREATE INDEX "delivery_attempts_org_order_idx" ON "delivery_attempts" ("org_id", "order_id");--> statement-breakpoint

-- Handovers: the cash a rep brings back --------------------------------------------
CREATE TABLE "rep_cash_handovers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "member_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  -- What the rep says they handed over, what their collections add up to, and
  -- what the cashier counted. Only received_minor reaches the ledger.
  "declared_minor" bigint NOT NULL,
  "expected_minor" bigint NOT NULL,
  "received_minor" bigint,
  "written_off_minor" bigint,
  "status" text NOT NULL DEFAULT 'submitted',
  "submitted_at" timestamp NOT NULL DEFAULT now(),
  "confirmed_by" text,
  "confirmed_at" timestamp,
  "written_off_by" text,
  "written_off_at" timestamp,
  CONSTRAINT "rep_cash_handovers_id_org_id_key" UNIQUE ("id", "org_id"),
  CONSTRAINT "rep_cash_handovers_member_same_org_fk"
    FOREIGN KEY ("member_id", "org_id") REFERENCES "org_members"("id", "org_id"),
  CONSTRAINT "rep_cash_handovers_status_check" CHECK ("status" IN ('submitted', 'confirmed')),
  CONSTRAINT "rep_cash_handovers_amounts_check" CHECK (
    "declared_minor" >= 0 AND "expected_minor" > 0
    AND ("received_minor" IS NULL OR ("received_minor" >= 0 AND "received_minor" <= "expected_minor"))
  ),
  -- Confirmed exactly when counted.
  CONSTRAINT "rep_cash_handovers_confirmed_check" CHECK (
    ("status" = 'confirmed') = ("received_minor" IS NOT NULL AND "confirmed_at" IS NOT NULL)
  ),
  -- A write-off covers exactly the shortage, and only after the count.
  CONSTRAINT "rep_cash_handovers_write_off_check" CHECK (
    "written_off_minor" IS NULL
    OR ("status" = 'confirmed' AND "written_off_minor" = "expected_minor" - "received_minor" AND "written_off_minor" > 0)
  )
);--> statement-breakpoint
CREATE INDEX "rep_cash_handovers_org_member_idx" ON "rep_cash_handovers" ("org_id", "member_id");--> statement-breakpoint

-- Collections: one per order, ever -------------------------------------------------
CREATE TABLE "rep_cash_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "member_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" char(3) NOT NULL,
  "handover_id" uuid,
  "collected_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "rep_cash_collections_member_same_org_fk"
    FOREIGN KEY ("member_id", "org_id") REFERENCES "org_members"("id", "org_id"),
  CONSTRAINT "rep_cash_collections_order_same_org_fk"
    FOREIGN KEY ("order_id", "org_id") REFERENCES "orders"("id", "org_id"),
  CONSTRAINT "rep_cash_collections_handover_same_org_fk"
    FOREIGN KEY ("handover_id", "org_id") REFERENCES "rep_cash_handovers"("id", "org_id"),
  CONSTRAINT "rep_cash_collections_amount_check" CHECK ("amount_minor" > 0),
  -- The idempotency key stops a retried request; this stops a second request
  -- with a different key from collecting the same order twice.
  CONSTRAINT "rep_cash_collections_org_order_uq" UNIQUE ("org_id", "order_id")
);--> statement-breakpoint
CREATE INDEX "rep_cash_collections_org_member_open_idx" ON "rep_cash_collections" ("org_id", "member_id")
  WHERE "handover_id" IS NULL;--> statement-breakpoint

-- A collection joins one handover and never leaves it.
CREATE FUNCTION "rep_cash_collections_handover_once"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.handover_id IS NOT NULL AND NEW.handover_id IS DISTINCT FROM OLD.handover_id THEN
    RAISE EXCEPTION 'collection % already belongs to handover %', OLD.id, OLD.handover_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "rep_cash_collections_handover_once"
  BEFORE UPDATE ON "rep_cash_collections"
  FOR EACH ROW EXECUTE FUNCTION "rep_cash_collections_handover_once"();--> statement-breakpoint

-- Tenant isolation (0038 shape) and grants ---------------------------------------
ALTER TABLE "delivery_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "delivery_attempts_tenant_isolation" ON "delivery_attempts"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "rep_cash_handovers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rep_cash_handovers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rep_cash_handovers_tenant_isolation" ON "rep_cash_handovers"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "rep_cash_collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rep_cash_collections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rep_cash_collections_tenant_isolation" ON "rep_cash_collections"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint

-- 0031's default privileges grant everything; take back what history must not allow.
GRANT SELECT, INSERT ON "delivery_attempts" TO "irth_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "delivery_attempts" FROM "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rep_cash_handovers" TO "irth_app";--> statement-breakpoint
REVOKE DELETE ON "rep_cash_handovers" FROM "irth_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "rep_cash_collections" TO "irth_app";--> statement-breakpoint
REVOKE UPDATE, DELETE ON "rep_cash_collections" FROM "irth_app";--> statement-breakpoint
-- The only change a collection ever takes: joining a handover.
GRANT UPDATE ("handover_id") ON "rep_cash_collections" TO "irth_app";--> statement-breakpoint

-- A delivery rep sees only their own work ------------------------------------------
-- NULL when the setting is absent: every comparison against it is then false,
-- so a rep transaction that forgot its member id sees nothing.
CREATE FUNCTION "app_member_id"() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.member_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE FUNCTION "app_is_delivery_rep"() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.principal_kind', true), '') = 'delivery_rep'
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_member_id"() TO "irth_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_is_delivery_rep"() TO "irth_app";--> statement-breakpoint

CREATE POLICY "orders_delivery_rep_scope" ON "orders" AS RESTRICTIVE
  USING (NOT app_is_delivery_rep() OR "assigned_rep_member_id" = app_member_id())
  WITH CHECK (NOT app_is_delivery_rep() OR "assigned_rep_member_id" = app_member_id());--> statement-breakpoint
CREATE POLICY "order_items_delivery_rep_scope" ON "order_items" AS RESTRICTIVE
  USING (NOT app_is_delivery_rep() OR "order_id" IN (SELECT "id" FROM "orders"))
  WITH CHECK (NOT app_is_delivery_rep() OR "order_id" IN (SELECT "id" FROM "orders"));--> statement-breakpoint
CREATE POLICY "delivery_attempts_delivery_rep_scope" ON "delivery_attempts" AS RESTRICTIVE
  USING (NOT app_is_delivery_rep() OR "member_id" = app_member_id())
  WITH CHECK (NOT app_is_delivery_rep() OR "member_id" = app_member_id());--> statement-breakpoint
CREATE POLICY "rep_cash_collections_delivery_rep_scope" ON "rep_cash_collections" AS RESTRICTIVE
  USING (NOT app_is_delivery_rep() OR "member_id" = app_member_id())
  WITH CHECK (NOT app_is_delivery_rep() OR "member_id" = app_member_id());--> statement-breakpoint
CREATE POLICY "rep_cash_handovers_delivery_rep_scope" ON "rep_cash_handovers" AS RESTRICTIVE
  USING (NOT app_is_delivery_rep() OR "member_id" = app_member_id())
  WITH CHECK (NOT app_is_delivery_rep() OR "member_id" = app_member_id());
