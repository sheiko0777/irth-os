-- 0075: accounts the owner creates directly (PR-1d, owner decision A5).
--
-- 1. Sign-in by username. Reps and suppliers often have no email; the owner
--    creates their account with a username (usually a mobile number) and a
--    temporary password. These are the two columns Better Auth's `username`
--    plugin reads and writes. `username` is stored normalised (lower case) by
--    the plugin; the unique index is what makes two accounts with the same
--    sign-in name impossible, whichever path creates them.
--
-- 2. Assigning a custom role. 0074's sync trigger re-pointed access_role_id
--    at the system role for `role` whenever `role` changed, so an UPDATE that
--    set both a custom role and the legacy text in one statement had its
--    custom role silently overwritten. From here, an UPDATE that sets
--    access_role_id itself wins; the trigger only fills it in when the
--    statement left it alone.
--
-- 3. An org can never lose its last owner. Removing, suspending or demoting
--    the only active owner would leave an org nobody can administer and no
--    support path to fix it. A deferred constraint trigger checks at commit,
--    so a statement that hands ownership over within one transaction passes;
--    any other way of reaching "members but no active owner" is refused,
--    whichever code path tries it.
--
-- 4. user_membership_count: see below.

ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_uq" UNIQUE ("username");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "org_members_sync_system_role"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IN ('owner', 'admin', 'member')
     AND (TG_OP = 'INSERT' AND NEW.access_role_id IS NULL
          OR TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role
             AND NEW.access_role_id IS NOT DISTINCT FROM OLD.access_role_id) THEN
    PERFORM seed_org_system_roles(NEW.org_id);
    SELECT id INTO NEW.access_role_id FROM access_roles
      WHERE org_id = NEW.org_id AND system_key = NEW.role;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE FUNCTION "org_members_require_owner"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM org_members WHERE org_id = OLD.org_id)
     AND NOT EXISTS (
       SELECT 1 FROM org_members m
       JOIN access_roles ar ON ar.id = m.access_role_id AND ar.org_id = m.org_id
       WHERE m.org_id = OLD.org_id AND m.status = 'active' AND ar.system_key = 'owner'
     ) THEN
    RAISE EXCEPTION 'organization % must keep at least one active owner', OLD.org_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'org_members_require_owner';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "org_members_require_owner"() FROM PUBLIC;--> statement-breakpoint
-- Every UPDATE, not UPDATE OF (access_role_id, status): a column changed by
-- a BEFORE trigger — org_members_sync_system_role re-pointing access_role_id
-- when only `role` was set — does not count as "OF" that column, and
-- demoting the owner through the legacy text would slip past.
CREATE CONSTRAINT TRIGGER "org_members_require_owner"
  AFTER UPDATE OR DELETE ON "org_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "org_members_require_owner"();--> statement-breakpoint

-- 4. How many orgs a user belongs to — nothing else about them. Resetting a
--    password (PR-1d) is only allowed for an account that belongs to the
--    caller's org alone, and the org-scoped connection cannot see other orgs'
--    memberships (RLS), which is right for everything but this one count.
CREATE FUNCTION "user_membership_count"(p_user_id text) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM org_members WHERE user_id = p_user_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "user_membership_count"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "user_membership_count"(text) TO "irth_app";
