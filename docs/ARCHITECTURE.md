# Application Architecture

## Overview

This is a minimal demo payment application designed to demonstrate QA engineering skills through comprehensive testing of Razorpay payment integration.

**Key Principle:** The application is the system under test. The primary focus is QA automation, not application development.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Frontend)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  HTML Form + Razorpay Checkout (Hosted by RZP)    │  │
│  │  - Product Display                                 │  │
│  │  - Pay Button                                      │  │
│  │  - Status/Result Display                          │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↕ HTTP/REST
┌─────────────────────────────────────────────────────────┐
│                   Backend (Node.js/Express)              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  API Routes Layer                                  │  │
│  │  ├─ /api/payments/config          [GET]           │  │
│  │  ├─ /api/payments/create-order    [POST]          │  │
│  │  ├─ /api/payments/verify          [POST]          │  │
│  │  ├─ /api/payments/:paymentId      [GET]           │  │
│  │  ├─ /api/refunds/create           [POST]          │  │
│  │  ├─ /api/refunds/:refundId        [GET]           │  │
│  │  ├─ /api/webhooks/razorpay        [POST]          │  │
│  │  └─ /api/webhooks/events          [GET/DELETE]    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Business Logic Layer                              │  │
│  │  ├─ Order management (in-memory)                  │  │
│  │  ├─ Payment verification                          │  │
│  │  ├─ Refund processing                             │  │
│  │  └─ Webhook signature validation (HMAC-SHA256)    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Configuration Layer                               │  │
│  │  ├─ Environment variables (.env)                  │  │
│  │  ├─ Razorpay API keys                             │  │
│  │  ├─ Webhook secret                                │  │
│  │  └─ Demo product settings                         │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↕ HTTPS/REST
┌─────────────────────────────────────────────────────────┐
│              Razorpay APIs (Test Mode)                   │
│  ├─ POST /v1/orders           (Create order)            │
│  ├─ GET /v1/payments/:id      (Fetch payment)           │
│  ├─ POST /v1/payments/:id/refund  (Create refund)      │
│  ├─ POST /webhooks/deliver    (Send webhook events)     │
│  └─ Webhook Signature: HMAC-SHA256                      │
└─────────────────────────────────────────────────────────┘
```

## Data Flow: Payment Lifecycle

### 1. Order Creation
```
User visits page
  → Frontend calls GET /api/payments/create-order
    → Backend calls Razorpay API: POST /v1/orders
      → Razorpay creates order, returns order_id
    → Backend stores order locally
    → Frontend displays amount + product info
```

### 2. Checkout & Payment
```
User clicks "Pay Now"
  → Frontend opens Razorpay Checkout (hosted)
  → User enters test card details
  → Razorpay processes payment (test mode = instant)
  → Razorpay returns to app with payment details
    (payment_id, signature)
```

### 3. Payment Verification
```
Frontend receives Razorpay response
  → Frontend calls POST /api/payments/verify
    → Backend calls Razorpay API: GET /v1/payments/:id
      → Razorpay returns payment status
    → Backend verifies:
      - Payment amount matches order
      - Payment status is "captured"
      - Signature is valid
    → Backend returns verification result
  → Frontend displays success/failure
```

### 4. Webhook Event (Asynchronous)
```
Razorpay sends webhook event to /api/webhooks/razorpay
  → Backend validates signature (HMAC-SHA256)
  → Backend parses event (payment.captured, refund.created, etc.)
  → Backend logs event for testing
  → Backend responds with HTTP 200 (quick acknowledgment)
```

### 5. Refund (QA Testing)
```
User/QA clicks "Create Refund"
  → Frontend calls POST /api/refunds/create
    → Backend calls Razorpay API: POST /v1/payments/:id/refund
      → Razorpay initiates refund (test mode = instant)
      → Razorpay sends webhook: refund.created
    → Backend returns refund status
  → Frontend displays refund result
