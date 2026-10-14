export class InMemoryRepository {
  constructor() {
    this.state = { orders: new Map(), payments: new Map(), earnings: new Map(), walletEntries: new Map() };
  }

  transaction(work) {
    const snapshot = cloneState(this.state);
    const tx = Symbol('transaction');
    try {
      const result = work(tx);
      return result;
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  createOrder(_tx, order) {
    if (this.state.orders.has(order.id)) throw new Error(`Order already exists: ${order.id}`);
    this.state.orders.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  getOrder(_tx, id) { return clone(this.state.orders.get(id)); }

  recordPayment(_tx, payment) {
    const existing = [...this.state.payments.values()].find((item) => item.provider === payment.provider && item.providerReference === payment.providerReference);
    if (existing) {
      if (existing.orderId !== payment.orderId || existing.amountMinor !== payment.amountMinor || existing.currency !== payment.currency) {
        throw new Error('Payment reference is already bound to a different order or amount');
      }
      return clone(existing);
    }
    const orderPayment = [...this.state.payments.values()].find((item) => item.orderId === payment.orderId);
    if (orderPayment) throw new Error('Order already has a confirmed payment');
    this.state.payments.set(payment.id, structuredClone(payment));
    return clone(payment);
  }

  markOrderPaid(_tx, orderId, confirmedAt) {
    const order = this.state.orders.get(orderId);
    order.status = 'paid';
    order.paidAt = confirmedAt;
    order.version += 1;
  }

  insertEarning(_tx, earning) {
    const existing = [...this.state.earnings.values()].find((item) => item.idempotencyKey === earning.idempotencyKey);
    if (existing) return { created: false, record: clone(existing) };
    const record = structuredClone(earning);
    this.state.earnings.set(record.id, record);
    const walletKey = `${record.userId}:${record.id}`;
    this.state.walletEntries.set(walletKey, {
      id: walletKey,
      userId: record.userId,
      earningId: record.id,
      amountMinor: record.amountMinor,
      currency: record.currency,
      kind: record.kind,
      createdAt: record.createdAt,
    });
    return { created: true, record: clone(record) };
  }

  markEarningsCreated(_tx, orderId) {
    const order = this.state.orders.get(orderId);
    order.status = 'earnings_created';
    order.version += 1;
  }

  listEarnings(_tx, orderId) { return [...this.state.earnings.values()].filter((item) => item.orderId === orderId).map(clone); }

  markOrderReversed(_tx, orderId, reason, reversedAt = new Date().toISOString()) {
    const order = this.state.orders.get(orderId);
    order.status = reason;
    order.reversedAt = reversedAt;
    order.version += 1;
  }

  walletBalance(userId, currency) {
    return [...this.state.walletEntries.values()]
      .filter((entry) => entry.userId === userId && entry.currency === currency)
      .reduce((sum, entry) => sum + entry.amountMinor, 0);
  }

  snapshot() {
    return {
      orders: [...this.state.orders.values()].map(clone),
      payments: [...this.state.payments.values()].map(clone),
      earnings: [...this.state.earnings.values()].map(clone),
      walletEntries: [...this.state.walletEntries.values()].map(clone),
    };
  }
}

function clone(value) { return value == null ? value : structuredClone(value); }
function cloneState(state) {
  return {
    orders: new Map([...state.orders].map(([key, value]) => [key, structuredClone(value)])),
    payments: new Map([...state.payments].map(([key, value]) => [key, structuredClone(value)])),
    earnings: new Map([...state.earnings].map(([key, value]) => [key, structuredClone(value)])),
    walletEntries: new Map([...state.walletEntries].map(([key, value]) => [key, structuredClone(value)])),
  };
}
