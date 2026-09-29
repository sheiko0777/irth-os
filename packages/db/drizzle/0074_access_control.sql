-- 0074: roles the org defines, per-person overrides and data scopes (owner decision A5).
--
-- Until now a member's authority was one text column, org_members.role, read
-- against a fixed three-role matrix in packages/db/src/permissions.ts. The
-- owner needs to create accounts for staff, delivery reps, sales reps and
-- suppliers and choose, per role and per person, which screens and actions
-- they get and which warehouses/brands/channels/supplier they are limited to.
--
-- This migration adds the data model only. NOTHING READS IT FOR AUTHORIZATION
-- YET: requirePermission still checks org_members.role. The next step moves
-- the check onto these tables, and the backfill below is what makes that move
-- a no-op for every existing member.
--
--   access_roles    one row per role an org can assign.
--                   System roles (system_key owner|admin|member) carry NO
--                   permission list: their permissions are, by definition,
--                   the matrix in permissions.ts, so a system role and the
--                   code can never drift apart. They cannot be edited, only
--                   copied into a custom role (system_key NULL), which carries
--                   its own permissions jsonb {resource: [action, ...]}.
--   org_members +   access_role_id (FK, same org), principal_kind
--                   (staff|delivery_rep|sales_rep|supplier), status
--                   (active|suspended), overrides {grant:{}, revoke:{}},
--                   must_change_password.
--   member_scopes   (member, scope_kind, scope_id): warehouse | brand |
--                   channel | supplier. No rows = unrestricted.
--
-- Kept in sync: while org_members.role is still the source of truth, a
-- trigger points access_role_id at the org's system role for that role
-- whenever a member is inserted or their role changes, so an invite accepted
-- or a role changed between this deploy and the next cannot leave a member
-- without a role row.

CREATE TABLE "access_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  "principal_kind" text NOT NULL DEFAULT 'staff',
  "system_key" text,
  "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "access_roles_org_name_uq" UNIQUE ("org_id", "name"),
  CONSTRAINT "access_roles_id_org_uq" UNIQUE ("id", "org_id"),
  CONSTRAINT "access_roles_principal_kind_check"
    CHECK ("principal_kind" IN ('staff', 'delivery_rep', 'sales_rep', 'supplier')),
  CONSTRAINT "access_roles_system_key_check"
    CHECK ("system_key" IS NULL OR "system_key" IN ('owner', 'admin', 'member')),
  -- A system role's permissions are the code matrix; storing a list on it
  -- would be a second source of truth.
  CONSTRAINT "access_roles_system_has_no_list_check"
    CHECK ("system_key" IS NULL OR "permissions" = '{}'::jsonb),
  CONSTRAINT "access_roles_permissions_object_check"
    CHECK (jsonb_typeof("permissions") = 'object')
);--> statement-breakpoint
CREATE UNIQUE INDEX "access_roles_org_system_key_uq" ON "access_roles" ("org_id", "system_key")
  WHERE "system_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "access_roles_org_id_idx" ON "access_roles" ("org_id");--> statement-breakpoint

ALTER TABLE "access_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "access_roles_tenant_isolation" ON "access_roles"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "access_roles" TO "irth_app";--> statement-breakpoint

ALTER TABLE "org_members" ADD COLUMN "access_role_id" uuid;--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "principal_kind" text NOT NULL DEFAULT 'staff';--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "status" text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "overrides" jsonb NOT NULL DEFAULT '{"grant":{},"revoke":{}}'::jsonb;--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_principal_kind_check"
  CHECK ("principal_kind" IN ('staff', 'delivery_rep', 'sales_rep', 'supplier'));--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_status_check"
  CHECK ("status" IN ('active', 'suspended'));--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_overrides_shape_check"
  CHECK (jsonb_typeof("overrides") = 'object'
    AND jsonb_typeof(COALESCE("overrides"->'grant', '{}'::jsonb)) = 'object'
    AND jsonb_typeof(COALESCE("overrides"->'revoke', '{}'::jsonb)) = 'object');--> statement-breakpoint
-- Same-org by construction: a member cannot hold another org's role.
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_access_role_same_org_fk"
  FOREIGN KEY ("access_role_id", "org_id") REFERENCES "access_roles"("id", "org_id");--> statement-breakpoint
CREATE INDEX "org_members_access_role_id_idx" ON "org_members" ("access_role_id");--> statement-breakpoint
-- Target for member_scopes' composite FK.
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_id_org_uq" UNIQUE ("id", "org_id");--> statement-breakpoint

CREATE TABLE "member_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "member_id" uuid NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "member_scopes_member_same_org_fk"
    FOREIGN KEY ("member_id", "org_id") REFERENCES "org_members"("id", "org_id") ON DELETE CASCADE,
  CONSTRAINT "member_scopes_kind_check"
    CHECK ("scope_kind" IN ('warehouse', 'brand', 'channel', 'supplier')),
  CONSTRAINT "member_scopes_member_kind_scope_uq" UNIQUE ("member_id", "scope_kind", "scope_id")
);--> statement-breakpoint
CREATE INDEX "member_scopes_org_id_idx" ON "member_scopes" ("org_id");--> statement-breakpoint

ALTER TABLE "member_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_scopes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "member_scopes_tenant_isolation" ON "member_scopes"
  USING ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK ("org_id" = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "member_scopes" TO "irth_app";--> statement-breakpoint

-- System roles for one org. Idempotent: re-running adds nothing.
CREATE FUNCTION "seed_org_system_roles"(p_org_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO access_roles (org_id, name, system_key) VALUES
    (p_org_id, 'مالك', 'owner'),
    (p_org_id, 'مدير', 'admin'),
    (p_org_id, 'موظف', 'member')
  ON CONFLICT (org_id, system_key) WHERE system_key IS NOT NULL DO NOTHING;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "seed_org_system_roles"(uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION "organizations_seed_system_roles"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM seed_org_system_roles(NEW.id);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "organizations_seed_system_roles"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "organizations_seed_system_roles"
  AFTER INSERT ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION "organizations_seed_system_roles"();--> statement-breakpoint

-- While org_members.role is the authority, keep access_role_id pointing at the
-- matching system role. Only when role is one of the three system keys: a
-- future custom-role assignment sets access_role_id itself and is left alone.
CREATE FUNCTION "org_members_sync_system_role"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IN ('owner', 'admin', 'member')
     AND (TG_OP = 'INSERT' AND NEW.access_role_id IS NULL
          OR TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role) THEN
    PERFORM seed_org_system_roles(NEW.org_id);
    SELECT id INTO NEW.access_role_id FROM access_roles
      WHERE org_id = NEW.org_id AND system_key = NEW.role;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "org_members_sync_system_role"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "org_members_sync_system_role"
  BEFORE INSERT OR UPDATE OF "role" ON "org_members"
  FOR EACH ROW EXECUTE FUNCTION "org_members_sync_system_role"();--> statement-breakpoint

-- Backfill: every existing org gets its system roles, every existing member
-- points at the one matching their role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM seed_org_system_roles(r.id);
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "org_members" m SET "access_role_id" = ar."id"
  FROM "access_roles" ar
  WHERE ar."org_id" = m."org_id" AND ar."system_key" = m."role" AND m."access_role_id" IS NULL;
