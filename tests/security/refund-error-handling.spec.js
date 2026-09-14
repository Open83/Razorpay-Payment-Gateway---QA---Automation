import { test, expect } from '@playwright/test';

// Regression tests for DEF-001 (Phase 3.3.1): any Razorpay refund API error
// used to crash the entire Node process, because src/routes/refunds.js
// called `error.message.includes(...)` without checking `error.message` was
// defined - and the razorpay SDK's errors never set it. Fixed by deriving
// the status code from `error.statusCode` instead. See docs/DEFECTS.md.
//
// These tests intentionally trigger a real Razorpay-rejected refund (an
// unknown paymentId, which Razorpay always rejects regardless of account
// configuration) and then prove the server is still alive and serving other
// requests immediately afterward - that liveness check is the actual
// regression assertion; the exact HTTP status Razorpay maps the error to is
// secondary.
test.describe('Refund error handling (DEF-001 regression)', () => {
  test('REF-ERR-001: a Razorpay-rejected refund returns a controlled error, not a crash', async ({ request }) => {
    const response = await request.post('/api/refunds/create', {
      data: { paymentId: 'pay_definitely_does_not_exist_12345' },
    });

    // Must be a normal HTTP error response (never a connection reset from a
    // crashed process, which Playwright would surface as a request failure).
    expect([400, 404]).toContain(response.status());

    const body = await response.json();
    expect(body.error).toBe('Refund creation failed');
    expect(typeof body.message).toBe('string');
    // Sanitized message only - no raw Razorpay SDK internals leaked.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('statusCode');
    expect(raw).not.toContain('BAD_REQUEST_ERROR');
  });

  test('REF-ERR-002: the server remains available immediately after a refund error', async ({ request }) => {
    // Trigger the same class of Razorpay-rejected refund as REF-ERR-001.
    await request.post('/api/refunds/create', {
      data: { paymentId: 'pay_another_nonexistent_id_67890' },
    });

    // The defect specifically crashed the whole process, so the real
    // regression check is that completely unrelated requests still work.
    const health = await request.get('/health');
    expect(health.status()).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.status).toBe('ok');

    const config = await request.get('/api/payments/config');
    expect(config.status()).toBe(200);
  });
});
