import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeCheckout } from '../src/checkout.js';
import { InMemoryRepository } from '../src/in-memory-repository.js';
import { PayoutEngine } from '../src/payout-engine.js';
import { PLAN_VERSION, PLAN_TOTAL_BPS, LEGACY_PLAN_VERSION } from '../src/payout-plan.js';

const baseCheckout = (overrides = {}) => ({
  orderId: 'order-1',
  buyerId: 'buyer-1',
  currency: 'NGN',
  totalMinor: 100_000,
  eligibleAmountMinor: 100_000,
  selfLinkEvidence: { affiliateId: 'buyer-1', linkId: 'link-123', source: 'affiliate-link', requestId: 'req-1' },
  sponsorChain: [
    { userId: 'sponsor-1' }, { userId: 'sponsor-2' }, { userId: 'sponsor-3' },
    { userId: 'sponsor-4' }, { userId: 'sponsor-5' }, { userId: 'sponsor-6' }, { userId: 'sponsor-7' },
  ],
  ...overrides,
});

function makeEngine() {
  const repository = new InMemoryRepository();
  const engine = new PayoutEngine(repository, {
    clock: () => new Date('2026-10-14T22:00:00.000Z'),
    paymentVerifiers: { paystack: () => true, 'bank-transfer': () => true, wallet: () => true },
  });
  return { repository, engine };
}

test('freezes plan version and self-link evidence at checkout', () => {
  const order = freezeCheckout(baseCheckout(), new Date('2026-10-14T21:00:00.000Z'));
  assert.equal(order.planVersion, PLAN_VERSION);
  assert.equal(order.planSnapshot.totalBps, PLAN_TOTAL_BPS);
  assert.equal(order.selfLinkEvidence.affiliateId, 'buyer-1');
  assert.equal(order.selfLinkEvidence.linkId, 'link-123');
  assert.match(order.selfLinkEvidence.evidenceHash, /^[a-f0-9]{64}$/);
});

test('does not create earnings for failed bank proof', () => {
  const { repository, engine } = makeEngine();
  const order = engine.checkout(baseCheckout());
  assert.throws(() => engine.confirmPayment(order.id, 'bank-transfer', {
    provider: 'bank-transfer', status: 'rejected', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'bank-1', proofId: 'proof-1',
  }), /not approved/);
  assert.equal(repository.listEarnings(Symbol(), order.id).length, 0);
  assert.equal(repository.getOrder(Symbol(), order.id).status, 'payment_pending');
});

test('creates exact 39% multi-tier payouts only after successful Paystack confirmation', () => {
  const { repository, engine } = makeEngine();
  const order = engine.checkout(baseCheckout());
  const result = engine.confirmPayment(order.id, 'paystack', {
    provider: 'paystack', status: 'success', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'ps-1', metadata: { orderId: order.id },
  });
  assert.equal(result.earnings.length, 8);
  assert.deepEqual(result.earnings.map((e) => e.amountMinor), [15_000, 10_000, 4_000, 3_000, 3_000, 2_000, 1_500, 500]);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 39_000);
  assert.equal(repository.walletBalance('buyer-1', 'NGN'), 15_000);
  assert.equal(repository.walletBalance('sponsor-7', 'NGN'), 500);
  assert.equal(repository.getOrder(Symbol(), order.id).status, 'earnings_created');
});

test('is idempotent on repeated payment callbacks and never doubles wallets', () => {
  const { repository, engine } = makeEngine();
  const order = engine.checkout(baseCheckout());
  const payload = { provider: 'wallet', status: 'confirmed', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'wallet-1' };
  const first = engine.confirmPayment(order.id, 'wallet', payload);
  const second = engine.confirmPayment(order.id, 'wallet', payload);
  assert.equal(first.earnings.length, 8);
  assert.equal(second.idempotent, true);
  assert.equal(repository.snapshot().earnings.length, 8);
  assert.equal(repository.snapshot().walletEntries.length, 8);
  assert.equal(repository.walletBalance('buyer-1', 'NGN'), 15_000);
});

