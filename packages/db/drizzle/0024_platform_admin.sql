CREATE TABLE org_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'starter',
  is_active BOOLEAN NOT NULL DEFAULT true,
  enabled_screens TEXT[] NOT NULL DEFAULT '{}',
  disabled_screens TEXT[] NOT NULL DEFAULT '{}',
  dashboard_widgets JSONB NOT NULL DEFAULT '[]',
  custom_rbac JSONB NOT NULL DEFAULT '{}',
  max_users INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_org_feature_flags_org ON org_feature_flags(org_id);
