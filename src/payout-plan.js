export const PLAN_VERSION = 'self-purchase-15-39-v1';
export const LEGACY_PLAN_VERSION = 'legacy-5-percent';

export const PAYOUT_TIERS = Object.freeze([
  Object.freeze({ role: 'buyer', level: 0, rateBps: 1500 }),
  Object.freeze({ role: 'direct-sponsor', level: 1, rateBps: 1000 }),
  Object.freeze({ role: 'upline', level: 2, rateBps: 400 }),
  Object.freeze({ role: 'upline', level: 3, rateBps: 300 }),
  Object.freeze({ role: 'upline', level: 4, rateBps: 300 }),
  Object.freeze({ role: 'upline', level: 5, rateBps: 200 }),
  Object.freeze({ role: 'upline', level: 6, rateBps: 150 }),
  Object.freeze({ role: 'upline', level: 7, rateBps: 50 }),
]);

export const PLAN_TOTAL_BPS = PAYOUT_TIERS.reduce((sum, tier) => sum + tier.rateBps, 0);

if (PLAN_TOTAL_BPS !== 3900) {
  throw new Error(`Invalid payout plan total: ${PLAN_TOTAL_BPS} bps`);
}

export function calculateMinorUnits(amountMinor, rateBps) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error('amountMinor must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) {
    throw new Error('rateBps must be a non-negative safe integer');
  }
  const result = (BigInt(amountMinor) * BigInt(rateBps)) / 10_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('calculated payout exceeds safe integer range');
  return Number(result);
}

export function planSnapshot() {
  return Object.freeze({
    version: PLAN_VERSION,
    basis: 'order.frozenEligibleAmountMinor',
    tiers: PAYOUT_TIERS.map((tier) => ({ ...tier })),
    totalBps: PLAN_TOTAL_BPS,
    legacyRuleRetiredForNewOrders: true,
  });
}