```

## API Endpoints

### Payment Endpoints

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/api/payments/config` | Get public config (key ID) | None |
| POST | `/api/payments/create-order` | Create Razorpay order | None |
| POST | `/api/payments/verify` | Verify payment after checkout | None |
| GET | `/api/payments/:paymentId` | Fetch payment from Razorpay | None |
| GET | `/api/payments/orders/:orderId` | Fetch order from local storage | None |

### Refund Endpoints

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/api/refunds/create` | Create refund on payment | None |
| GET | `/api/refunds/:refundId` | Fetch refund status | None |
| GET | `/api/refunds/payment/:paymentId` | List all refunds for payment | None |

### Webhook Endpoints

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/api/webhooks/razorpay` | Receive Razorpay webhooks | Signature validation |
| GET | `/api/webhooks/events` | List logged webhook events | None (debug only) |
| DELETE | `/api/webhooks/events` | Clear webhook event log | None (debug only) |

## Key Design Decisions

### 1. Backend is Source of Truth for Amount
- Frontend displays amount from backend
- Order amount is set in `config.js`
- Payment verification checks amount against stored order
- **Why:** Prevents amount manipulation attacks

### 2. Webhook Signature Validation (HMAC-SHA256)
- Every webhook must validate signature using webhook secret
- Raw request body used (not parsed JSON)
- Invalid signatures are rejected immediately
- **Why:** Ensures webhooks actually come from Razorpay, not attackers

### 3. In-Memory Order Storage
- Orders stored in JavaScript Map for demo
- No database needed for proof-of-concept
- **Limitation:** Orders lost on app restart
- **Use Case:** Sufficient for QA testing, not production

### 4. Separate Test & Production Configuration
- All credentials in `.env` file (ignored by git)
- `.env.example` shows template only
- Test mode uses `rzp_test_*` keys (different from production)
- **Why:** Prevents accidental use of production credentials

### 5. Minimal Frontend
- No authentication, user accounts, or complex UI
- Single-page form + status display
- Razorpay Checkout handles payment UI (hosted)
- **Why:** Focus is on QA testing, not UI/UX

### 6. No Database
- In-memory storage for demo purposes
- No persistence across server restarts
- **Future:** Database can be added if needed for testing scenarios
- **Why:** Simplicity; current scope doesn't require it

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | v18+ | JavaScript runtime |
| Framework | Express.js | 4.18+ | HTTP server |
| Payment API | Razorpay SDK | 2.9+ | Razorpay integration |
| Configuration | dotenv | 16.3+ | Environment variables |
| Frontend | Vanilla JS + Razorpay Checkout | — | UI and checkout |
| Testing | Playwright Test | 1.40+ | QA automation |

## Security Considerations

### Secrets Management
- All secrets in `.env` file
- `.env` in `.gitignore` (never committed)
- `.env.example` shows template only
- No hardcoded credentials in source code

### Payment Data Handling
- No storage of card details (Razorpay handles PCI)
- No logging of sensitive payment info
- Payment verification required before showing success
- Amount validation on backend

### Webhook Security
- Signature validation mandatory (HMAC-SHA256)
- Raw request body used for validation
- Invalid signatures rejected immediately
- X-Razorpay-Event-Id for deduplication

### CORS & Cross-Site Issues
- Frontend and backend on same origin (localhost:3000)
- No cross-origin requests needed for basic flow
- Razorpay Checkout iframe handles its own security

## Security Implementation (Phase 2.1)

### Payment Signature Verification

**Algorithm:** HMAC-SHA256
```
generated_signature = hmac_sha256(orderId|paymentId, keySecret)
verification = generated_signature === received_signature
```

**Implementation:** `src/routes/payments.js:verifyPaymentSignature()`
- Signature verified before fetching payment from Razorpay
- Invalid signatures rejected immediately with HTTP 401
- Missing signatures rejected with HTTP 400
- Based on official Razorpay documentation

**Verification Flow:**
```
1. Frontend receives razorpay_payment_id, razorpay_signature from Razorpay Checkout
2. Frontend sends to backend: POST /api/payments/verify
3. Backend verifies signature using HMAC-SHA256
4. If invalid → reject (HTTP 401)
5. If valid → fetch payment details from Razorpay
6. Update local order state and return success
```

