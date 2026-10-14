export const PAYMENT_PROVIDERS = Object.freeze({ PAYSTACK: 'paystack', BANK_TRANSFER: 'bank-transfer', WALLET: 'wallet' });

export class PaymentConfirmationError extends Error {
  constructor(message, code = 'PAYMENT_NOT_CONFIRMED') {
    super(message);
    this.name = 'PaymentConfirmationError';
    this.code = code;
  }
}

function requireTrustedVerification(payment, verify) {
  if (typeof verify !== 'function' || verify(payment) !== true) {
    throw new PaymentConfirmationError('Provider verification is required before accepting payment', 'PAYMENT_VERIFICATION_REQUIRED');
  }
}

function assertOrderMatch(order, payment) {
  if (payment.orderId !== order.id) {
    throw new PaymentConfirmationError('Payment does not belong to order', 'PAYMENT_ORDER_MISMATCH');
  }
  if (payment.currency !== order.currency || payment.amountMinor !== order.totalMinor) {
    throw new PaymentConfirmationError('Payment amount or currency does not match order', 'PAYMENT_AMOUNT_MISMATCH');
  }
}

export function confirmPaystack(order, receipt, verify) {
  requireTrustedVerification(receipt, verify);
  if (receipt.provider !== PAYMENT_PROVIDERS.PAYSTACK || receipt.status !== 'success') {
    throw new PaymentConfirmationError('Paystack transaction is not successful');
  }
  if (receipt.metadata?.orderId !== order.id || receipt.reference == null) {
    throw new PaymentConfirmationError('Paystack metadata/reference is invalid', 'PAYMENT_METADATA_INVALID');
  }
  assertOrderMatch(order, receipt);
  return normalize(order, receipt, receipt.reference);
}

export function confirmBankTransfer(order, proof, verify) {
  requireTrustedVerification(proof, verify);
  if (proof.provider !== PAYMENT_PROVIDERS.BANK_TRANSFER || proof.status !== 'approved') {
    throw new PaymentConfirmationError('Bank transfer proof is not approved', 'BANK_PROOF_NOT_APPROVED');
  }
  if (!proof.reference || !proof.proofId) {
    throw new PaymentConfirmationError('Bank transfer proof/reference is missing', 'BANK_PROOF_INVALID');
  }
  assertOrderMatch(order, proof);
  return normalize(order, proof, proof.reference);
}

export function confirmWallet(order, transfer, verify) {
  requireTrustedVerification(transfer, verify);
  if (transfer.provider !== PAYMENT_PROVIDERS.WALLET || transfer.status !== 'confirmed') {
    throw new PaymentConfirmationError('Wallet transfer is not confirmed');
  }
  if (!transfer.reference) {
    throw new PaymentConfirmationError('Wallet transfer reference is missing', 'WALLET_REFERENCE_INVALID');
  }
  assertOrderMatch(order, transfer);
  return normalize(order, transfer, transfer.reference);
}

function normalize(order, payment, providerReference) {
  return Object.freeze({
    id: payment.id ?? `${payment.provider}:${providerReference}`,
    orderId: order.id,
    provider: payment.provider,
    providerReference,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    confirmedAt: payment.confirmedAt ?? new Date().toISOString(),
    rawStatus: payment.status,
    providerMetadata: payment.proofId ? { proofId: payment.proofId } : null,
  });
}
