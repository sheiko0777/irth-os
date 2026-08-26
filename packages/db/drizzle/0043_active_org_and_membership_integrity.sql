-- 0043: durable active-org selection + org_members integrity.
--
-- Two independent copies of "which org is a user acting in" (authContext.ts,
-- trpc.ts::createContext) each ran the same unordered, unindexed org_members
-- query and landed on whatever row Postgres returned first for a user in 2+
-- orgs, with no way to switch. This adds a durable place to record a choice
-- (user.last_active_org_id, NOT session — Better Auth's session table gets a
-- brand new row on every login with nothing carrying state forward, so a
-- session-scoped column would force re-picking an org on every login for no
-- benefit) plus the two safety constraints the shared resolver depends on.

ALTER TABLE "user" ADD COLUMN "last_active_org_id" uuid REFERENCES "organizations"("id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "org_members_user_id_idx" ON "org_members" ("user_id");
--> statement-breakpoint

-- Duplicate (org_id, user_id) rows are not prevented today. None expected —
-- nothing in this codebase's write path double-inserts a membership — but a
-- migration should not assume; delete the newer duplicate before the unique
-- index would otherwise fail to apply. `public` on production has no known
-- duplicates; this is a no-op there and a safety net everywhere else.
DELETE FROM "org_members" a USING "org_members" b
  WHERE a.id > b.id AND a.org_id = b.org_id AND a.user_id = b.user_id;
--> statement-breakpoint

CREATE UNIQUE INDEX "org_members_org_id_user_id_idx" ON "org_members" ("org_id", "user_id");
