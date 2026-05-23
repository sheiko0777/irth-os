-- Phase 21: Customer CRM & Loyalty System

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  address text,
  loyalty_points integer NOT NULL DEFAULT 0,
  total_orders integer NOT NULL DEFAULT 0,
  total_spent numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_org_id_idx ON customers(org_id);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type text NOT NULL, -- 'earn' | 'redeem' | 'adjust'
  points integer NOT NULL,
  balance_after integer NOT NULL,
  note text,
  reference_id uuid,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loyalty_transactions_customer_id_idx ON loyalty_transactions(customer_id);
