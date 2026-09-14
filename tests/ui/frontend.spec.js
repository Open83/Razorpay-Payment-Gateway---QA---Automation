import { test, expect } from '@playwright/test';

test.describe('Frontend UI Behavior', () => {
  test('UI-001: Frontend page loads and displays payment form', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check page title
    expect(await page.title()).toBeTruthy();

    // Verify main container exists
    const container = page.locator('.container');
    await expect(container).toBeVisible();

    // Verify header is present
    const header = page.locator('h1');
    await expect(header).toBeVisible();
    expect(await header.textContent()).toContain('Payment Gateway');

    // Verify product section exists
    const productSection = page.locator('.product');
    await expect(productSection).toBeVisible();

    // Verify Pay Now button exists
    const payButton = page.locator('#payButton');
    await expect(payButton).toBeVisible();
    expect(await payButton.textContent()).toContain('Pay Now');
  });

  // Tagged @razorpay-live (excluded from the default CI run, see
  // docs/CI-CD.md): the page's own initial load calls POST
  // /api/payments/create-order, which needs a genuinely valid Razorpay Test
  // Mode key (any real Test Mode account, not the specific one from Phase
  // 3.3) to succeed and populate the displayed amount. Without it,
  // create-order returns an error and the amount stays the page's '₹0.00'
  // placeholder. Unlike SIG-001/REPLAY-001, this one WOULD pass if the user
  // adds their own real Razorpay Test Mode secrets to CI - it just isn't
  // guaranteed to, so it's excluded from the default run.
  test('UI-002: Frontend amount displayed matches backend-controlled amount @razorpay-live', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load and API calls to complete
    await page.waitForLoadState('networkidle');

    // Get displayed amount
    const amountElement = page.locator('#productAmount');
    await expect(amountElement).toBeVisible();

    const displayedAmount = await amountElement.textContent();

    // Verify amount is displayed in rupees format
    expect(displayedAmount).toMatch(/^₹\d+\.\d{2}$/);

    // Backend controls amount to ₹500.00 (50000 paise)
    // Frontend should display this, not allow user to change it
    expect(displayedAmount).toBe('₹500.00');

    // Verify product name is also displayed
    const productName = page.locator('#productName');
    await expect(productName).toBeVisible();
    expect(await productName.textContent()).toBe('Demo Product');
  });

  test('UI-003: Razorpay Checkout script loaded from official CDN', async ({ page }) => {
    await page.goto('/');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Check if Razorpay script is loaded
    const razorpayScript = page.locator('script[src*="checkout.razorpay.com"]');

    // Verify script tag exists
    const scriptCount = await razorpayScript.count();
    expect(scriptCount).toBeGreaterThan(0);

    // Verify no credentials in HTML source
    const htmlContent = await page.content();
    expect(htmlContent).not.toContain('RAZORPAY_KEY');
    expect(htmlContent).not.toContain('rzp_live_');
    expect(htmlContent).not.toContain('secret');
  });

  test('UI-004: Page does NOT expose secrets in HTML', async ({ page }) => {
    await page.goto('/');

    const htmlContent = await page.content();

    // Verify no Razorpay secrets in HTML
    expect(htmlContent).not.toContain('RAZORPAY_KEY_SECRET');
    expect(htmlContent).not.toContain('RAZORPAY_WEBHOOK_SECRET');
    expect(htmlContent).not.toContain('key_secret');
    expect(htmlContent).not.toContain('webhook_secret');

    // Verify no test credentials in HTML
    expect(htmlContent).not.toContain('your_test_secret_key');
    expect(htmlContent).not.toContain('XXXXXXXXXXXXX');
  });

  test('UI-005: Test Mode indicator is visible on page', async ({ page }) => {
    await page.goto('/');

    // Look for test mode badge or indicator
    const testModeIndicator = page.locator('text=TEST MODE').first();

    // At least one reference to TEST MODE should exist
    const count = await page.locator('text=TEST MODE').count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
