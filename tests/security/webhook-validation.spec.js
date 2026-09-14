import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createOrder } from '../../src/orderStore.js';

dotenv.config();

// Use the actual configured webhook secret if available, otherwise use test secret
const APP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_qa_only';

function generateWebhookSignature(payload, secret = APP_WEBHOOK_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

function createMockWebhookPayload(eventId = 'evt_test_' + Date.now()) {
  return JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: 'payment',
        id: 'pay_test_' + Date.now(),
        order_id: 'order_test_' + Date.now(),
        amount: 50000,
        currency: 'INR',
        status: 'captured',
      },
    },
  });
}

// DEF-002 (Phase 3.3.1 FIX): src/app.js previously mounted the global
// express.json() body parser before the webhook router, so by the time
// express.raw() ran in src/routes/webhooks.js the body had already been
// parsed and consumed - the HMAC was computed over the string
// "[object Object]" instead of the real raw body, so no correctly-signed
// webhook could ever be accepted. Fixed by mounting the webhook router
// before the global express.json(). See docs/DEFECTS.md.
test.describe('Webhook Validation & Idempotency', () => {
  test('WEB-001: POST /api/webhooks/razorpay with valid signature accepts webhook', async ({ request }) => {
    // Event ID must be unique per test run: webhook idempotency is now
    // durable (SQLite, see docs/DEFECTS.md DEF-002 / Phase 3.3 persistence),
    // so a hardcoded ID would only pass "first time processed" once ever,
    // then report "already processed" on every later run against the same DB.
    const eventId = 'evt_valid_' + Date.now();
    const payload = createMockWebhookPayload(eventId);
    const validSignature = generateWebhookSignature(payload);

    const response = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers: {
        'X-Razorpay-Signature': validSignature,
        'X-Razorpay-Event-Id': eventId,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('Webhook received and validated');
  });

  test('WEB-002: POST /api/webhooks/razorpay with invalid signature rejects webhook', async ({ request }) => {
    const payload = createMockWebhookPayload('evt_invalid_001');
    const invalidSignature = 'invalid_signature_' + Date.now();

    const response = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers: {
        'X-Razorpay-Signature': invalidSignature,
        'X-Razorpay-Event-Id': 'evt_invalid_001',
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toBe('Webhook signature validation failed');
  });

  test('WEB-003: POST /api/webhooks/razorpay with missing signature header rejects webhook', async ({ request }) => {
    const payload = createMockWebhookPayload('evt_nosig_001');

    const response = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers: {
        // X-Razorpay-Signature intentionally missing
        'X-Razorpay-Event-Id': 'evt_nosig_001',
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toBe('X-Razorpay-Signature header is required');
  });

  test('WEB-004: POST /api/webhooks/razorpay with missing event ID rejects webhook', async ({ request }) => {
    const payload = createMockWebhookPayload('evt_noid_001');
    const validSignature = generateWebhookSignature(payload);

    const response = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers: {
        'X-Razorpay-Signature': validSignature,
        // X-Razorpay-Event-Id intentionally missing
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Bad Request');
    expect(body.message).toContain('X-Razorpay-Event-Id header is required');
  });

  test('WEB-005: Same webhook event ID sent twice is processed only once (idempotency)', async ({ request }) => {
    const eventId = 'evt_idempotent_' + Date.now();
    const payload = createMockWebhookPayload(eventId);
    const validSignature = generateWebhookSignature(payload);

    const headers = {
      'X-Razorpay-Signature': validSignature,
      'X-Razorpay-Event-Id': eventId,
      'Content-Type': 'application/json',
    };

    // Send webhook first time
    const firstResponse = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers,
    });

    expect(firstResponse.status()).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.success).toBe(true);

    // Send the SAME webhook again (same event ID)
    const secondResponse = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers,
    });

    expect(secondResponse.status()).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.success).toBe(true);
    // Verify it indicates already processed
    expect(secondBody.message).toContain('already processed');
  });

  test('WEB-006: Different webhook event IDs are processed independently', async ({ request }) => {
    const eventId1 = 'evt_independent_001_' + Date.now();
    const eventId2 = 'evt_independent_002_' + Date.now();

    const payload1 = createMockWebhookPayload(eventId1);
    const signature1 = generateWebhookSignature(payload1);

    const payload2 = createMockWebhookPayload(eventId2);
    const signature2 = generateWebhookSignature(payload2);

    // Send first webhook
    const response1 = await request.post('/api/webhooks/razorpay', {
      data: payload1,
      headers: {
        'X-Razorpay-Signature': signature1,
        'X-Razorpay-Event-Id': eventId1,
        'Content-Type': 'application/json',
      },
    });

    expect(response1.status()).toBe(200);

    // Send second webhook (different event ID)
    const response2 = await request.post('/api/webhooks/razorpay', {
      data: payload2,
      headers: {
        'X-Razorpay-Signature': signature2,
        'X-Razorpay-Event-Id': eventId2,
        'Content-Type': 'application/json',
      },
    });

    expect(response2.status()).toBe(200);

    // Both should be successful
    const body1 = await response1.json();
    const body2 = await response2.json();
    expect(body1.success).toBe(true);
    expect(body2.success).toBe(true);
  });

  test('WEB-007: Webhook with tampered payload fails signature validation', async ({ request }) => {
    const eventId = 'evt_tampered_' + Date.now();
    const payload = createMockWebhookPayload(eventId);
    const validSignature = generateWebhookSignature(payload);

    // Create tampered payload (append a character)
    const tamperedPayload = payload + 'X';

    const response = await request.post('/api/webhooks/razorpay', {
      data: tamperedPayload,
      headers: {
        'X-Razorpay-Signature': validSignature, // Signature is for original payload
        'X-Razorpay-Event-Id': eventId,
        'Content-Type': 'application/json',
      },
    });

    // Signature should not match tampered payload
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });
});

