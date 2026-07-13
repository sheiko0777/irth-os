-- Phase 42: Customer Segments & Tags
CREATE TABLE customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#B0885E',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE TABLE customer_segment_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  segment_id UUID NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (segment_id, customer_id)
);

CREATE INDEX idx_customer_segments_org ON customer_segments(org_id);
CREATE INDEX idx_csm_segment ON customer_segment_members(segment_id);
CREATE INDEX idx_csm_customer ON customer_segment_members(customer_id);
