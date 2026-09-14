# Test Case Inventory

## Overview

This document lists all test cases for Phase 3 automation. Test cases are organized by functional area with unique IDs for reference.

## Phase 3.3 Update (2026-09-14)

With real Razorpay Test Mode credentials and a live zrok tunnel available, several
previously-BLOCKED tests were re-executed with real data and reclassified. Full
detail in `docs/PHASE-3.3-TEST-REPORT.md` and `docs/DEFECTS.md`. Summary of changes:

- **SIG-001** rewritten to use a real captured Test Mode payment (`order_TbqFacJFNAGXm5` /
  `pay_TbqJMlA39g3qiF`, captured via live Checkout with card `5267 3181 8797 5449`)
  instead of fabricated IDs. Now genuinely exercises the accept path. **PASSED**.
- **REPLAY-001** (new) — repeated `/verify` calls against the same real payment stay
  idempotent, no duplicate/corrupted order state. **PASSED**.
- **ORDER-003** (new, previously BLOCKED/spec-only) — client-supplied `amount`/`currency`
  are ignored by the backend. **PASSED**.
- **WEB-001, WEB-005, WEB-006, WEB-007** — root-caused to **DEF-002** (a global
  `express.json()` body parser in `src/app.js` consumed the request body before the
  webhook route's `express.raw()` could see it, so no correctly-signed webhook could ever
  be accepted). Previously misattributed to "test infrastructure/payload serialization."
- **STATE-001 / STATE-002** — now genuinely exercised: `order_TbqFacJFNAGXm5` transitioned
  `created` → `paid` after real `/verify`, `paymentId`/`paymentStatus` populated correctly.
  See Phase 3.3 report for evidence.
- Persistence is now SQLite-backed (`src/db.js`, `src/orderStore.js`) instead of in-memory;
  order state was confirmed to survive both a clean restart and an actual process crash.
- Refund tests (REF-002 and beyond) remain BLOCKED — see **DEF-001** (a refund API error
  crashes the whole process) and the Razorpay Test Mode account-level refund rejection
  documented in `docs/DEFECTS.md`.

## Phase 3.3.1 Update (2026-09-14) — Defect Remediation

Both DEF-001 and DEF-002 are now **RESOLVED** — see `docs/DEFECTS.md` and
`docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md` for full root cause/fix/regression detail.

- **WEB-001, WEB-005, WEB-006, WEB-007** — now genuinely **PASS** (unmodified assertions;
  only a stale comment was removed and WEB-001's hardcoded event ID was made unique to
  avoid colliding with itself across runs now that idempotency is durable).
- **WEB-FIX-001 through WEB-FIX-004** (new) — dedicated DEF-002 regression tests using a
  correctly Razorpay-shaped payload against the real order/payment, confirming the
  webhook-driven state transition (not just the HTTP status) survives the fix. **PASSED**.
- **REF-ERR-001 / REF-ERR-002** (new) — DEF-001 regression: a Razorpay-rejected refund now
  returns a controlled error and the server stays alive and responsive immediately
  afterward. **PASSED**.
- Real Razorpay-originated webhook delivery is still **BLOCKED** (Dashboard configuration
  outside this session's access — unrelated to DEF-002, which is a code fix, not a
  Dashboard fix).
- Refund execution is still **BLOCKED — Razorpay environment/account limitation**,
  re-confirmed live post-fix: the same account-level rejection occurs, now surfaced safely
  instead of crashing the server.
- Full automated suite: **37/37 passing** (Chromium), run three times this phase
  (post-fix, after adding new regression tests, and after a full clean restart).

---

## HEALTH & CONFIGURATION

### HEALTH-001
- **Scenario:** GET /health returns application health
- **Type:** API
- **Preconditions:** Application running on localhost:3000
- **Expected Result:** 
  - HTTP 200
  - Response includes: status: 'ok', timestamp, environment
  - Response is valid JSON
- **Environment:** Local (no credentials required)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### CONFIG-001
- **Scenario:** GET /api/payments/config returns public configuration
- **Type:** API
- **Preconditions:** Application running
- **Expected Result:**
  - HTTP 200
  - Response includes: keyId, currency, configured (boolean)
  - Response is valid JSON
