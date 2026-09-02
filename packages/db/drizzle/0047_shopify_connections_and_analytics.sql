CREATE TABLE IF NOT EXISTS shopify_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  shop_domain text NOT NULL,
  shop_id text,
  access_token_ciphertext text NOT NULL,
  access_token_iv text NOT NULL,
  scopes text NOT NULL,
  api_version text NOT NULL,
  inventory_location_id text,
  status text NOT NULL DEFAULT 'active',
  pixel_ingestion_key text NOT NULL,
  installed_at timestamp NOT NULL DEFAULT now(),
  last_sync_at timestamp,
  last_webhook_at timestamp,
  last_error text,
  uninstalled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS shopify_connections_org_id_idx ON shopify_connections(org_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS shopify_connections_shop_domain_idx ON shopify_connections(shop_domain);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  state_hash text NOT NULL UNIQUE,
  shop_domain text NOT NULL,
  expires_at timestamp NOT NULL,
  consumed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS shopify_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  connection_id uuid REFERENCES shopify_connections(id),
  webhook_id text NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received',
  error text,
  received_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS shopify_webhook_deliveries_connection_webhook_idx ON shopify_webhook_deliveries(connection_id, webhook_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shopify_webhook_deliveries_org_received_idx ON shopify_webhook_deliveries(org_id, received_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS storefront_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  connection_id uuid NOT NULL REFERENCES shopify_connections(id),
  client_id_hash text NOT NULL,
  customer_id uuid,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  landing_path text,
  referrer_host text,
  source text,
  medium text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS storefront_sessions_connection_client_idx ON storefront_sessions(connection_id, client_id_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS storefront_sessions_org_seen_idx ON storefront_sessions(org_id, last_seen_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS storefront_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  connection_id uuid NOT NULL REFERENCES shopify_connections(id),
  session_id uuid NOT NULL REFERENCES storefront_sessions(id),
  event_id text NOT NULL,
  event_name text NOT NULL,
  occurred_at timestamp NOT NULL,
  path text,
  product_id text,
  variant_id text,
  search_term text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS storefront_events_connection_event_idx ON storefront_events(connection_id, event_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS storefront_events_org_occurred_idx ON storefront_events(org_id, occurred_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS storefront_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  metric_date timestamp NOT NULL,
  metric text NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  value integer NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS storefront_daily_metrics_org_date_metric_idx ON storefront_daily_metrics(org_id, metric_date, metric);
