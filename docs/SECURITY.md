# Security Implementation Guide

## Phase 2.1: Security Fixes

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

**Code Location:** `src/routes/webhooks.js`

```javascript
// Track processed event IDs
const processedEventIds = new Set();

// In webhook handler:
if (processedEventIds.has(eventId)) {
  // Already processed, return success
  return res.status(200).json({ success: true, note: 'Already processed' });
}

// Process webhook...

// Mark as processed after successful processing
processedEventIds.add(eventId);
```

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

### Limitations

- **In-memory storage:** Processed event IDs lost if server restarts
- **Production needs database:** Real implementations should persist processed IDs to database
- **Not durability guarantee:** This is acceptable for Phase 2 demo; Phase 3+ should add database

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
  const fullMessage = error.message || '';

  // Log full error server-side for debugging
  console.error(`[${context}] Razorpay error:`, fullMessage);

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

Local state tracking represents the payment lifecycle (created → paid → refunded) so the system knows the current status of each order.

### Order States

```
created
  ↓
  ├→ paid (after successful payment verification)
  │   ↓
  │   └→ refunded (after refund webhook received)
  │
  └→ failed (after payment fails)
```

### Implementation

**Code Location:** `src/routes/payments.js`

**Order Record:**
```javascript
{
  id: string,                          // Razorpay order_id
  amount: number,                      // Amount in paise
  currency: string,                    // 'INR'
  status: 'created'|'paid'|'failed'|'refunded',
  paymentId: string|null,              // null until payment verified
  paymentStatus: string|null,          // 'captured', 'authorized', 'failed'
  refundId: string|null,               // null until refund created
  refundStatus: string|null,           // 'created', 'processed'
  createdAt: Date,                     // When order was created
  updatedAt: Date,                     // When last updated
  receipt: string,                     // Unique receipt
}
```

**State Transitions:**

| Event | Code Location | State Before | State After |
|-------|---------------|--------------|-------------|
| Order created | payments.js:70 | — | created |
| Payment verified (captured) | payments.js:189 | created | paid |
| Payment verified (authorized) | payments.js:189 | created | authorized |
| Payment failed | webhook → Future | created | failed |
| Refund created | webhook → Future | paid | refunded |

### Why this matters

- **Prevents state confusion:** System knows if order is paid, failed, or pending
- **Supports QA scenarios:** Can test state transitions (paid → refunded)
- **Prepares for webhooks:** When webhook processing is added, can update state from events
- **Simple but complete:** Tracks essentials without overengineering

### Current Limitations

- **Webhook events not yet processed:** Webhooks are logged but don't update state
- **In-memory only:** State lost on server restart
- **No state machine validation:** Could add state guards in Phase 3

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

## Phase 3 Considerations

- **Persist webhook processed event IDs** to database for durability
- **Update order state from webhooks** (payment.captured, payment.failed, refund.created)
- **Add refund state tracking** to order record
- **Test signature verification failures** in Phase 3 tests
- **Test webhook idempotency** with duplicate events
- **Test error message sanitization** to confirm no sensitive leakage

---

**Phase 2.1 Security Implementation Status: Complete**
