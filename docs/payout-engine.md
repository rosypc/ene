# Production Payout Engine

## Frozen plan

`self-purchase-15-39-v1` is the only plan used for new orders. The basis is the order's frozen eligible amount in minor currency units. Rates are:

- Buyer: 15%
- Direct sponsor (level 1): 10%
- Levels 2-7: 4%, 3%, 3%, 2%, 1.5%, 0.5%

The total is 39%. Historic 5% earnings are never recalculated or rewritten. The legacy rule is not selectable for new orders.

## Activation sequence

1. Deploy the migration and application code.
2. Configure provider credentials and webhook signature verification in the host secret manager.
3. Run controlled payment/refund/chargeback tests in each provider's test mode.
4. Reconcile the expected ledger totals and confirm failed bank proofs create no earnings.
5. Activate the plan by setting `activePlanVersion` to `self-purchase-15-39-v1` only after the test report is accepted.

No production activation is performed by this package. The exported `activationPayload` is the final review payload.

## Invariants

- Checkout freezes plan version, eligible amount, sponsor chain, and self-link evidence.
- A payment must be confirmed and match the order before earnings are created.
- Payment provider references and earning idempotency keys are unique.
- Refunds, chargebacks, and cancellations create compensating negative ledger entries exactly once.
- Failed or rejected bank proofs never create earnings.
- Wallet balances are derived from the append-only wallet ledger; every credit/debit has an earning reference.
