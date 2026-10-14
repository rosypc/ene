import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaystackWebhook({ rawBody, signature, secret }) {
  if (!rawBody || !signature || !secret) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const actual = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export function verifyAuthoritativeTransfer(received, authoritative) {
  return Boolean(
    authoritative &&
    received.provider === authoritative.provider &&
    received.orderId === authoritative.orderId &&
    received.reference === authoritative.reference &&
    received.amountMinor === authoritative.amountMinor &&
    received.currency === authoritative.currency &&
    ['approved', 'confirmed'].includes(authoritative.status),
  );
}
