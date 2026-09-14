import { test, expect } from '@playwright/test';

test.describe('Health & Configuration API', () => {
  test('HEALTH-001: GET /health returns application health', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('environment');
    expect(typeof body.timestamp).toBe('string');
  });

  test('CONFIG-001: GET /api/payments/config returns public configuration', async ({ request }) => {
    const response = await request.get('/api/payments/config');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('keyId');
    expect(body).toHaveProperty('currency');
    expect(body).toHaveProperty('configured');
    expect(typeof body.configured).toBe('boolean');
  });

  test('CONFIG-002: GET /api/payments/config does NOT expose secrets', async ({ request }) => {
    const response = await request.get('/api/payments/config');

    expect(response.status()).toBe(200);

    const body = await response.json();
    const responseString = JSON.stringify(body);

    // Verify secrets are NOT in response
    expect(responseString).not.toContain('keySecret');
    expect(responseString).not.toContain('webhookSecret');
    expect(responseString).not.toContain('RAZORPAY');

    // Only public keyId should be present (not containing secret)
    if (body.keyId && body.keyId !== 'NOT_CONFIGURED') {
      expect(body.keyId).toMatch(/^rzp_test_|^NOT_CONFIGURED$/);
    }
  });

  test('CONFIG-003: GET /api/payments/config properly reflects configuration status', async ({ request }) => {
    const response = await request.get('/api/payments/config');

    expect(response.status()).toBe(200);

    const body = await response.json();
    // keyId should either be 'NOT_CONFIGURED' or a valid test mode key (rzp_test_...)
    const isValidKeyId = body.keyId === 'NOT_CONFIGURED' || /^rzp_test_/.test(body.keyId);
    expect(isValidKeyId).toBeTruthy();

    // configured flag should match keyId status
    if (body.keyId === 'NOT_CONFIGURED') {
      expect(body.configured).toBe(false);
    } else {
      expect(body.configured).toBe(true);
    }
  });
});
