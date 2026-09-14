import express from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import {
  isWebhookEventProcessed,
  recordWebhookEvent,
  listWebhookEvents,
  clearWebhookEvents,
  transitionOrder,
  recordRefund,
  findOrderByPaymentId,
} from '../orderStore.js';

const router = express.Router();

// Webhook event log and processed-event-ID idempotency tracking are
// persisted in SQLite (src/db.js) via src/orderStore.js, so they survive
// a server restart and are shared with the payments/refunds routes.

// Event types that update local order state, and the status they map to.
// payment.authorized/captured and refund.created are handled specially
// below because they also need to update paymentId/refund records.
const EVENT_TO_STATUS = {
  'payment.authorized': 'authorized',
  'payment.captured': 'paid',
  'payment.failed': 'failed',
};

/**
 * Validate Razorpay webhook signature
 * Algorithm: HMAC-SHA256 with webhook_secret as key
 * Message: raw request body (NOT parsed JSON)
 */
function validateWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret) {
    console.warn('⚠️  Webhook secret not configured. Validation skipped.');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === signature;
}

/**
 * POST /api/webhooks/razorpay
 * Receives and validates Razorpay webhook events
 * Required headers:
 *   - X-Razorpay-Signature: webhook signature
 *   - X-Razorpay-Event-Id: unique event identifier (for deduplication)
 */
router.post('/razorpay', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const eventId = req.headers['x-razorpay-event-id'];

    if (!signature) {
      console.error('❌ Webhook rejected: Missing X-Razorpay-Signature header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'X-Razorpay-Signature header is required',
      });
    }

    if (!eventId) {
      console.warn('⚠️  Webhook received without X-Razorpay-Event-Id header');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'X-Razorpay-Event-Id header is required',
      });
    }

    // Check for duplicate webhook event before validation
    if (isWebhookEventProcessed(eventId)) {
      console.log(`ℹ️  Webhook event already processed (idempotent): ${eventId}`);
      return res.status(200).json({
        success: true,
        eventId,
        message: 'Webhook already processed',
      });
    }

    // Validate signature using raw body
    const rawBody = req.body.toString('utf-8');
    const isValid = validateWebhookSignature(rawBody, signature);

    if (!isValid) {
      console.error('❌ Webhook rejected: Invalid signature');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Webhook signature validation failed',
      });
    }

    // Parse the body after signature validation
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error('❌ Webhook rejected: Invalid JSON');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid JSON payload',
      });
    }

    // Extract entity data for logging and state transitions
    const event = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    const refundEntity = payload.payload?.refund?.entity;
    const paymentId = paymentEntity?.id;
    const orderId = paymentEntity?.order_id;
    const amount = paymentEntity?.amount ?? refundEntity?.amount;
    const status = paymentEntity?.status ?? refundEntity?.status;

    // Persist webhook event for audit/debugging (source='real' marks this as
    // an actual Razorpay-delivered event, as opposed to a locally simulated one)
    recordWebhookEvent({
      eventId,
      eventType: event,
      paymentId: paymentId ?? refundEntity?.payment_id,
      orderId,
      amount,
      status,
      source: 'real',
    });

    // Drive local order state from the event, guarded by the state machine
    // (src/stateMachine.js) so an out-of-order or duplicate event cannot
    // regress or corrupt an order that has already moved further along.
    if (event in EVENT_TO_STATUS && orderId) {
      const { applied, reason } = transitionOrder(orderId, EVENT_TO_STATUS[event], {
        paymentId,
        paymentStatus: paymentEntity?.status,
      });
      console.log(
        applied
          ? `✅ Order ${orderId} → ${EVENT_TO_STATUS[event]} (via ${event})`
          : `⚠️  Order ${orderId} state transition skipped (${reason})`
      );
    } else if (event === 'refund.created' && refundEntity) {
      const order = findOrderByPaymentId(refundEntity.payment_id);
      recordRefund({
        refundId: refundEntity.id,
        paymentId: refundEntity.payment_id,
        orderId: order ? order.id : null,
        amount: refundEntity.amount,
        status: refundEntity.status,
      });
      if (order && refundEntity.amount === order.amount) {
        const { applied, reason } = transitionOrder(order.id, 'refunded');
        console.log(
          applied
            ? `💰 Order ${order.id} → refunded (via refund.created)`
            : `⚠️  Order ${order.id} refund transition skipped (${reason})`
        );
      } else {
        console.log(`💰 Refund ${refundEntity.id} recorded for payment ${refundEntity.payment_id}`);
      }
    } else {
      console.log(`📨 Webhook event: ${event} (no local state transition defined)`);
    }

    // Respond with 200 to acknowledge receipt
    res.status(200).json({
      success: true,
      eventId,
      message: 'Webhook received and validated',
    });
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/webhooks/events
 * Retrieve logged webhook events (for testing/debugging only)
 */
router.get('/events', (req, res) => {
  const events = listWebhookEvents(100);
  res.json({
    count: events.length,
    events,
  });
});

/**
 * DELETE /api/webhooks/events
 * Clear webhook event log (for testing/debugging only)
 */
router.delete('/events', (req, res) => {
  const count = clearWebhookEvents();
  res.json({
    message: `Cleared ${count} webhook events`,
  });
});

export default router;
