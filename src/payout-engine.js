import { createHash } from 'node:crypto';
import { freezeCheckout } from './checkout.js';
import { PLAN_VERSION, calculateMinorUnits } from './payout-plan.js';
import { confirmBankTransfer, confirmPaystack, confirmWallet } from './payment-confirmation.js';

const CONFIRMERS = { paystack: confirmPaystack, 'bank-transfer': confirmBankTransfer, wallet: confirmWallet };
const REVERSAL_STATUSES = new Set(['cancelled', 'refunded', 'chargeback']);

export class PayoutEngine {
  constructor(repository, { clock = () => new Date(), paymentVerifiers = {} } = {}) {
    this.repository = repository;
    this.clock = clock;
    this.paymentVerifiers = paymentVerifiers;
  }

  checkout(input) {
    return this.repository.transaction((tx) => {
      const order = this.repository.createOrder(tx, freezeCheckout(input, this.clock()));
      return order;
    });
  }

  confirmPayment(orderId, provider, payload) {
    return this.repository.transaction((tx) => {
      const order = this.repository.getOrder(tx, orderId);
      if (!order) throw new Error(`Order not found: ${orderId}`);
      if (order.status === 'cancelled' || order.status === 'refunded' || order.status === 'chargeback') {
        throw new Error(`Cannot confirm payment for ${order.status} order`);
      }
      const confirmer = CONFIRMERS[provider];
      if (!confirmer) throw new Error(`Unsupported payment provider: ${provider}`);
      const confirmation = confirmer(order, payload, this.paymentVerifiers[provider]);
      const payment = this.repository.recordPayment(tx, confirmation);
      if (order.status === 'paid' || order.status === 'earnings_created') {
        return { order: this.repository.getOrder(tx, orderId), payment, earnings: this.repository.listEarnings(tx, orderId), idempotent: true };
      }
      this.repository.markOrderPaid(tx, orderId, confirmation.confirmedAt);
      const earnings = this.createEarnings(tx, orderId, confirmation.id);
      return { order: this.repository.getOrder(tx, orderId), payment, earnings, idempotent: false };
    });
  }

  createEarnings(tx, orderId, paymentId) {
    const order = this.repository.getOrder(tx, orderId);
    const frozenTiers = order.planSnapshot?.tiers;
    if (order.planVersion == null || !Array.isArray(frozenTiers)) throw new Error('Order is missing its frozen payout plan');
    const recipients = [{ userId: order.buyerId, level: 0 }, ...order.sponsorChain.map((sponsor, index) => ({ userId: sponsor.userId, level: index + 1 }))];
    const created = [];
    for (const tier of frozenTiers) {
      const recipient = recipients.find((candidate) => candidate.level === tier.level);
      if (!recipient?.userId || recipient.userId === order.buyerId && tier.level !== 0) continue;
      const amountMinor = calculateMinorUnits(order.frozenEligibleAmountMinor, tier.rateBps);
      if (amountMinor === 0) continue;
      const idempotencyKey = `${order.id}:${PLAN_VERSION}:credit:${recipient.userId}:${tier.level}`;
      const earning = this.repository.insertEarning(tx, {
        id: stableId(idempotencyKey),
        idempotencyKey,
        orderId: order.id,
        paymentId,
        userId: recipient.userId,
        kind: 'credit',
        role: tier.role,
        level: tier.level,
        rateBps: tier.rateBps,
        amountMinor,
        currency: order.currency,
        planVersion: order.planVersion,
        status: 'posted',
        createdAt: this.clock().toISOString(),
      });
      if (earning.created) created.push(earning.record);
    }
    this.repository.markEarningsCreated(tx, order.id);
    return created.length ? created : this.repository.listEarnings(tx, order.id);
  }

  reverseOrder(orderId, reason) {
    if (!REVERSAL_STATUSES.has(reason)) throw new Error(`Unsupported reversal reason: ${reason}`);
    return this.repository.transaction((tx) => {
      const order = this.repository.getOrder(tx, orderId);
      if (!order) throw new Error(`Order not found: ${orderId}`);
      if (order.status === reason) return { order, reversals: [], idempotent: true };
      if (order.status === 'payment_pending') {
        if (reason !== 'cancelled') throw new Error(`Cannot ${reason} an unpaid order`);
        this.repository.markOrderReversed(tx, order.id, reason, this.clock().toISOString());
        return { order: this.repository.getOrder(tx, order.id), reversals: [], idempotent: false };
      }
      if (REVERSAL_STATUSES.has(order.status)) throw new Error(`Order is already ${order.status}`);
      if (!['paid', 'earnings_created'].includes(order.status)) throw new Error(`Cannot reverse order in ${order.status} state`);
      const earnings = this.repository.listEarnings(tx, orderId).filter((earning) => earning.kind === 'credit' && earning.status === 'posted');
      const reversals = [];
      for (const earning of earnings) {
        const idempotencyKey = `${earning.id}:${reason}:debit`;
        const reversal = this.repository.insertEarning(tx, {
          id: stableId(idempotencyKey),
          idempotencyKey,
          orderId: order.id,
          paymentId: earning.paymentId,
          userId: earning.userId,
          kind: 'debit',
          role: earning.role,
          level: earning.level,
          rateBps: earning.rateBps,
          amountMinor: -earning.amountMinor,
          currency: earning.currency,
          planVersion: earning.planVersion,
          status: 'posted',
          reason,
          reversesEarningId: earning.id,
          createdAt: this.clock().toISOString(),
        });
        if (reversal.created) reversals.push(reversal.record);
      }
      this.repository.markOrderReversed(tx, order.id, reason, this.clock().toISOString());
      return { order: this.repository.getOrder(tx, order.id), reversals, idempotent: reversals.length === 0 };
    });
  }
}

function stableId(value) {
  return createHash('sha256').update(value).digest('hex');
}
