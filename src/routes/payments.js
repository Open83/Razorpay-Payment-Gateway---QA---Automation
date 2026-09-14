import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config.js';
import { createOrder, getOrder, transitionOrder } from '../orderStore.js';

const router = express.Router();

/**
 * Verify Razorpay payment signature using HMAC-SHA256
 * Format: hmac_sha256(orderId|paymentId, keySecret)
 * Based on: https://razorpay.com/docs/payments/
 */
function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!config.razorpay.keySecret) {
    console.warn('⚠️  RAZORPAY_KEY_SECRET not configured. Signature verification will fail.');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expectedSignature === signature;
}

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
  if (fullMessage.includes('Invalid key') || fullMessage.includes('Unauthorized') || fullMessage.includes('Authentication')) {
    return 'Payment gateway error. Please try again later.';
  }
  if (fullMessage.includes('payment not found') || fullMessage.includes('Invalid payment')) {
    return 'Payment not found.';
  }
  if (fullMessage.includes('cannot refund') || fullMessage.includes('Refund not allowed')) {
    return 'Payment cannot be refunded (must be in captured state).';
  }
  if (fullMessage.includes('Invalid amount')) {
    return 'Invalid refund amount.';
  }
  if (fullMessage.includes('timeout') || fullMessage.includes('ECONNREFUSED')) {
    return 'Payment gateway unavailable. Please try again.';
  }

  // Default safe message
  return 'Operation failed. Please try again.';
}

// Order states: 'created' → 'paid'/'authorized' → 'refunded' or 'created' → 'failed'
// Persisted in SQLite (src/db.js) via src/orderStore.js so webhook-driven
// state changes (src/routes/webhooks.js) stay in sync with API-driven ones.

// Initialize Razorpay instance
let razorpayInstance;
if (config.razorpay.keyId && config.razorpay.keySecret) {
  razorpayInstance = new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret,
  });
}

/**
 * GET /api/payments/config
 * Returns public configuration (key ID only, no secrets)
 */
router.get('/config', (req, res) => {
  res.json({
    keyId: config.razorpay.keyId || 'NOT_CONFIGURED',
    currency: config.demo.currency,
    configured: !!config.razorpay.keyId,
  });
});

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order for the demo product
 * Returns: { orderId, amount, currency, productName }
 */
router.post('/create-order', async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({
        error: 'Razorpay not configured',
        message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment',
      });
    }

    const orderData = {
      amount: config.demo.amountInPaise,
      currency: config.demo.currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        productName: config.demo.productName,
        environment: config.app.nodeEnv,
      },
    };

    // Create order via Razorpay API
    const order = await razorpayInstance.orders.create(orderData);

    // Store order locally for verification (persisted in SQLite)
    createOrder({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      receipt: order.receipt,
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      productName: config.demo.productName,
      status: 'order_created',
    });
  } catch (error) {
    const safeMessage = sanitizeRazorpayError(error, 'create-order');
    res.status(400).json({
      error: 'Failed to create order',
      message: safeMessage,
    });
  }
});

/**
 * POST /api/payments/verify
 * Verifies a payment after checkout
 * Body: { orderId, paymentId, signature }
 * Returns: { verified, paymentDetails }
 */
router.post('/verify', async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({
        error: 'Razorpay not configured',
        message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment',
      });
    }

    const { orderId, paymentId, signature } = req.body;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'orderId, paymentId, and signature are required',
      });
    }

    // Verify payment signature using HMAC-SHA256
    const isSignatureValid = verifyPaymentSignature(orderId, paymentId, signature);
    if (!isSignatureValid) {
      console.error(`❌ Signature verification failed for payment ${paymentId}`);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Payment signature verification failed',
      });
    }

    // Fetch payment details from Razorpay
    const payment = await razorpayInstance.payments.fetch(paymentId);

    // Verify order exists and amount matches
    const storedOrder = getOrder(orderId);
    if (!storedOrder) {
      return res.status(404).json({
        error: 'Order not found',
        message: `Order ${orderId} not found in system`,
      });
    }

    if (payment.amount !== storedOrder.amount) {
      return res.status(400).json({
        error: 'Amount mismatch',
        message: `Payment amount ${payment.amount} does not match order amount ${storedOrder.amount}`,
      });
    }

    // Verify payment is captured/authorized
    if (!['captured', 'authorized'].includes(payment.status)) {
      return res.status(400).json({
        error: 'Payment not captured',
        message: `Payment status is ${payment.status}, expected captured or authorized`,
      });
    }

    // Update local order state with payment information (state-machine guarded,
    // so a repeated/replayed verify call cannot regress or duplicate state)
    const nextStatus = payment.status === 'captured' ? 'paid' : 'authorized';
    const { applied, reason } = transitionOrder(orderId, nextStatus, {
      paymentId: payment.id,
      paymentStatus: payment.status,
    });

    if (!applied) {
      console.warn(`⚠️  Verify state transition not applied for order ${orderId}: ${reason}`);
    }

    res.json({
      verified: true,
      paymentDetails: {
        paymentId: payment.id,
        orderId: payment.order_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        acquirerData: payment.acquirer_data ? 'present' : null,
      },
    });
  } catch (error) {
    const safeMessage = sanitizeRazorpayError(error, 'verify-payment');
    res.status(400).json({
      error: 'Payment verification failed',
      message: safeMessage,
    });
  }
});

/**
 * GET /api/payments/:paymentId
 * Fetch payment status from Razorpay
 */
router.get('/:paymentId', async (req, res) => {
  try {
    if (!razorpayInstance) {
      return res.status(503).json({
        error: 'Razorpay not configured',
        message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment',
      });
    }

    const { paymentId } = req.params;
    const payment = await razorpayInstance.payments.fetch(paymentId);

    res.json({
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      createdAt: new Date(payment.created_at * 1000),
    });
  } catch (error) {
    const safeMessage = sanitizeRazorpayError(error, 'fetch-payment');
    // DEF-001 fix (same pattern as refunds.js): error.message is not
    // guaranteed to exist, so never call string methods on it directly.
    const statusCode = error.statusCode === 404 ? 404 : 400;
    res.status(statusCode).json({
      error: 'Payment not found or fetch failed',
      message: safeMessage,
    });
  }
});

/**
 * GET /api/payments/orders/:orderId
 * Fetch order status from local storage
 */
router.get('/orders/:orderId', (req, res) => {
  const { orderId } = req.params;
  const order = getOrder(orderId);

  if (!order) {
    return res.status(404).json({
      error: 'Order not found',
      message: `Order ${orderId} not found`,
    });
  }

  res.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    paymentId: order.payment_id,
    paymentStatus: order.payment_status,
    receipt: order.receipt,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  });
});

export default router;