### Webhook Signature Validation

**Algorithm:** HMAC-SHA256 with raw request body
```
expectedSignature = hmac_sha256(rawBody, webhookSecret)
validation = expectedSignature === X-Razorpay-Signature header
```

**Implementation:** `src/routes/webhooks.js:validateWebhookSignature()`
- Raw request body preserved before parsing
- Signature validated before JSON parsing
- Invalid signatures rejected with HTTP 401
- Based on official Razorpay documentation

### Webhook Idempotency

**Problem Solved:** Same webhook event could be processed multiple times if Razorpay retries

**Implementation:** `src/routes/webhooks.js`
- Uses `X-Razorpay-Event-Id` header as unique event identifier
- Tracks processed event IDs in in-memory Set
- Duplicate events return HTTP 200 with "already processed" message
- Different event IDs processed independently
- In-memory storage only (Phase 2); production would use database

**Deduplication Flow:**
```
1. Webhook received with X-Razorpay-Event-Id header
2. Check if eventId already processed
3. If yes → return HTTP 200 (success)
4. If no → validate signature, parse, process, mark as processed
```

### Error Handling (Sanitization)

**Problem Solved:** Raw Razorpay SDK errors could expose API keys, internal details, stack traces

**Implementation:** `sanitizeRazorpayError()` in payments.js and refunds.js
- Full error logged server-side for debugging
- Safe, generic messages returned to client
- Preserves useful HTTP status codes (404, 400, 503)
- Recognizes common error patterns and returns appropriate messages

**Error Patterns Recognized:**
- "payment not found" → "Payment not found."
- "cannot refund" → "Payment cannot be refunded (must be in captured state)."
- "timeout" → "Payment gateway unavailable. Please try again."
- Others → "Operation failed. Please try again."

### Payment State Management

**Order States:**
```
created    → Initial state when order created
→ paid     → Transition after successful payment verification
→ refunded → Transition after refund created
Or:
created    → failed → Final state after payment fails
```

**Local Order Record** (in-memory Map):
```javascript
{
  id: string,                    // Razorpay order ID
  amount: number,                // Amount in paise
  currency: string,              // 'INR'
  status: 'created'|'paid'|'failed'|'refunded',
  paymentId: string|null,        // Razorpay payment ID (after verification)
  paymentStatus: string|null,    // 'captured', 'authorized', 'failed'
  refundId: string|null,         // Razorpay refund ID
  refundStatus: string|null,     // 'created', 'processed'
  createdAt: Date,               // Order creation timestamp
  updatedAt: Date,               // Last state update
  receipt: string,               // Unique receipt number
}
```

**State Transitions:**
- Order created → status = 'created'
- Payment verified (captured) → status = 'paid', paymentStatus = 'captured'
- Payment verified (authorized) → status = 'authorized', paymentStatus = 'authorized'
- Webhook refund.created → status = 'refunded'

## Limitations & Future Improvements

### Current Limitations
1. **In-memory storage only** — Orders and processed webhooks lost on restart
2. **No database** — No persistent audit trail
3. **No authentication** — Any user can verify any payment
4. **Single product** — Fixed amount only (by design for demo)
5. **Local testing only** — Webhooks need ngrok/tunnel for external testing
6. **No idempotency guarantee** — Set-based deduplication lost on restart (would use database in production)

### Potential Improvements
1. Add database (PostgreSQL, MongoDB)
2. Add user authentication & authorization
3. Add admin dashboard for order/refund management
4. Support multiple products/amounts
5. Persistent webhook event logging
6. Payment state machine implementation
7. Error tracking & alerting

## Testing Scope

This architecture supports testing:
- ✅ Payment checkout flow (UI)
- ✅ Payment verification (API)
- ✅ Refund creation (API)
- ✅ Webhook receipt and validation
- ✅ Payment amount validation
- ✅ Business logic scenarios
- ✅ Error handling
- ✅ Integration scenarios

---

**Architecture Status:** Phase 2 Complete — Minimal demo application with all essential endpoints and webhook validation
