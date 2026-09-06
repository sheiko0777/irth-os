ALTER TABLE inventory_items ADD COLUMN last_shopify_inventory_event_at timestamptz;

CREATE TABLE inventory_level_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  location_id text NOT NULL,
  irth_quantity integer NOT NULL,
  shopify_quantity integer NOT NULL,
  event_at timestamptz NOT NULL,
  status discrepancy_status NOT NULL DEFAULT 'open',
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_level_discrepancies_org_id_idx ON inventory_level_discrepancies(org_id);
CREATE INDEX inventory_level_discrepancies_org_id_status_idx ON inventory_level_discrepancies(org_id, status);
ALTER TABLE inventory_level_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_level_discrepancies FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_level_discrepancies_tenant_isolation ON inventory_level_discrepancies
  USING (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid)
  WITH CHECK (org_id = NULLIF((SELECT current_setting('app.org_id', true)), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_level_discrepancies TO irth_app;
