# Security Implementation Guide

**This document describes the security controls as they currently exist** (as of Phase
3.3.1). The controls below were first introduced in Phase 2.1 and have since been
extended with durable (SQLite) persistence and explicit state-machine guards (Phase
3.3) — historical notes call out what changed and why. See "Security Defects Found &
Resolved" below for the two genuine defects this project's own testing found in these
controls, and `docs/DEFECTS.md` for the full, authoritative record of each.

## Phase 2.1: Security Fixes (original introduction)

This document describes the security enhancements implemented in Phase 2.1.

## 1. Payment Signature Verification

### What is it?

Razorpay payment signature verification ensures that payment details received in the frontend callback actually came from Razorpay, not an attacker.

### How it works

When Razorpay Checkout completes a payment, it returns:
- `razorpay_order_id` — The order created on Razorpay
- `razorpay_payment_id` — The payment ID created by Razorpay
- `razorpay_signature` — A cryptographic signature proving these values came from Razorpay

### Implementation

**Algorithm:** HMAC-SHA256
```
expected_signature = hmac_sha256(orderId|paymentId, key_secret)
```

**Code Location:** `src/routes/payments.js:verifyPaymentSignature()`

```javascript
function verifyPaymentSignature(orderId, paymentId, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expectedSignature === signature;
}
```

**Verification Flow in POST /api/payments/verify:**
1. Extract orderId, paymentId, signature from request
2. Call verifyPaymentSignature()
3. If invalid → return HTTP 401 "Unauthorized"
4. If valid → fetch payment from Razorpay API
5. Verify amount matches stored order
6. Update local order state
7. Return payment details

### Why this matters

- **Prevents spoofing:** Without signature verification, an attacker could send a fake payment_id and claim payment success
- **Validates authenticity:** Only Razorpay (who has the secret) can generate valid signatures
- **Mandatory for compliance:** Official Razorpay documentation requires signature verification before treating payment as successful

### Testing

**Valid signature:**
- Frontend sends correct orderId, paymentId, signature from Razorpay
- Backend accepts and marks payment as verified

**Invalid signature:**
- Attacker sends fake signature
- Backend rejects with HTTP 401
- Payment not verified

**Missing signature:**
- Request missing signature field
- Backend rejects with HTTP 400

---

## 2. Webhook Signature Validation

### What is it?

Webhook signature validation ensures that webhook events (payment.captured, refund.created, etc.) actually came from Razorpay, not a fake source.

### How it works

Razorpay sends webhook events with:
- **Raw request body** containing JSON payload
- **X-Razorpay-Signature header** containing HMAC-SHA256 signature
- **X-Razorpay-Event-Id header** containing unique event identifier

### Implementation

**Algorithm:** HMAC-SHA256 with raw request body
```
expected_signature = hmac_sha256(raw_body, webhook_secret)
```

**Code Location:** `src/routes/webhooks.js:validateWebhookSignature()`

```javascript
function validateWebhookSignature(rawBody, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === signature;
}
```

**Validation Flow in POST /api/webhooks/razorpay:**
1. Extract raw request body (NOT parsed)
2. Extract X-Razorpay-Signature header
3. Call validateWebhookSignature()
4. If invalid → return HTTP 401 "Unauthorized"
5. If valid → parse JSON safely
6. Check idempotency (see below)
7. Process webhook event
8. Return HTTP 200 success

### Why this matters

- **Prevents fake webhooks:** Without validation, anyone could send fake payment.captured webhooks
- **Protects state:** Prevents triggering refunds, marking orders as paid, etc. based on fake events
- **Requires raw body:** Parsing JSON first could change the body, invalidating the signature

### Testing

**Valid signature:**
- Send webhook with correct X-Razorpay-Signature
- Backend accepts and processes event

**Invalid signature:**
- Send webhook with wrong signature
- Backend rejects with HTTP 401

**Missing signature:**
- Send webhook without X-Razorpay-Signature header
- Backend rejects with HTTP 401

---

## 3. Webhook Idempotency

