# SKYWAY TEAM AFRICA — Self-Purchase Payout Engine

This repository contains the production payout-engine core for the **15% / 39% Self-Purchase Plan**.

## Implemented controls

- Frozen checkout plan version, eligible amount, sponsor chain, and Affiliate self-link evidence.
- Payment confirmation gates for Paystack, approved bank transfers, and confirmed wallets.
- Multi-tier payouts: buyer 15%, direct sponsor 10%, then levels 2–7 at 4%, 3%, 3%, 2%, 1.5%, and 0.5%.
- Legacy 5% retirement for new orders while historic rows remain untouched.
- Append-only earning and wallet-ledger records with provider-reference and earning-idempotency uniqueness.
- Exactly-once compensating debits for cancellation/refund/chargeback paths.
- Rejected/failed bank proof creates no earnings.
- Controlled tests covering successful payments, repeated callbacks, rollback, refunds, and chargebacks.

## Validate

```bash
npm test
```

The SQL migration is in [`sql/001_payout_engine.sql`](sql/001_payout_engine.sql). The final activation payload is in [`docs/activation-payload.json`](docs/activation-payload.json). Production activation remains a gated operational action: apply the migration, configure provider secrets and webhook verification, run provider test-mode transactions/refunds, reconcile the ledger, then set `activePlanVersion` to `self-purchase-15-39-v1`.

See [`docs/payout-engine.md`](docs/payout-engine.md) for invariants and rollout guidance.