test('refund creates one compensating debit set and repeated refund is idempotent', () => {
  const { repository, engine } = makeEngine();
  const order = engine.checkout(baseCheckout());
  engine.confirmPayment(order.id, 'paystack', { provider: 'paystack', status: 'success', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'ps-refund', metadata: { orderId: order.id } });
  const first = engine.reverseOrder(order.id, 'refunded');
  const second = engine.reverseOrder(order.id, 'refunded');
  assert.equal(first.reversals.length, 8);
  assert.equal(second.reversals.length, 0);
  assert.equal(repository.walletBalance('buyer-1', 'NGN'), 0);
  assert.equal(repository.snapshot().earnings.length, 16);
  assert.equal(repository.getOrder(Symbol(), order.id).status, 'refunded');
});

test('chargeback is handled separately and preserves original earnings history', () => {
  const { repository, engine } = makeEngine();
  const order = engine.checkout(baseCheckout({ orderId: 'order-chargeback' }));
  engine.confirmPayment(order.id, 'bank-transfer', { provider: 'bank-transfer', status: 'approved', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'bank-ok', proofId: 'proof-ok' });
  engine.reverseOrder(order.id, 'chargeback');
  const earnings = repository.listEarnings(Symbol(), order.id);
  assert.equal(earnings.filter((e) => e.kind === 'credit').length, 8);
  assert.equal(earnings.filter((e) => e.kind === 'debit').length, 8);
  assert.ok(earnings.filter((e) => e.kind === 'credit').every((e) => e.planVersion === PLAN_VERSION));
});

test('new checkout cannot select the retired 5% plan', () => {
  assert.notEqual(PLAN_VERSION, LEGACY_PLAN_VERSION);
  assert.throws(() => freezeCheckout(baseCheckout({ planVersion: LEGACY_PLAN_VERSION })), /plan/i);
});

test('transaction rollback prevents a mismatched payment from changing the order', () => {
  const { repository, engine } = makeEngine();
  const order = engine.checkout(baseCheckout({ orderId: 'order-mismatch' }));
  assert.throws(() => engine.confirmPayment(order.id, 'paystack', { provider: 'paystack', status: 'success', orderId: order.id, amountMinor: 99_999, currency: 'NGN', reference: 'ps-bad', metadata: { orderId: order.id } }), /amount/);
  assert.equal(repository.snapshot().payments.length, 0);
  assert.equal(repository.getOrder(Symbol(), order.id).status, 'payment_pending');
});

test('requires an injected trusted provider verifier', () => {
  const repository = new InMemoryRepository();
  const engine = new PayoutEngine(repository);
  const order = engine.checkout(baseCheckout({ orderId: 'order-unverified' }));
  assert.throws(() => engine.confirmPayment(order.id, 'wallet', { provider: 'wallet', status: 'confirmed', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'untrusted' }), /verification is required/);
  assert.equal(repository.getOrder(Symbol(), order.id).status, 'payment_pending');
});

test('rejects payment-reference reuse across orders and a second payment on one order', () => {
  const { repository, engine } = makeEngine();
  const first = engine.checkout(baseCheckout({ orderId: 'order-reference-a' }));
  const second = engine.checkout(baseCheckout({ orderId: 'order-reference-b' }));
  const payment = { provider: 'wallet', status: 'confirmed', amountMinor: 100_000, currency: 'NGN', reference: 'shared-reference' };
  engine.confirmPayment(first.id, 'wallet', { ...payment, orderId: first.id });
  assert.throws(() => engine.confirmPayment(second.id, 'wallet', { ...payment, orderId: second.id }), /already bound/);
  assert.throws(() => engine.confirmPayment(first.id, 'wallet', { ...payment, orderId: first.id, reference: 'second-reference' }), /already has a confirmed payment/);
  assert.equal(repository.getOrder(Symbol(), second.id).status, 'payment_pending');
});

test('rejects invalid eligible amounts and supports cancellation before payment', () => {
  const { repository, engine } = makeEngine();
  assert.throws(() => engine.checkout(baseCheckout({ orderId: 'order-invalid-eligible', eligibleAmountMinor: 100_001 })), /eligibleAmountMinor/);
  const order = engine.checkout(baseCheckout({ orderId: 'order-cancelled' }));
  const cancelled = engine.reverseOrder(order.id, 'cancelled');
  assert.equal(cancelled.reversals.length, 0);
  assert.equal(cancelled.order.status, 'cancelled');
  assert.throws(() => engine.confirmPayment(order.id, 'wallet', { provider: 'wallet', status: 'confirmed', orderId: order.id, amountMinor: 100_000, currency: 'NGN', reference: 'late' }), /cancelled/);
});
