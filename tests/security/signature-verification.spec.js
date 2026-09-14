import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Use the actual configured secret if available, otherwise use test secret
const APP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_key_secret_for_qa_only';

function generateSignature(orderId, paymentId, secret = APP_KEY_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

test.describe('Payment Signature Verification', () => {
  const testOrderId = 'order_test_signature_12345';
  const testPaymentId = 'pay_test_signature_67890';

  // Real Razorpay Test Mode order/payment captured in Phase 3.3 via an actual
  // Checkout run (card 5267 3181 8797 5449 + OTP). Using this genuine pair
  // (rather than fabricated IDs) lets SIG-001 exercise the real accept path:
  // signature check -> live payments.fetch() -> amount/status match -> verified.
  // If Razorpay Test Mode data retention ever purges this payment, replace
  // these two values with a freshly captured order/payment pair.
  //
  // Tagged @razorpay-live (excluded from the default CI run, see
  // docs/CI-CD.md): this needs the ORIGINAL Razorpay Test Mode account that
  // created this specific payment (payments.fetch() must find it, and the
  // local order row must already exist), not just any valid credentials, so
  // it cannot be reproduced in a generic CI environment even if the user adds
  // their own Razorpay secrets.
  const realOrderId = 'order_TbqFacJFNAGXm5';
  const realPaymentId = 'pay_TbqJMlA39g3qiF';

  test('SIG-001: POST /api/payments/verify with valid signature accepts a real captured payment @razorpay-live', async ({ request }) => {
    const validSignature = generateSignature(realOrderId, realPaymentId);

    const response = await request.post('/api/payments/verify', {
      data: {
        orderId: realOrderId,
        paymentId: realPaymentId,
        signature: validSignature,
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.verified).toBe(true);
    expect(body.paymentDetails.paymentId).toBe(realPaymentId);
    expect(body.paymentDetails.orderId).toBe(realOrderId);
    expect(body.paymentDetails.amount).toBe(50000);
    expect(body.paymentDetails.status).toBe('captured');
  });

  test('REPLAY-001: repeated verification of the same real payment stays idempotent (no duplicate/corrupted state) @razorpay-live', async ({ request }) => {
    const validSignature = generateSignature(realOrderId, realPaymentId);

    const first = await request.post('/api/payments/verify', {
      data: { orderId: realOrderId, paymentId: realPaymentId, signature: validSignature },
    });
    const second = await request.post('/api/payments/verify', {
      data: { orderId: realOrderId, paymentId: realPaymentId, signature: validSignature },
    });

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);

    const firstBody = await first.json();
    const secondBody = await second.json();
    // Same payment/order, same reported state both times - no duplicate processing
    expect(secondBody.paymentDetails.paymentId).toBe(firstBody.paymentDetails.paymentId);
    expect(secondBody.paymentDetails.status).toBe(firstBody.paymentDetails.status);

    const orderState = await (await request.get(`/api/payments/orders/${realOrderId}`)).json();
    expect(orderState.status).toBe('paid');
    expect(orderState.paymentId).toBe(realPaymentId);
  });

  test('SIG-002: POST /api/payments/verify with invalid signature rejects payment', async ({ request }) => {
    const invalidSignature = 'invalid_signature_' + Date.now();

    const response = await request.post('/api/payments/verify', {
      data: {
        orderId: testOrderId,
        paymentId: testPaymentId,
        signature: invalidSignature,
      },
    });

    // Invalid signature should be rejected
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toBe('Payment signature verification failed');
  });

  test('SIG-003: POST /api/payments/verify with tampered orderId rejects payment', async ({ request }) => {
    const correctSignature = generateSignature(testOrderId, testPaymentId);
    const tamperedOrderId = testOrderId + '_tampered';

    const response = await request.post('/api/payments/verify', {
      data: {
        orderId: tamperedOrderId,
        paymentId: testPaymentId,
        signature: correctSignature, // Signature is for original orderId
      },
    });

    // Signature verification should fail because orderId changed
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('SIG-004: POST /api/payments/verify with missing signature field rejects request', async ({ request }) => {
    const response = await request.post('/api/payments/verify', {
      data: {
        orderId: testOrderId,
        paymentId: testPaymentId,
        // signature is intentionally missing
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Missing required fields');
  });

  test('SIG-005: POST /api/payments/verify with missing orderId rejects request', async ({ request }) => {
    const validSignature = generateSignature(testOrderId, testPaymentId);

    const response = await request.post('/api/payments/verify', {
      data: {
        // orderId is intentionally missing
        paymentId: testPaymentId,
        signature: validSignature,
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Missing required fields');
  });

  test('SIG-006: POST /api/payments/verify with missing paymentId rejects request', async ({ request }) => {
    const validSignature = generateSignature(testOrderId, testPaymentId);

    const response = await request.post('/api/payments/verify', {
      data: {
        orderId: testOrderId,
        // paymentId is intentionally missing
        signature: validSignature,
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Missing required fields');
  });
});