### What is it?

Webhook idempotency ensures that if Razorpay sends the same webhook event twice (due to network retry, duplicate processing, etc.), your application only processes it once.

### How it works

Each webhook has a unique **X-Razorpay-Event-Id** header. If the same event_id arrives twice, the second should be treated as a duplicate.

### Implementation

**Code Location:** `src/routes/webhooks.js` + `src/orderStore.js` (`isWebhookEventProcessed()` / `recordWebhookEvent()`)

```javascript
// In webhook handler:
if (isWebhookEventProcessed(eventId)) {
  // Already processed, return success
  return res.status(200).json({ success: true, message: 'Webhook already processed' });
}

// ...validate signature, process...

// Mark as processed after successful processing (durable - SQLite webhook_events table)
recordWebhookEvent({ eventId, eventType: event, paymentId, orderId, amount, status, source: 'real' });
```
**Historical note:** the original Phase 2.1 implementation used an in-memory `Set`,
meaning processed event IDs were lost on every server restart. This was replaced with a
durable SQLite table in Phase 3.3 — see the Limitations subsection below, updated to
reflect that fix.

**Idempotency Flow:**
1. Webhook received with X-Razorpay-Event-Id
2. Check if event_id already processed
3. If yes → return HTTP 200 (success, no reprocessing)
4. If no → validate signature, process event, mark as processed
5. Return HTTP 200

### Why this matters

- **Prevents duplicate side effects:** Same refund webhook processed twice = two refunds created
- **Handles network retries:** Razorpay retries failed webhooks; duplicates are safe
- **Simple but critical:** Solves a common source of bugs in payment integrations

### Limitations (current)

- **Real Razorpay-originated webhook delivery not demonstrated:** the idempotency logic
  above is deterministically tested with correctly-signed local requests using the real
  webhook secret, but no webhook from Razorpay's own servers has been observed arriving
  at this application — see `docs/DEFECTS.md` and the README's Webhook Limitation section.

**Resolved (no longer a limitation):** durability across restarts — event IDs are now
persisted in SQLite (`webhook_events` table), not an in-memory `Set`. Confirmed to
survive both a clean restart and an actual process crash during Phase 3.3 testing.

### Testing

**Same event_id twice:**
1. Send webhook with event_id = "evt_123"
2. Server processes: signature valid, event processed, marked as processed
3. Send same webhook again (event_id = "evt_123")
4. Server returns HTTP 200 "Already processed" (webhook NOT reprocessed)

**Different event_ids:**
1. Send webhook with event_id = "evt_123"
2. Send webhook with event_id = "evt_456"
3. Both processed independently (different event_ids)

---

## 4. Error Handling (Message Sanitization)

### What is it?

Error message sanitization prevents leaking sensitive details to the client while maintaining useful debugging information server-side.

### Problem Example

**Before (unsafe):**
```javascript
res.status(400).json({
  error: 'Failed',
  message: error.message  // Could be: "Invalid key_id" or "API error at /v1/payments/fetch"
});
```

**After (safe):**
```javascript
const safeMessage = sanitizeRazorpayError(error, 'fetch-payment');
res.status(400).json({
  error: 'Payment verification failed',
  message: safeMessage  // Always: "Payment not found" or "Operation failed"
});
```

### Implementation

**Code Location:** `src/routes/payments.js` and `src/routes/refunds.js`

```javascript
function sanitizeRazorpayError(error, context) {
  // The razorpay SDK doesn't always set a top-level `.message` (see DEF-001 in
  // docs/DEFECTS.md) - fall back to `.error.description` so this never sees `undefined`.
  const fullMessage = error.message || error.error?.description || '';

  // Log full error server-side for debugging
  console.error(`[${context}] Razorpay error:`, fullMessage || '(no message provided by SDK)', '| statusCode:', error.statusCode);

  // Return safe client-facing message
  if (fullMessage.includes('payment not found')) {
    return 'Payment not found.';
  }
  if (fullMessage.includes('cannot refund')) {
    return 'Payment cannot be refunded (must be in captured state).';
  }
  // ... more patterns ...

  return 'Operation failed. Please try again.';
}
```
**Historical note:** the `error.error?.description` fallback and the `error.statusCode`-based
HTTP status derivation (used by the routes that call this function) were added in Phase
3.3.1 as the fix for DEF-001 — the original version assumed `error.message` always
existed, which crashed the server when it didn't. See `docs/DEFECTS.md`.

