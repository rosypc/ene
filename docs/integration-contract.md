# Production integration contract

The repository is intentionally dependency-free. `PayoutEngine` runs inside one database transaction supplied by the repository implementation. The production repository must implement the methods used by `InMemoryRepository` and enforce the SQL uniqueness constraints in `sql/001_payout_engine.sql`.

## Provider trust boundary

`PayoutEngine` refuses payment confirmation unless a provider-specific verifier function is injected for `paystack`, `bank-transfer`, and `wallet`. These functions must call the provider or an authoritative internal payment service and return `true` only after validating the raw event, signature, order reference, amount, currency, and settlement state.

- Paystack webhooks can use `verifyPaystackWebhook({ rawBody, signature, secret })` and should additionally verify the transaction through Paystack before returning the normalized receipt.
- Bank transfers must verify an approved proof record from the bank/reconciliation service. The proof ID is retained in payment metadata.
- Wallet transfers must verify an authoritative internal wallet transfer, not a client-supplied status.

A verifier must not trust `status`, `reference`, or `amount` from an untrusted browser request.

## Transaction boundary

Checkout freezes its snapshot before persistence. Payment confirmation, payment insert, order state transition, earning inserts, and wallet-ledger inserts must commit or roll back together. Use row locking or optimistic version checks on the order and rely on the unique provider/order/idempotency constraints for concurrent callbacks.

The in-memory repository is a deterministic test harness, not a production datastore.
