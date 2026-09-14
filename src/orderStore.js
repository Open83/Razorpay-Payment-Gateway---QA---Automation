import { db } from './db.js';
import { canTransition } from './stateMachine.js';

/**
 * Shared order/payment/refund/webhook persistence, backed by SQLite.
 * Used by both the payments route (order creation, verify) and the
 * webhooks route (event-driven state updates) so the two stay in sync.
 */

export function createOrder(order) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO orders (id, amount, currency, status, payment_id, payment_status, receipt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(order.id, order.amount, order.currency, order.status, null, null, order.receipt, now, now);
  return getOrder(order.id);
}

export function getOrder(orderId) {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  return row || null;
}

/**
 * Apply a state change to an order, guarded by the state machine so an
 * out-of-order or contradictory event cannot regress a further-along order.
 * Returns { applied: boolean, order, reason? }.
 */
export function transitionOrder(orderId, nextStatus, fields = {}) {
  const order = getOrder(orderId);
  if (!order) {
    return { applied: false, order: null, reason: 'order_not_found' };
  }

  if (!canTransition(order.status, nextStatus)) {
    return { applied: false, order, reason: `illegal_transition:${order.status}->${nextStatus}` };
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE orders SET status = ?, payment_id = COALESCE(?, payment_id), payment_status = COALESCE(?, payment_status), updated_at = ?
     WHERE id = ?`
  ).run(nextStatus, fields.paymentId ?? null, fields.paymentStatus ?? null, now, orderId);

  return { applied: true, order: getOrder(orderId) };
}

export function recordRefund(refund) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO refunds (refund_id, payment_id, order_id, amount, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(refund.refundId, refund.paymentId, refund.orderId ?? null, refund.amount, refund.status, now);
}

export function getRefundsForPayment(paymentId) {
  return db.prepare('SELECT * FROM refunds WHERE payment_id = ?').all(paymentId);
}

export function findOrderByPaymentId(paymentId) {
  const row = db.prepare('SELECT * FROM orders WHERE payment_id = ?').get(paymentId);
  return row || null;
}

// --- Webhook idempotency + audit log ---

export function isWebhookEventProcessed(eventId) {
  return !!db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(eventId);
}

export function recordWebhookEvent(event) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO webhook_events (event_id, event_type, payment_id, order_id, amount, status, source, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.eventId,
    event.eventType ?? null,
    event.paymentId ?? null,
    event.orderId ?? null,
    event.amount ?? null,
    event.status ?? null,
    event.source ?? 'unknown',
    now
  );
}

export function listWebhookEvents(limit = 50) {
  return db.prepare('SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT ?').all(limit);
}

export function clearWebhookEvents() {
  const { changes } = db.prepare('DELETE FROM webhook_events').run();
  return changes;
}