### Patterns Recognized

| Error Pattern | Safe Response |
|---------------|---------------|
| "payment not found" | "Payment not found." |
| "cannot refund" | "Payment cannot be refunded (must be in captured state)." |
| "Invalid amount" | "Invalid refund amount." |
| "timeout" | "Payment gateway unavailable. Please try again." |
| "Invalid key" | "Payment gateway error. Please try again later." |
| Other | "Operation failed. Please try again." |

### Why this matters

- **Prevents information leakage:** Doesn't expose API key issues, internal paths, SDK versions
- **Improves UX:** Returns meaningful messages (payment not found) instead of cryptic errors
- **Maintains debuggability:** Full errors logged server-side for QA/debugging
- **Protects security:** Doesn't hint at system internals

### Testing

Verify that error responses:
- ✅ Don't include raw Razorpay error messages
- ✅ Don't expose API configuration
- ✅ Return appropriate HTTP status codes
- ✅ Include helpful messages for expected failures

---

## 5. Payment State Management

### What is it?

Local state tracking represents the payment lifecycle so the system knows the current
status of each order, and so a webhook or repeated API call can't silently corrupt it.

### Order States

```
created ──▶ authorized ──▶ paid ──▶ refunded
   │                          ▲
   └────────▶ paid ───────────┘
   └────────▶ failed
authorized ──▶ failed
```
`failed` and `refunded` are terminal. A same-state transition (e.g. a replayed `/verify`
call, or a duplicate webhook for an order already `paid`) is always allowed as a no-op.

### Implementation

**Code Location:** `src/stateMachine.js` (`canTransition()`, the allow-list of legal
transitions) + `src/orderStore.js` (`transitionOrder()`, the single guarded write path
used by `/api/payments/verify`, `/api/refunds/create`, and `/api/webhooks/razorpay` alike)

**Order Record** (SQLite `orders` table via `src/db.js`):
```javascript
{
  id: string,                          // Razorpay order_id
  amount: number,                      // Amount in paise
  currency: string,                    // 'INR'
  status: 'created'|'authorized'|'paid'|'failed'|'refunded',
  payment_id: string|null,              // null until payment verified
  payment_status: string|null,          // 'captured', 'authorized', 'failed'
  created_at: string,                   // ISO timestamp
  updated_at: string,                   // ISO timestamp of last update
  receipt: string,                     // Unique receipt
}
```
Refunds live in a separate `refunds` table (supports multiple partial refunds per
payment); webhook events in `webhook_events` (durable idempotency + audit log).

**State Transitions:**

| Event | Code Location | State Before | State After |
|-------|---------------|--------------|-------------|
| Order created | `payments.js` (`create-order`) | — | created |
| Payment verified (captured) | `payments.js` (`/verify`) | created | paid |
| Payment verified (authorized) | `payments.js` (`/verify`) | created | authorized |
| Full refund created | `refunds.js` (`/refunds/create`) | paid | refunded |
| Webhook `payment.authorized`/`captured`/`failed`/`refund.created` | `webhooks.js`, via `transitionOrder()` | (guarded by state machine) | per allow-list above |

### Why this matters

- **Prevents state confusion:** System knows if order is paid, failed, or pending
- **Supports QA scenarios:** Replay/duplicate/idempotency tests all rely on this guard
- **Protects against out-of-order events:** A late `payment.authorized` webhook arriving
  after `payment.captured` already moved the order to `paid` is rejected by
  `canTransition('paid', 'authorized')` rather than silently regressing the order
- **Simple but complete:** Tracks essentials without overengineering

