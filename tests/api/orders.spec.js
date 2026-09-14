import { test, expect } from '@playwright/test';

test.describe('Order Creation API', () => {
  test('ORDER-002: POST /api/payments/create-order handles both success and error gracefully', async ({ request }) => {
    const response = await request.post('/api/payments/create-order', {});

    // With configured credentials, order creation should either succeed (200) or fail gracefully
    // Without credentials, should return 503
    expect([200, 400, 503]).toContain(response.status());

    const body = await response.json();

    if (response.status() === 200) {
      // Success: should return order structure
      expect(body).toHaveProperty('orderId');
      expect(body.orderId).toMatch(/^order_[a-zA-Z0-9]+$/);
    } else {
      // Error: should have error property and safe message
      expect(body).toHaveProperty('error');
      const errorMessage = JSON.stringify(body);
      // Errors should be sanitized (no raw API details)
      expect(errorMessage).not.toContain('key_id');
    }
  });

  test('ORDER-003: client-supplied amount/currency cannot override the backend-controlled order amount', async ({ request }) => {
    const response = await request.post('/api/payments/create-order', {
      data: { amount: 1, currency: 'USD' },
    });

    if (response.status() === 200) {
      const body = await response.json();
      // Backend ignores whatever the client sent and always uses config.js's amount/currency
      expect(body.amount).toBe(50000);
      expect(body.currency).toBe('INR');
    }
  });

  test('ORDER-001: POST /api/payments/create-order returns order structure (when configured)', async ({ request }) => {
    const response = await request.post('/api/payments/create-order', {});

    // If credentials are configured, should return 200
    // If not configured, will return 503 (acceptable for this test phase)
    if (response.status() === 200) {
      const body = await response.json();

      expect(body).toHaveProperty('orderId');
      expect(body).toHaveProperty('amount');
      expect(body).toHaveProperty('currency');
      expect(body).toHaveProperty('productName');
      expect(body).toHaveProperty('status');

      // Verify expected values
      expect(body.amount).toBe(50000); // ₹500.00
      expect(body.currency).toBe('INR');
      expect(body.productName).toBe('Demo Product');
      expect(body.status).toBe('order_created');

      // orderId should be alphanumeric (Razorpay format)
      expect(body.orderId).toMatch(/^order_[a-zA-Z0-9]+$/);
    } else if (response.status() === 503) {
      // Razorpay not configured - acceptable skip for this phase
      const body = await response.json();
      expect(body.error).toBe('Razorpay not configured');
    }
  });
});