- **Environment:** Local (no credentials required)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### CONFIG-002
- **Scenario:** GET /api/payments/config does NOT expose secrets
- **Type:** Security
- **Preconditions:** Application running with env vars set
- **Expected Result:**
  - keySecret NOT in response
  - webhookSecret NOT in response
  - Only keyId (public) included
- **Environment:** Local
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### CONFIG-003
- **Scenario:** GET /api/payments/config returns "NOT_CONFIGURED" when Razorpay not set up
- **Type:** API
- **Preconditions:** RAZORPAY_KEY_ID not in environment
- **Expected Result:**
  - HTTP 200
  - keyId: "NOT_CONFIGURED"
  - configured: false
- **Environment:** Local (credentials not required)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

---

## ORDER CREATION

### ORDER-001
- **Scenario:** POST /api/payments/create-order creates valid order
- **Type:** API
- **Preconditions:** Razorpay credentials configured, application running
- **Expected Result:**
  - HTTP 200
  - Response includes: orderId, amount, currency, productName, status: 'order_created'
  - amount = 50000 (₹500.00 in paise)
  - currency = 'INR'
  - productName = 'Demo Product'
- **Environment:** Razorpay Test Mode required
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

### ORDER-002
- **Scenario:** POST /api/payments/create-order with missing credentials returns error
- **Type:** API
- **Preconditions:** Razorpay credentials NOT configured
- **Expected Result:**
  - HTTP 503
  - error: 'Razorpay not configured'
  - Safe error message (no API details exposed)
- **Environment:** Local (test without credentials)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### ORDER-003
- **Scenario:** Amount is always 50000 (₹500) regardless of request
- **Type:** Business Logic
- **Preconditions:** Razorpay credentials configured
- **Expected Result:**
  - POST /api/payments/create-order always returns amount: 50000
  - Client cannot specify different amount
  - Backend controls the amount
- **Environment:** Razorpay Test Mode required
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

---

## PAYMENT SIGNATURE VERIFICATION

### SIG-001
- **Scenario:** POST /api/payments/verify with valid signature accepts payment
- **Type:** Security
- **Preconditions:** Valid orderId, paymentId, and correct HMAC-SHA256 signature
- **Expected Result:**
  - HTTP 200
  - verified: true
  - paymentDetails returned
- **Environment:** Test data (no real Razorpay transaction required)
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

### SIG-002
- **Scenario:** POST /api/payments/verify with invalid signature rejects payment
- **Type:** Security
- **Preconditions:** Valid orderId, paymentId, but WRONG signature
- **Expected Result:**
  - HTTP 401
  - error: 'Unauthorized'
  - message: 'Payment signature verification failed'
  - Payment NOT accepted
- **Environment:** Local (test data)
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

### SIG-003
- **Scenario:** POST /api/payments/verify with tampered orderId rejects payment
- **Type:** Security
- **Preconditions:** Valid orderId/paymentId but signature generated with different orderId
- **Expected Result:**
  - HTTP 401
  - Unauthorized
- **Environment:** Local (test data)
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

### SIG-004
- **Scenario:** POST /api/payments/verify with missing signature field rejects request
- **Type:** API
- **Preconditions:** Request body missing 'signature' field
- **Expected Result:**
  - HTTP 400
  - error: 'Missing required fields'
- **Environment:** Local
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

### SIG-005
- **Scenario:** POST /api/payments/verify with missing orderId rejects request
- **Type:** API
- **Preconditions:** Request missing 'orderId' field
- **Expected Result:**
  - HTTP 400
  - error: 'Missing required fields'
- **Environment:** Local
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

### SIG-006
- **Scenario:** POST /api/payments/verify with missing paymentId rejects request
- **Type:** API
- **Preconditions:** Request missing 'paymentId' field
- **Expected Result:**
  - HTTP 400
  - error: 'Missing required fields'
- **Environment:** Local
- **Automation Status:** 🔒 BLOCKED (Phase 3.2 — Razorpay credentials required)

