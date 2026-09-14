import express from 'express';
import Razorpay from 'razorpay';
import { config } from '../config.js';
import { recordRefund, findOrderByPaymentId, transitionOrder } from '../orderStore.js';

const router = express.Router();

/**
 * Sanitize Razorpay API errors before sending to client
 * Logs full error server-side, returns safe message to client
 */
function sanitizeRazorpayError(error, context) {
  // DEF-001: the razorpay SDK (v2.9.8) does not always set a top-level
  // `.message` - API errors are thrown as { statusCode, error: { description,
  // code, ... } } with `.message` undefined. Fall back to `.error.description`
  // so pattern matching below still works, and so `fullMessage` is always a
  // string (never undefined) for every caller of this function.
  const fullMessage = error.message || error.error?.description || '';

  // Log full error for debugging (never leaked to the client)
  console.error(`[${context}] Razorpay error:`, fullMessage || '(no message provided by SDK)', '| statusCode:', error.statusCode);

  // Return safe client-facing message based on error pattern
  if (fullMessage.includes('payment not found') || fullMessage.includes('Invalid payment')) {
    return 'Payment not found.';
  }
  if (fullMessage.includes('cannot refund') || fullMessage.includes('Refund not allowed')) {
    return 'Payment cannot be refunded (must be in captured state).';
  }
  if (fullMessage.includes('Invalid amount') || fullMessage.includes('greater than amount captured')) {
    return 'Invalid refund amount.';
  }
  if (fullMessage.includes('timeout') || fullMessage.includes('ECONNREFUSED')) {
    return 'Payment gateway unavailable. Please try again.';
  }
  if (fullMessage.includes('Invalid key') || fullMessage.includes('Unauthorized')) {
    return 'Payment gateway error. Please try again later.';
  }

  // Default safe message
  return 'Operation failed. Please try again.';
}

// Refund records are persisted in SQLite (src/db.js) via src/orderStore.js

// Initialize Razorpay instance
let razorpayInstance;
if (config.razorpay.keyId && config.razorpay.keySecret) {
  razorpayInstance = new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret,
  });
}

/**
 * POST /api/refunds/create
 * Create a refund for a captured payment
 * Body: { paymentId, amount (optional), notes (optional) }
 * If amount is omitted, full refund is created
 */
router.post('/create', async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({
        error: 'Razorpay not configured',
        message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment',
      });
    }

    const { paymentId, amount, notes } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'paymentId is required',
      });
    }

    // Prepare refund request
    const refundData = {};
    if (amount) {
      refundData.amount = amount;
    }
    if (notes) {
      refundData.notes = notes;
    }

    // Create refund via Razorpay API
    const refund = await razorpayInstance.payments.refund(paymentId, refundData);

    // Store refund locally (persisted in SQLite)
    const order = findOrderByPaymentId(refund.payment_id);
    recordRefund({
      refundId: refund.id,
      paymentId: refund.payment_id,
      orderId: order ? order.id : null,
      amount: refund.amount,
      status: refund.status,
    });

    // A full refund (amount matches the order's original amount) moves the
    // order to 'refunded'. A partial refund is recorded but the order stays
    // 'paid' since Razorpay does not report a distinct "partially refunded"
    // order status.
    if (order && refund.amount === order.amount) {
      const { applied, reason } = transitionOrder(order.id, 'refunded');
      if (!applied) {
        console.warn(`⚠️  Refund state transition not applied for order ${order.id}: ${reason}`);
      }
    }

    res.json({
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      message: 'Refund initiated',
    });
  } catch (error) {
    const safeMessage = sanitizeRazorpayError(error, 'create-refund');
    // DEF-001 fix: error.message is not guaranteed to exist on SDK errors, so
    // never call string methods on it directly. Prefer the SDK-reported HTTP
    // status when it looks like a real status code; default to 400 otherwise
    // (same default the old, crash-prone code fell back to).
    const statusCode = error.statusCode === 404 ? 404 : 400;

    res.status(statusCode).json({
      error: 'Refund creation failed',
      message: safeMessage,
    });
  }
});

/**
 * GET /api/refunds/:refundId
 * Fetch refund status from Razorpay
 */
router.get('/:refundId', async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({
        error: 'Razorpay not configured',
        message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment',
      });
    }

    const { refundId } = req.params;
    const refund = await razorpayInstance.refunds.fetch(refundId);

    res.json({
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      createdAt: new Date(refund.created_at * 1000),
    });
  } catch (error) {
    const safeMessage = sanitizeRazorpayError(error, 'fetch-refund');
    res.status(404).json({
      error: 'Refund not found',
      message: safeMessage,
    });
  }
});

/**
 * GET /api/refunds/payment/:paymentId
 * Fetch all refunds for a payment
 */
router.get('/payment/:paymentId', async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({
        error: 'Razorpay not configured',
        message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment',
      });
    }

    const { paymentId } = req.params;
    const refundsList = await razorpayInstance.payments.refunds(paymentId);

    res.json({
      paymentId,
      refunds: refundsList.items.map(r => ({
        refundId: r.id,
        amount: r.amount,
        status: r.status,
        createdAt: new Date(r.created_at * 1000),
      })),
      total: refundsList.count,
    });
  } catch (error) {
    const safeMessage = sanitizeRazorpayError(error, 'fetch-payment-refunds');
    res.status(404).json({
      error: 'Failed to fetch refunds',
      message: safeMessage,
    });
  }
});

export default router;
