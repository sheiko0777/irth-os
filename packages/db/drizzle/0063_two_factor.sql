-- 0063: two-factor authentication (Better Auth `twoFactor` plugin).
--
-- Backs TOTP (authenticator app) 2FA + backup codes. `two_factor` is NOT
-- org-scoped: 2FA is a property of the identity (user), not of any tenant
-- membership, so it carries no org_id and applies across every org a user
-- switches into. Better Auth owns the row's lifecycle (created on enable,
-- deleted on disable) — this migration only declares the shape it writes to.
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "two_factor" (
    "id" text PRIMARY KEY,
    "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "secret" text NOT NULL,
    "backup_codes" text NOT NULL,
    "verified" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" ("user_id");
