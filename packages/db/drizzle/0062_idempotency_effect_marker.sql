-- Recovery-aware idempotency sweeping.
--
-- recovery_tracked defaults false while the column is added so pre-existing
-- in_progress rows remain quarantined: their business outcome cannot be proven.
-- New claims explicitly write true from the application.
ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS recovery_tracked boolean NOT NULL DEFAULT false;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS effect_committed_at timestamp;

CREATE INDEX IF NOT EXISTS idempotency_keys_sweep_idx
  ON idempotency_keys (created_at)
  WHERE state = 'completed'
     OR (state = 'in_progress' AND recovery_tracked = true AND effect_committed_at IS NULL);
