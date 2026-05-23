CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  type text NOT NULL CHECK (type IN ('percentage','fixed','free_shipping')),
  value numeric(10,2) NOT NULL DEFAULT 0,
  min_order_amount numeric(12,2),
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamp,
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_org_code_idx ON coupons(org_id, code);
CREATE INDEX IF NOT EXISTS coupons_org_id_idx ON coupons(org_id);
