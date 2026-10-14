import { createHash } from 'node:crypto';
import { PLAN_VERSION, planSnapshot } from './payout-plan.js';

export function freezeCheckout(input, now = new Date()) {
  if (!input.orderId || !input.buyerId || !input.currency) throw new Error('orderId, buyerId, and currency are required');
  if (!Number.isSafeInteger(input.totalMinor) || input.totalMinor <= 0) throw new Error('totalMinor must be a positive safe integer');
  const eligibleAmountMinor = input.eligibleAmountMinor ?? input.totalMinor;
  if (!Number.isSafeInteger(eligibleAmountMinor) || eligibleAmountMinor <= 0 || eligibleAmountMinor > input.totalMinor) {
    throw new Error('eligibleAmountMinor must be a positive safe integer no greater than totalMinor');
  }
  if (input.planVersion && input.planVersion !== PLAN_VERSION) throw new Error(`Retired plan ${input.planVersion} cannot be used for new orders; use ${PLAN_VERSION}`);
  if (!input.selfLinkEvidence?.affiliateId || !input.selfLinkEvidence?.linkId) {
    throw new Error('Affiliate self-link evidence is required at checkout');
  }
  if (input.selfLinkEvidence.affiliateId !== input.buyerId) {
    throw new Error('Self-link evidence affiliate must match buyer');
  }

  const capturedAt = now.toISOString();
  const evidence = {
    affiliateId: input.selfLinkEvidence.affiliateId,
    linkId: input.selfLinkEvidence.linkId,
    source: input.selfLinkEvidence.source ?? 'affiliate-link',
    capturedAt,
    requestId: input.selfLinkEvidence.requestId ?? null,
  };
  const evidenceHash = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const sponsorChain = [...(input.sponsorChain ?? [])].slice(0, 7).map((sponsor) => ({ ...sponsor }));

  return Object.freeze({
    id: input.orderId,
    buyerId: input.buyerId,
    currency: input.currency,
    totalMinor: input.totalMinor,
    frozenEligibleAmountMinor: eligibleAmountMinor,
    status: 'payment_pending',
    planVersion: PLAN_VERSION,
    planSnapshot: planSnapshot(),
    sponsorChain,
    selfLinkEvidence: Object.freeze({ ...evidence, evidenceHash }),
    createdAt: capturedAt,
    version: 1,
  });
}
