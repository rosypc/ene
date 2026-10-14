-- PostgreSQL migration. Existing historic rows are preserved; no UPDATE rewrites legacy earnings.
CREATE TABLE IF NOT EXISTS payout_orders (
  id text PRIMARY KEY,
  buyer_id text NOT NULL,
  currency text NOT NULL,
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  frozen_eligible_amount_minor bigint NOT NULL CHECK (frozen_eligible_amount_minor > 0 AND frozen_eligible_amount_minor <= total_minor),
  plan_version text NOT NULL,
  plan_snapshot jsonb NOT NULL,
  sponsor_chain jsonb NOT NULL,
  self_link_evidence jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('payment_pending','paid','earnings_created','cancelled','refunded','chargeback')),
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  reversed_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payout_payments (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES payout_orders(id),
  provider text NOT NULL CHECK (provider IN ('paystack','bank-transfer','wallet')),
  provider_reference text NOT NULL,
  proof_id text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  raw_status text NOT NULL,
  UNIQUE (provider, provider_reference),
  UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS payout_earnings (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  order_id text NOT NULL REFERENCES payout_orders(id),
  payment_id text NOT NULL REFERENCES payout_payments(id),
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('credit','debit')),
  role text NOT NULL,
  level smallint NOT NULL,
  rate_bps integer NOT NULL,
  amount_minor bigint NOT NULL CHECK ((kind = 'credit' AND amount_minor > 0) OR (kind = 'debit' AND amount_minor < 0)),
  currency text NOT NULL,
  plan_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('posted','voided')),
  reason text,
  reverses_earning_id text REFERENCES payout_earnings(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  earning_id text NOT NULL UNIQUE REFERENCES payout_earnings(id),
  amount_minor bigint NOT NULL CHECK ((kind = 'credit' AND amount_minor > 0) OR (kind = 'debit' AND amount_minor < 0)),
  currency text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('credit','debit')),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS payout_earnings_order_idx ON payout_earnings(order_id);
CREATE INDEX IF NOT EXISTS payout_earnings_user_idx ON payout_earnings(user_id, created_at);

-- New-order guard: application checkout must use this version. Historic legacy rows remain queryable.
COMMENT ON TABLE payout_earnings IS 'Append-only earnings ledger. Legacy 5% rows are retained; new orders use self-purchase-15-39-v1 only.';