// DEF-002 regression, named per the Phase 3.3.1 remediation spec (WEB-FIX-00x).
// Uses a correctly-shaped payload (payload.payload.payment.entity.{id,order_id,...},
// matching Razorpay's real webhook shape). Each test seeds its own fresh,
// synthetic order directly via src/orderStore.js (the same persistence layer
// the app itself uses) rather than depending on a specific historical real
// transaction - that keeps these tests fully deterministic and portable to a
// clean environment (e.g. a fresh CI checkout with an empty database), unlike
// SIG-001/REPLAY-001 which intentionally exercise one specific, real,
// already-captured Razorpay Test Mode payment and are excluded from CI (see
// docs/CI-CD.md).
test.describe('DEF-002 regression: raw-body webhook signature verification', () => {
  function seedOrder(orderId) {
    createOrder({ id: orderId, amount: 50000, currency: 'INR', status: 'created', receipt: 'receipt_' + orderId });
  }

  function shapedPayload(orderId, paymentId, overrides = {}) {
    return JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 50000,
            currency: 'INR',
            status: 'captured',
            ...overrides,
          },
        },
      },
    });
  }

  test('WEB-FIX-001: valid signature computed over the exact raw body is accepted and updates order state', async ({ request }) => {
    const orderId = 'order_webfix_' + Date.now();
    const paymentId = 'pay_webfix_' + Date.now();
    seedOrder(orderId);

    const eventId = 'evt_webfix_valid_' + Date.now();
    const payload = shapedPayload(orderId, paymentId);
    const signature = generateWebhookSignature(payload);

    const response = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers: {
        'X-Razorpay-Signature': signature,
        'X-Razorpay-Event-Id': eventId,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Freshly-seeded order started 'created' - confirm the webhook actually
    // drove the created -> paid transition, with the paymentId recorded.
    const order = await (await request.get(`/api/payments/orders/${orderId}`)).json();
    expect(order.status).toBe('paid');
    expect(order.paymentId).toBe(paymentId);
  });

  test('WEB-FIX-002: a modified payload with the original signature is rejected', async ({ request }) => {
    const orderId = 'order_webfix_' + Date.now();
    const paymentId = 'pay_webfix_' + Date.now();
    seedOrder(orderId);

    const eventId = 'evt_webfix_tampered_' + Date.now();
    const payload = shapedPayload(orderId, paymentId);
    const signature = generateWebhookSignature(payload); // signed over the ORIGINAL amount
    const modifiedPayload = shapedPayload(orderId, paymentId, { amount: 1 }); // same shape, different amount

    const response = await request.post('/api/webhooks/razorpay', {
      data: modifiedPayload,
      headers: {
        'X-Razorpay-Signature': signature,
        'X-Razorpay-Event-Id': eventId,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');

    // The rejected webhook must not have touched the order.
    const order = await (await request.get(`/api/payments/orders/${orderId}`)).json();
    expect(order.status).toBe('created');
  });

  test('WEB-FIX-003: an invalid signature is rejected', async ({ request }) => {
    const orderId = 'order_webfix_' + Date.now();
    const paymentId = 'pay_webfix_' + Date.now();
    const eventId = 'evt_webfix_invalid_' + Date.now();
    const payload = shapedPayload(orderId, paymentId);

    const response = await request.post('/api/webhooks/razorpay', {
      data: payload,
      headers: {
        'X-Razorpay-Signature': 'f'.repeat(64),
        'X-Razorpay-Event-Id': eventId,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('WEB-FIX-004: a duplicate event ID is handled idempotently', async ({ request }) => {
    const orderId = 'order_webfix_' + Date.now();
    const paymentId = 'pay_webfix_' + Date.now();
    seedOrder(orderId);

    const eventId = 'evt_webfix_dup_' + Date.now();
    const payload = shapedPayload(orderId, paymentId);
    const signature = generateWebhookSignature(payload);
    const headers = {
      'X-Razorpay-Signature': signature,
      'X-Razorpay-Event-Id': eventId,
      'Content-Type': 'application/json',
    };

    const first = await request.post('/api/webhooks/razorpay', { data: payload, headers });
    expect(first.status()).toBe(200);
    expect((await first.json()).message).toContain('Webhook received and validated');

    const second = await request.post('/api/webhooks/razorpay', { data: payload, headers });
    expect(second.status()).toBe(200);
    expect((await second.json()).message).toContain('already processed');

    // Idempotent replay must not have re-applied or duplicated the transition.
    const order = await (await request.get(`/api/payments/orders/${orderId}`)).json();
    expect(order.status).toBe('paid');
    expect(order.paymentId).toBe(paymentId);
  });
});
