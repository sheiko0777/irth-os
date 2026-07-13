-- Phase 37: Gift Cards & Store Credit
CREATE TYPE gift_card_status AS ENUM ('active', 'redeemed', 'expired', 'cancelled');
CREATE TYPE gift_card_tx_type AS ENUM ('issue', 'redeem', 'topup', 'refund', 'expire', 'cancel');

CREATE TABLE gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  initial_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  status gift_card_status NOT NULL DEFAULT 'active',
  customer_id UUID,
  recipient_name TEXT,
  recipient_email TEXT,
  message TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, code)
);

CREATE TABLE gift_card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  tx_type gift_card_tx_type NOT NULL,
  order_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
