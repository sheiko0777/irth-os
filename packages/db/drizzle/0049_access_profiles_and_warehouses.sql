-- Per-person policies supplement the legacy owner/admin/member roles. Existing
-- memberships keep their current behaviour until an owner assigns a profile.
CREATE TABLE IF NOT EXISTS access_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  screens text[] NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);--> statement-breakpoint

ALTER TABLE org_members ADD COLUMN IF NOT EXISTS access_profile_id uuid REFERENCES access_profiles(id);--> statement-breakpoint
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS assigned_warehouse_ids uuid[] NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS job_title text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS org_members_access_profile_idx ON org_members(access_profile_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  code text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);--> statement-breakpoint

-- Preserve legacy global inventory rows. New receiving starts in an explicit
-- warehouse; the default warehouse is created without inventing lot history.
INSERT INTO warehouses (org_id, name, code, is_default)
SELECT id, 'المخزن الرئيسي', 'MAIN', true
FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  lot_number text NOT NULL,
  expires_on date,
  received_at timestamp NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'quarantine', 'expired', 'depleted')),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (org_id, warehouse_id, variant_id, lot_number)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inventory_lots_fefo_idx ON inventory_lots(org_id, variant_id, status, expires_on);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS inventory_lot_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  lot_id uuid NOT NULL UNIQUE REFERENCES inventory_lots(id),
  quantity integer NOT NULL DEFAULT 0,
  reserved_quantity integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (quantity >= 0 AND reserved_quantity >= 0 AND reserved_quantity <= quantity)
);--> statement-breakpoint

-- New tenant tables need policies immediately. The RLS role from migration
-- 0031 is applied transaction-locally by every organization-scoped request.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT unnest(ARRAY['access_profiles', 'warehouses', 'inventory_lots', 'inventory_lot_balances']) AS table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t.table_name || '_tenant_isolation', t.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid) WITH CHECK (org_id = NULLIF((SELECT current_setting(''app.org_id'', true)), '''')::uuid)',
      t.table_name || '_tenant_isolation', t.table_name
    );
  END LOOP;
END $$;
