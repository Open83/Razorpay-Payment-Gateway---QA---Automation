# Application Architecture

**This document describes the CURRENT architecture** (as of Phase 3.3/3.3.1 — real
Razorpay Test Mode integration, SQLite persistence, and an explicit state machine). Where
earlier design decisions were later superseded, that evolution is called out explicitly
rather than erased, since it's part of this project's own QA history (see
`docs/PHASE-3.3-TEST-REPORT.md` and `docs/DEFECTS.md` for how and why).

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
│  │  ├─ Order/refund/webhook-event persistence (SQLite│  │
│  │  │  via src/db.js + src/orderStore.js)             │  │
│  │  ├─ Payment/order state machine (src/stateMachine.js)│
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
  → Backend validates signature over the RAW request body (HMAC-SHA256)
  → Backend checks the event ID against durable (SQLite) idempotency records
  → Backend parses event (payment.captured, payment.failed, refund.created, etc.)
  → Backend drives the matching order through stateMachine.js's transitionOrder(),
    which rejects out-of-order/contradictory transitions rather than applying them
  → Backend persists the event (audit log) and responds with HTTP 200
```
Note: real Razorpay-originated webhook delivery has not yet been demonstrated in this
project (see `docs/DEFECTS.md` and the README's Webhook Limitation section) — the flow
above is implemented and deterministically tested with correctly-signed local requests.

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

### 3. SQLite-Backed Persistence (evolved from an earlier in-memory design)
- Orders, refunds, and webhook events are persisted in SQLite (`src/db.js`, using Node's
  built-in `node:sqlite` — no external database package)
- **Historical note:** the original Phase 2 design used plain in-memory `Map`/`Set`
  objects, which meant orders and webhook idempotency records were lost on every restart.
  This was replaced with SQLite in Phase 3.3 specifically to support restart safety,
  durable webhook idempotency, and refund/audit history — see `docs/PHASE-3.3-TEST-REPORT.md`.
- WAL mode + a busy-timeout pragma are set so the app process and a test process can both
  safely access the same database file concurrently (see `docs/CI-CD.md`).
- **Use case:** appropriately sized for this project — a single SQLite file, no server
  process, no migrations tooling.

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

### 6. SQLite, Not a Database Server
- Persistence uses Node's built-in `node:sqlite` module — a single file (`data/app.db`),
  no separate database server or Docker container to run
- **Why:** This project deliberately avoided adding infrastructure (no Postgres/Mongo/
  Docker) while still getting genuine restart-safe persistence and durable idempotency —
  see `docs/CI-CD.md` for how CI runs against this same file-based database with no
  additional services

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Node.js | `>=22.5.0` | JavaScript runtime — required by `node:sqlite` |
| Framework | Express.js | 4.18+ | HTTP server |
| Payment API | Razorpay SDK | 2.9+ | Razorpay integration |
| Persistence | `node:sqlite` (built-in) | — | Order/refund/webhook-event storage, no added dependency |
| Configuration | dotenv | 16.3+ | Environment variables |
| Frontend | Vanilla JS + Razorpay Checkout | — | UI and checkout |
| Testing | Playwright Test | 1.40+ | QA automation |
| CI/CD | GitHub Actions | — | `.github/workflows/playwright.yml` |

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

**Implementation:** `src/routes/webhooks.js` + `src/orderStore.js`
- Uses `X-Razorpay-Event-Id` header as unique event identifier
- Tracks processed event IDs durably in the SQLite `webhook_events` table (survives a
  server restart — this was in-memory only in the original Phase 2 design, see the
  Persistence design decision above)
- Duplicate events return HTTP 200 with "already processed" message
- Different event IDs processed independently

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

**Implementation:** `src/stateMachine.js` (the allowed-transition rules) + `src/orderStore.js`
(`transitionOrder()`, the single guarded write path every route uses — `/api/payments/verify`,
`/api/refunds/create`, and `/api/webhooks/razorpay` alike).

**States:** `created`, `authorized`, `paid`, `failed`, `refunded`

**Valid transitions:**
```
created    → authorized
created    → paid
created    → failed
authorized → paid
authorized → failed
paid       → refunded
```
`failed` and `refunded` are terminal (no outgoing transitions). A same-state "transition"
(e.g. a replayed verification call, or a duplicate webhook for an order already `paid`) is
always allowed as a no-op — this is what makes replay/duplicate handling safe rather than
corrupting. Any transition not in the list above (e.g. a late `payment.authorized` webhook
arriving after the order is already `paid`) is rejected by `canTransition()` rather than
silently applied, so an out-of-order event cannot regress a further-along order.

**Local Order Record** (SQLite `orders` table, via `src/db.js`):
```javascript
{
  id: string,                    // Razorpay order ID
  amount: number,                // Amount in paise
  currency: string,              // 'INR'
  status: 'created'|'authorized'|'paid'|'failed'|'refunded',
  payment_id: string|null,        // Razorpay payment ID (after verification)
  payment_status: string|null,    // 'captured', 'authorized', 'failed'
  receipt: string,               // Unique receipt number
  created_at: string,             // ISO timestamp
  updated_at: string,             // ISO timestamp of last state update
}
```
Refunds are tracked in a separate `refunds` table (one row per refund, supporting multiple
partial refunds per payment), and webhook events in a `webhook_events` table (durable
idempotency + audit log) — both also in `data/app.db`, via `src/orderStore.js`.

**State Transitions (concrete triggers):**
- Order created via `/api/payments/create-order` → `status = 'created'`
- `/api/payments/verify` succeeds, payment `captured` → `status = 'paid'`, `payment_status = 'captured'`
- `/api/payments/verify` succeeds, payment `authorized` → `status = 'authorized'`
- `/api/refunds/create` succeeds with a full-amount refund → `status = 'refunded'`
- A `payment.authorized`/`payment.captured`/`payment.failed`/`refund.created` webhook event,
  once its signature is validated, drives the same `transitionOrder()` path

## Limitations & Future Improvements

### Current Limitations
1. **No authentication** — Any user can verify any payment (acceptable for this demo's scope; not a production posture)
2. **Single product** — Fixed amount only (by design for demo)
3. **Real Razorpay-originated webhook delivery not demonstrated** — a public tunnel was
   confirmed reachable, but no webhook from Razorpay's own servers was observed arriving;
   likely a Dashboard configuration gap outside this project's control (see `docs/DEFECTS.md`)
4. **Real refund execution blocked** — a Razorpay Test Mode account/environment
   restriction prevents an actual refund from completing, confirmed independently of this
   app's code (see `docs/DEFECTS.md`)

**Resolved since this document was first written (no longer current limitations):**
in-memory-only storage, no persistent audit trail, no idempotency guarantee across
restarts, and no state machine — all replaced by the SQLite persistence and
`stateMachine.js` described above (Phase 3.3).

### Potential Improvements
1. Add user authentication & authorization
2. Add admin dashboard for order/refund management
3. Support multiple products/amounts
4. Error tracking & alerting
5. Resolve the real-webhook-delivery and real-refund-execution blockers above

## Testing Scope

This architecture supports testing:
- ✅ Payment checkout flow (UI) — including one genuine real Razorpay Test Mode Checkout payment
- ✅ Payment verification (API) — against the real payment above
- ✅ Refund creation (API) — request validation and error handling tested; real execution blocked (see Limitations)
- ✅ Webhook receipt and validation — deterministically tested with real HMAC math; real Razorpay-originated delivery not demonstrated (see Limitations)
- ✅ Payment amount validation
- ✅ Business logic scenarios (state machine transitions, replay protection, idempotency)
- ✅ Error handling
- ✅ Integration scenarios

---

**Architecture Status:** Current as of Phase 3.3.1 (real Razorpay integration, SQLite persistence, state machine, two resolved defects — see `docs/DEFECTS.md`). CI/CD detail in `docs/CI-CD.md`.
