# Razorpay Test Mode Setup Guide

## Overview

This guide explains how to set up Razorpay Test Mode credentials for the demo payment application.

## Section 1: Getting Test Credentials

### Prerequisites
- A Razorpay account (sign up at https://razorpay.com/)
- Access to your Razorpay Dashboard
- Test Mode enabled (default when you first sign up)

### Steps to Obtain Credentials

1. **Log in to Razorpay Dashboard**
   - Visit https://dashboard.razorpay.com/
   - Sign in with your credentials

2. **Verify You're in Test Mode**
   - Look for "TEST MODE" label in the dashboard (usually top-left)
   - If in Live Mode, switch to Test Mode

3. **Generate API Keys**
   - Navigate to **Settings** → **API Keys**
   - You'll see two sets of keys:
     - **Test Keys** (for development/testing)
     - **Live Keys** (for production)
   - Copy the **Test Mode Key ID** and **Key Secret**

4. **Generate Webhook Secret**
   - Navigate to **Settings** → **Webhooks**
   - Click on your webhook endpoint (or create one: `http://localhost:3000/api/webhooks/razorpay`)
   - The **Signing Secret** is displayed; copy it

5. **Store Credentials in .env**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add:
   ```
   RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET=your_test_secret_key_here
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
   ```

## Section 2: Test Mode Behavior (From Official Razorpay Docs)

### What Razorpay Test Mode Provides

**Order Management:**
- Creates orders via `POST /v1/orders`
- Order states: `created` → `paid` (or `failed`/`closed`)
- Amount required in smallest currency subunit (paise for INR)

**Payment Processing:**
- Accepts test payment methods (test cards)
- No real money deducted
- Immediate payment processing (synchronous)
- Webhook events sent asynchronously

**Webhook Events:**
- `payment.authorized` — Payment authorized
- `payment.captured` — Payment captured (cleared for settlement)
- `payment.failed` — Payment failed
- `refund.created` — Refund initiated
- Signature validation: HMAC-SHA256 with webhook secret

**Refunds:**
- Available only on `captured` payments
- `POST /v1/payments/:id/refund`
- Full and partial refunds supported
- Webhook event: `refund.created` upon completion

### Test Card Numbers (From Official Razorpay Documentation)

**Successful Payment:**
- Card Number: `4111 1111 1111 1111`
- Name: Any name
- Expiry: Any future date (e.g., 12/25)
- CVV: Any 3 digits (e.g., 123)

**Payment Decline:**
- Card Number: `4222 2222 2222 2200`
- Result: Payment will be declined

Note: Refer to https://razorpay.com/docs/ for complete list of test cards including international cards.

### What We Simulate Ourselves

- Network timeouts and delays (via Playwright intercepts)
- Slow API responses
- Custom failure scenarios outside Razorpay's scope
- Payment state transitions not provided by Razorpay

## Section 3: Verification Steps

### Verify Configuration

1. **Check credentials are loaded:**
   ```bash
   npm start
   ```
   If configured correctly, logs show:
   ```
   ✅ Server running on http://localhost:3000
   ```

2. **Test API endpoint:**
   ```bash
   curl http://localhost:3000/api/payments/config
   ```
   Should return:
   ```json
   {
     "keyId": "rzp_test_XXXXX",
     "currency": "INR",
     "configured": true
   }
   ```

3. **Manual payment flow:**
   - Open http://localhost:3000 in browser
   - Click "Pay Now"
   - Use test card: `4111 1111 1111 1111`
   - Complete payment

### Webhook Configuration

1. **For Local Testing (without ngrok/tunnel):**
   - Webhook events won't reach `localhost:3000` from Razorpay servers
   - You can test webhook signature validation using the CLI

2. **For External Testing (with tunnel service):**
   - Use ngrok, cloudflare tunnel, or similar to expose localhost
   - Update webhook URL in Razorpay Dashboard to: `https://your-tunnel.example.com/api/webhooks/razorpay`
   - Test webhook delivery from dashboard

## Section 4: Important Notes

- ✅ TEST MODE ONLY — No real money, no production credentials
- ✅ .env file is in .gitignore — credentials never committed
- ✅ Test credentials can be regenerated anytime
- ❌ Never use production credentials in this project
- ❌ Never commit .env to version control
- ❌ Never expose secrets in code, logs, or documentation

## References

Based on official Razorpay documentation:
- [Razorpay Standard Checkout Integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)
- [Razorpay API Orders](https://razorpay.com/docs/api/orders/)
- [Razorpay Webhooks & Signature Validation](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay Test Mode & Live Mode](https://razorpay.com/docs/payments/dashboard/test-live-modes/)
- [Razorpay Node.js SDK](https://razorpay.com/docs/payments/server-integration/nodejs/)

---

**Phase 2 Implementation**: Demo application with API endpoints, frontend, and webhook receiver is now functional.