---

## WEBHOOK VALIDATION

### WEB-001
- **Scenario:** POST /api/webhooks/razorpay with valid signature accepts webhook
- **Type:** Security
- **Preconditions:** Valid raw body, correct X-Razorpay-Signature, unique X-Razorpay-Event-Id
- **Expected Result:**
  - HTTP 200
  - success: true
  - message: 'Webhook received and validated'
- **Environment:** Local (mock payload)
- **Automation Status:** ✅ AUTOMATED — PASSED (Phase 3.3.1, after DEF-002 fix; see `docs/DEFECTS.md`)

### WEB-002
- **Scenario:** POST /api/webhooks/razorpay with invalid signature rejects webhook
- **Type:** Security
- **Preconditions:** Valid payload, but WRONG X-Razorpay-Signature
- **Expected Result:**
  - HTTP 401
  - error: 'Unauthorized'
  - message: 'Webhook signature validation failed'
  - Webhook NOT processed
- **Environment:** Local (mock payload)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — Error case, works without credentials)

### WEB-003
- **Scenario:** POST /api/webhooks/razorpay with missing signature header rejects webhook
- **Type:** Security
- **Preconditions:** Request missing X-Razorpay-Signature header
- **Expected Result:**
  - HTTP 401
  - error: 'Unauthorized'
- **Environment:** Local
- **Automation Status:** ✅ AUTOMATED (Batch 1 — Error case, works without credentials)

### WEB-004
- **Scenario:** POST /api/webhooks/razorpay with missing event ID rejects webhook
- **Type:** Security/API
- **Preconditions:** Request missing X-Razorpay-Event-Id header
- **Expected Result:**
  - HTTP 400
  - error: 'Bad Request'
  - message: 'X-Razorpay-Event-Id header is required'
- **Environment:** Local
- **Automation Status:** ✅ AUTOMATED (Batch 1 — Error case, works without credentials)

### WEB-005
- **Scenario:** Same webhook event ID sent twice is processed only once (idempotency)
- **Type:** Integration/Security
- **Preconditions:** Valid webhook with event_id = 'evt_test_123'
- **Expected Result:**
  - First webhook: HTTP 200, processed
  - Second webhook (same event_id): HTTP 200, returns 'Already processed'
  - Event not reprocessed
- **Environment:** Local (mock payload)
- **Automation Status:** ✅ AUTOMATED — PASSED (Phase 3.3.1, after DEF-002 fix; see `docs/DEFECTS.md`)

### WEB-006
- **Scenario:** Different webhook event IDs are processed independently
- **Type:** Integration
- **Preconditions:** Two webhooks with different event_ids
- **Expected Result:**
  - First webhook (evt_001): processed
  - Second webhook (evt_002): processed
  - Both events are distinct
- **Environment:** Local (mock payload)
- **Automation Status:** ✅ AUTOMATED — PASSED (Phase 3.3.1, after DEF-002 fix; see `docs/DEFECTS.md`)

### WEB-007
- **Scenario:** Webhook with tampered payload but correct signature is rejected
- **Type:** Security
- **Preconditions:** Payload modified after signature generation
- **Expected Result:**
  - HTTP 401
  - Signature validation fails
- **Environment:** Local (test data)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — Error case, works without credentials)

---

## ERROR HANDLING

### ERR-001
- **Scenario:** Order creation error response does NOT expose Razorpay API details
- **Type:** Security
- **Preconditions:** Razorpay API error occurs (e.g., invalid key)
- **Expected Result:**
  - HTTP 400 or 503
  - Error message is safe (e.g., "Payment gateway error. Please try again later.")
  - No raw Razorpay SDK error message
  - No API key visible
  - No internal path visible
- **Environment:** Local (test without valid credentials)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### ERR-002
- **Scenario:** Payment verification error response does NOT expose internal details
- **Type:** Security
- **Preconditions:** Payment verification fails
- **Expected Result:**
  - Safe error message
  - No stack trace
  - No API configuration details
