import { test, expect } from '@playwright/test';

test.describe('Error Handling & Message Sanitization', () => {
  test('ERR-001: Order creation error does NOT expose Razorpay API details', async ({ request }) => {
    // Call order creation which will fail gracefully if Razorpay not configured
    const response = await request.post('/api/payments/create-order', {});

    // Accept either 400 or 503
    if (![200].includes(response.status())) {
      const body = await response.json();
      const responseString = JSON.stringify(body);

      // Verify error message is safe
      expect(responseString).not.toContain('key_id');
      expect(responseString).not.toContain('key_secret');
      expect(responseString).not.toContain('http');
      expect(responseString).not.toContain('/v1/');

      // Verify error message is human-friendly
      expect(body.message).toBeDefined();
      expect(typeof body.message).toBe('string');
      expect(body.message.length > 0).toBe(true);
    }
  });

  test('ERR-002: Payment verification error does NOT expose internal details', async ({ request }) => {
    const response = await request.post('/api/payments/verify', {
      data: {
        orderId: 'nonexistent_order',
        paymentId: 'nonexistent_payment',
        signature: 'invalid_sig',
      },
    });

    // Should fail at signature validation
    expect(response.status()).toBe(401);

    const body = await response.json();
    const responseString = JSON.stringify(body);

    // Verify no stack trace or internal details
    expect(responseString).not.toContain('at ');
    expect(responseString).not.toContain('Error');
    expect(responseString).not.toContain('stack');
    expect(responseString).not.toContain('/routes/');
  });

  test('ERR-003: 404 endpoint returns appropriate error', async ({ request }) => {
    const response = await request.get('/api/nonexistent/endpoint');

    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('/api/nonexistent/endpoint');
  });

  test('ERR-004: Malformed JSON request returns 400 error', async ({ request }) => {
    // Send malformed JSON as raw request body
    const response = await request.post('/api/payments/verify', {
      headers: {
        'Content-Type': 'application/json',
      },
      // Send invalid JSON directly
      data: Buffer.from('invalid json {[}]'),
    });

    expect(response.status()).toBe(400);

    // Response may be text or JSON depending on error handling
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      expect(body.error).toBeDefined();
    }
  });

  // DEF-001 regression tests (a Razorpay refund error that used to crash the
  // whole server) now live in tests/security/refund-error-handling.spec.js,
  // since they need to run against the live app and assert the server stays
  // up afterward - see docs/DEFECTS.md.
  test('REF-001: POST /api/refunds/create requires paymentId', async ({ request }) => {
    const response = await request.post('/api/refunds/create', {
      data: {
        // paymentId intentionally missing
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Missing required field');
    expect(body.message).toContain('paymentId');
  });
});
