CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX ON suppliers(org_id);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  supplier_id uuid REFERENCES suppliers(id),
  po_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  total_amount numeric(12,2),
  ordered_at timestamp,
  received_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX ON purchase_orders(org_id);
CREATE INDEX ON purchase_orders(supplier_id);

CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  variant_name text,
  sku text,
  quantity integer NOT NULL DEFAULT 1,
  unit_cost numeric(12,2),
  received_quantity integer DEFAULT 0
);
CREATE INDEX ON purchase_order_items(po_id);