- **Environment:** Local (test data)
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### ERR-003
- **Scenario:** 404 endpoint returns appropriate error
- **Type:** API
- **Preconditions:** Request to undefined endpoint
- **Expected Result:**
  - HTTP 404
  - error: 'Not Found'
  - message includes endpoint path
- **Environment:** Local
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### ERR-004
- **Scenario:** Malformed JSON request returns 400 error
- **Type:** API
- **Preconditions:** Invalid JSON in request body
- **Expected Result:**
  - HTTP 400
  - Safe error message
- **Environment:** Local
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

---

## REFUND ENDPOINTS

### REF-001
- **Scenario:** POST /api/refunds/create requires paymentId
- **Type:** API
- **Preconditions:** Request missing paymentId
- **Expected Result:**
  - HTTP 400
  - error: 'Missing required field'
  - message: 'paymentId is required'
- **Environment:** Local
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED all 3 browsers)

### REF-002
- **Scenario:** POST /api/refunds/create with invalid paymentId returns safe error
- **Type:** API
- **Preconditions:** Razorpay credentials configured, paymentId doesn't exist
- **Expected Result:**
  - HTTP 404 or 400
  - Safe error message (not raw Razorpay error)
- **Environment:** Razorpay Test Mode (or test without valid credentials)
- **Automation Status:** ✅ VERIFIED MANUALLY (Phase 3.3.1) — invalid paymentId now safely
  returns `404` with a sanitized message and no server crash (previously crashed the
  process — DEF-001, now fixed). Automated equivalent: `REF-ERR-001` in
  `tests/security/refund-error-handling.spec.js` (uses a different unknown paymentId).

---

## UI BEHAVIOR (Browser)

### UI-001
- **Scenario:** Frontend page loads and displays payment form
- **Type:** UI
- **Preconditions:** Navigate to http://localhost:3000
- **Expected Result:**
  - Page loads without errors
  - Product name displayed
  - Amount displayed
  - "Pay Now" button present
- **Environment:** Chromium browser
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED Chromium) | 🚧 BLOCKED (Firefox/WebKit — WebKit not installed)

### UI-002
- **Scenario:** Frontend amount displayed matches backend-controlled amount
- **Type:** UI/Security
- **Preconditions:** Page loaded, backend amount = 50000 paise
- **Expected Result:**
  - Amount displayed = '₹500.00'
  - Amount matches backend value
- **Environment:** Chromium browser
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED Chromium) | 🚧 BLOCKED (Firefox/WebKit — WebKit not installed)

### UI-003
- **Scenario:** Razorpay Checkout script loaded from official CDN
- **Type:** Security/UI
- **Preconditions:** Page loaded
- **Expected Result:**
  - Razorpay script present in page
  - Script loaded from official CDN (checkout.razorpay.com)
  - No credentials exposed in HTML
- **Environment:** Chromium browser
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED Chromium) | 🚧 BLOCKED (Firefox/WebKit — WebKit not installed)

### UI-004
- **Scenario:** Page does NOT expose secrets in HTML
- **Type:** Security
- **Preconditions:** Page loaded
- **Expected Result:**
  - RAZORPAY_KEY_SECRET NOT visible in HTML
  - RAZORPAY_WEBHOOK_SECRET NOT visible in HTML
  - Only public keyId (if configured) visible
  - No environment variables exposed
- **Environment:** Chromium browser
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED Chromium) | 🚧 BLOCKED (Firefox/WebKit — WebKit not installed)

### UI-005
- **Scenario:** Test Mode indicator is visible on page
- **Type:** UI
- **Preconditions:** Page loaded, running in Test Mode
- **Expected Result:**
  - "Test Mode" or "Testing" indicator visible
  - User understands this is not production
- **Environment:** Chromium browser
- **Automation Status:** ✅ AUTOMATED (Batch 1 — PASSED Chromium) | 🚧 BLOCKED (Firefox/WebKit — WebKit not installed)

---

## STATE MANAGEMENT

### STATE-001
- **Scenario:** Order state transitions from 'created' to 'paid' after payment verification
- **Type:** Integration
- **Preconditions:** Order created, payment verified
- **Expected Result:**
  - Initial state: 'created'
  - After verification: 'paid'
  - paymentId populated
  - paymentStatus set
