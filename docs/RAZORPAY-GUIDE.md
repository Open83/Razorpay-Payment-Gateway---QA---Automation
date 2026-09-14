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

### Test Card Numbers — Verified Working (Phase 3.3)

**Successful Payment — verified against this project's own Razorpay Test Mode account:**
- Card Number: `5267 3181 8797 5449` (domestic Mastercard, issued as Axis Bank in Test Mode)
- Name: Any name
- Expiry: Any future date (e.g., 12/30)
- CVV: Any 3 digits (e.g., 123)
- **This card triggers a 3-D Secure OTP challenge.** Razorpay Test Mode's documented test
  OTP is `1234` — enter that when prompted and the payment completes as `captured`.

This exact flow (card → OTP `1234` → Checkout success → server-side verification →
local order transitioned to `paid`) was actually executed and evidenced in
`docs/PHASE-3.3-TEST-REPORT.md`.

**Important — a documented Razorpay example card that did NOT work here:** Razorpay's
general documentation elsewhere lists the international Visa test card
`4111 1111 1111 1111`. On this project's specific Test Mode account, that card was
rejected outright by Razorpay's real Checkout UI with *"International cards are not
supported"* — a genuine, evidenced, account-level restriction (international cards
disabled), not a bug in this application. If your own Razorpay Test Mode account has
international cards enabled, that card may work for you; if you see the same rejection,
use the domestic card above instead.

**Payment Decline:**
- Card Number: `4222 2222 2222 2200`
- Result: Payment will be declined
- Not independently re-verified against this project's account in the same way as the
  successful-payment card above; included here as Razorpay's own documented decline card.

Note: Refer to https://razorpay.com/docs/ for the complete, current list of test cards.

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
   - Use test card: `5267 3181 8797 5449`, any future expiry, any 3-digit CVV
   - When prompted for an OTP (3-D Secure), enter `1234`
   - Complete payment — Checkout should report "Payment Successful" and the app should
     show the verified payment details

### Webhook Configuration

1. **For Local Testing (without a tunnel):**
   - Webhook events won't reach `localhost:3000` from Razorpay servers
   - Webhook signature validation, idempotency, and state-transition logic can all be
     tested deterministically without one — see `docs/DEFECTS.md` and
     `tests/security/webhook-validation.spec.js`

2. **For External Testing (with a tunnel service):**
   - This project used **zrok** (not ngrok — ngrok-tunneled webhook URLs were blocked by
     Razorpay in this project's testing)
   - Update the webhook URL in Razorpay Dashboard to your tunnel's public URL + `/api/webhooks/razorpay`
   - **Current status:** a zrok tunnel was confirmed reachable end-to-end, but no webhook
     event from Razorpay's own servers was ever observed arriving at the application —
     most likely a Dashboard webhook configuration gap, not a code defect. **Real
     Razorpay-originated webhook delivery has not been demonstrated by this project** —
     see the README's Webhook Limitation section and `docs/DEFECTS.md` (DEF-002).

### Refund Limitation

Refund request validation, error handling, state transition, and persistence are all
implemented and tested (see `docs/SECURITY.md` and `docs/DEFECTS.md`). **A successful
real Razorpay refund execution has not been demonstrated** — Razorpay's Test Mode API
rejected refund attempts on this project's specific account with `BAD_REQUEST_ERROR
"invalid request sent"`, confirmed (via raw HTTPS calls bypassing this app's code and the
SDK entirely) to be an account/environment-level restriction, not an application defect.

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

**Status**: Current as of Phase 3.3 — a real Razorpay Test Mode Checkout payment (card +
OTP flow above) was successfully completed, verified server-side, and its state tracked
to `paid`. Real webhook delivery and real refund execution remain open limitations (see
above and `docs/DEFECTS.md`).