### Current Limitations

- **Real Razorpay-originated webhook delivery not demonstrated** — webhook-driven
  transitions are implemented and deterministically tested, but not yet exercised by an
  actual Razorpay-sent webhook (see `docs/DEFECTS.md`)

**Resolved (no longer current limitations):** webhook events now do drive state
transitions (previously logged only); state is now durable across restarts (SQLite, not
in-memory); and state-machine validation now exists (`src/stateMachine.js`) — all three
were introduced in Phase 3.3.

### Testing

**Create order:**
- POST /api/payments/create-order → status = 'created'

**Verify payment:**
- POST /api/payments/verify (valid signature) → status = 'paid'
- Verify GET /api/payments/orders/:orderId shows status = 'paid'

**Verify amount:**
- Both order and payment show same amount

---

## Security Checklist

✅ Payment signature verification (HMAC-SHA256)  
✅ Webhook signature validation (HMAC-SHA256 with raw body)  
✅ Webhook idempotency (event_id tracking)  
✅ Error message sanitization (no API details leaked)  
✅ Local payment state management (created → paid → refunded)  
✅ No hardcoded secrets (all from environment)  
✅ No secret logging (key_secret never logged)  
✅ HTTPS-ready (all security measures are transport-agnostic)  

---

## Security Defects Found & Resolved

Two genuine High-severity defects were discovered in these controls during testing,
root-caused, fixed, and given dedicated regression tests. This section summarizes them;
`docs/DEFECTS.md` is the authoritative, detailed record (reproduction steps, exact log
evidence, suggested-vs-applied fix).

### DEF-001 — Refund Error Handling Server Crash

- **Severity:** High
- **Symptom:** Any Razorpay-rejected refund request crashed the entire Node process,
  taking down the whole application, not just that one request.
- **Root cause:** `src/routes/refunds.js` (and identically, `src/routes/payments.js`)
  derived the HTTP status code with `error.message.includes(...)`, but the `razorpay` SDK
  throws error objects that don't set a top-level `.message` — the resulting `TypeError`
  was uncaught inside the `catch` block itself.
- **Fix:** Status code now derived from `error.statusCode`; `sanitizeRazorpayError()` (§4
  above) falls back to `error.error?.description`.
- **Regression coverage:** `tests/security/refund-error-handling.spec.js` (`REF-ERR-001`,
  `REF-ERR-002`) — asserts both a controlled error response and that the server stays
  alive and responsive immediately afterward.
- **Status:** ✅ RESOLVED

### DEF-002 — Webhook Raw-Body Middleware Ordering

- **Severity:** High
- **Symptom:** No correctly-signed webhook — real or locally simulated — could ever be
  accepted; every request to `/api/webhooks/razorpay` returned `401`, regardless of how
  correct its signature was.
- **Root cause:** `src/app.js` mounted the global `express.json()` body parser before the
  webhook router, so by the time the route's own `express.raw()` middleware ran, the body
  had already been consumed and parsed — the HMAC was computed over the string
  `"[object Object]"` instead of the real raw bytes.
- **Fix:** The webhook router is now mounted *before* `express.json()` in `src/app.js` — a
  pure reordering of two existing lines; `validateWebhookSignature()` itself was not
  changed, weakened, or bypassed.
- **Regression coverage:** `tests/security/webhook-validation.spec.js` (`WEB-001`,
  `WEB-005`, `WEB-006`, `WEB-007`, and the dedicated `WEB-FIX-001..004`) — signature
  acceptance, tamper rejection, and idempotency are all exercised deterministically.
- **Status:** ✅ RESOLVED (at the deterministic/local level — real Razorpay-originated
  delivery remains a separate, unresolved limitation; see §3's Limitations above)

---

**Security Implementation Status:** Current as of Phase 3.3.1. Original controls introduced
in Phase 2.1; persistence, state-machine guards, and the two defect fixes above were added
in Phase 3.3/3.3.1. See `docs/DEFECTS.md` and `docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md`.