- **Environment:** Requires Razorpay credentials
- **Automation Status:** ✅ VERIFIED MANUALLY (Phase 3.3) — real order `order_TbqFacJFNAGXm5`
  confirmed `created` → `paid` via GET `/api/payments/orders/:orderId` before/after a real
  Checkout payment.

### STATE-002
- **Scenario:** Order state includes payment information after verification
- **Type:** Integration
- **Preconditions:** Order created, payment verified
- **Expected Result:**
  - paymentId not null
  - paymentStatus = 'captured' or 'authorized'
  - updatedAt timestamp updated
- **Environment:** Requires Razorpay credentials
- **Automation Status:** ✅ VERIFIED MANUALLY (Phase 3.3) — same real order shows
  `paymentId: pay_TbqJMlA39g3qiF`, `paymentStatus: captured`, `updatedAt` advanced.

---

## SUMMARY

| Status | Count |
|--------|-------|
| ✅ AUTOMATED (Passed execution) | 14 |
| 🔒 BLOCKED (Razorpay Credentials) | 12 |
| 🚧 BLOCKED (WebKit Browser) | 5 |
| ⏹️ DEFERRED (Not yet automated) | 2 |
| **Total Test Cases** | **33** |

---

**Test Case Inventory Status:** Phase 3.1.1 Reconciliation Complete

### Execution Summary (Batch 1 Actual Results)

**Tests That Passed:**
- HEALTH-001, CONFIG-001, CONFIG-002, CONFIG-003 (all 3 browsers)
- ORDER-002 (all 3 browsers)
- ERR-001, ERR-002, ERR-003, ERR-004 (all 3 browsers)
- REF-001 (all 3 browsers)
- WEB-002, WEB-003, WEB-004, WEB-007 (all 3 browsers)
- **Total: 14 tests PASSING**

**Tests Blocked (Environment Missing):**
- Razorpay Credentials Missing (12 tests): ORDER-001, ORDER-003, SIG-001-006, WEB-001/005/006, REF-002
- WebKit Browser Not Installed (5 tests): UI-001-005 (fail on Firefox/WebKit only, pass on Chromium)

**Tests Not Yet Automated:**
- STATE-001, STATE-002 (require state persistence testing)

**Application Status:** ✅ Healthy in all tested areas (no defects found)
**Pass Rate (Deterministic Tests):** 100% (12/12 API/config/error handling tests all passed)

---

## SUMMARY — Phase 3.3.1 (2026-09-14, current)

The table and "Batch 1" summary above are kept as a historical record of the original
Phase 3.1.1 baseline and are intentionally not rewritten. This section reflects the
current, actual state after Phase 3.3 (real Razorpay integration) and Phase 3.3.1
(DEF-001/DEF-002 remediation) — see `docs/PHASE-3.3-TEST-REPORT.md` and
`docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md` for full detail.

| Status | Count |
|--------|-------|
| ✅ Automated, PASSED (Chromium) — **total** | **37** |
| ↳ of which: CI-safe (run automatically by GitHub Actions) | **34** |
| ↳ of which: Razorpay-live (`SIG-001`, `REPLAY-001`, `UI-002` — manual only, `npm run test:razorpay`) | **3** |
| ✅ Verified manually (real Razorpay Test Mode) | STATE-001, STATE-002, REF-002 |
| 🔒 BLOCKED — Razorpay account/environment limitation (not a code defect) | Full/partial refund execution |
| 🔒 BLOCKED — outside session access (Dashboard config) | Real Razorpay-originated webhook delivery |

This 37/34/3 split is confirmed directly via `npx playwright test --list` (and its
`--grep`/`--grep-invert "@razorpay-live"` variants) and is consistent with
`docs/CI-CD.md` and `docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md`.

**Defects found across Phase 3.3/3.3.1:** 2 (DEF-001, DEF-002), both **RESOLVED** and
regression-tested — see `docs/DEFECTS.md`.
