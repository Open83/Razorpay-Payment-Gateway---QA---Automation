# QA Test Strategy — Phase 3

## Executive Summary

This document defines the QA testing approach for the Razorpay Payment Gateway integration project. Tests are organized by scope, environment dependency, and risk priority. The strategy separates deterministic local tests from those requiring Razorpay Test Mode credentials and webhook infrastructure.

---

## 1. SCOPE

### Testing Coverage

**IN SCOPE:**
- Payment order creation and state management
- Payment amount integrity and backend validation
- Payment signature verification (HMAC-SHA256)
- Webhook signature validation (HMAC-SHA256)
- Webhook event deduplication (idempotency)
- Webhook event ID tracking
- Refund order creation and API behavior
- Error handling and message sanitization
- API endpoint contracts
- Configuration security (no secret exposure)
- Frontend payment flow (deterministic UI behavior)
- Negative scenarios (invalid inputs, missing fields)

**OUT OF SCOPE (Phase 3):**
- End-to-end payment completion with real Razorpay checkout
- Full refund workflow execution
- Webhook state transitions (logged but not yet processed)
- Database persistence (in-memory only in Phase 2)
- Production deployment
- CI/CD pipeline configuration
- Performance/load testing
- Browser compatibility matrix (Phase 3 uses Chromium only)

---

## 2. TEST LEVELS

### 2.1 API Tests

**Purpose:** Validate HTTP endpoints, request/response contracts, status codes, error handling

**Examples:**
- Health check endpoint
- Payment configuration endpoint
- Order creation endpoint
- Payment verification endpoint
- Webhook reception endpoint
- Refund creation endpoint

**Tools:** Playwright APIRequest context

**Assertions:**
- HTTP status codes (200, 400, 401, 404, 503)
- Response structure and required fields
- No secret exposure in responses
- Safe error messages
- Idempotency behavior

### 2.2 Security Tests

**Purpose:** Validate authentication, signature verification, state integrity, error message safety

**Examples:**
- Payment signature verification (valid, invalid, tampered)
- Webhook signature validation (valid, invalid, missing)
- Webhook event ID deduplication
- Order amount integrity (cannot be changed by frontend)
- Configuration does not expose secrets
- Error messages do not leak internal details

**Tools:** Playwright API testing + crypto utilities for signature generation

**Assertions:**
- Invalid signatures are rejected
- Valid signatures are accepted
- Duplicate webhook events are not reprocessed
- Error messages are safe (no API keys, internal paths, stack traces)

### 2.3 Integration Tests

**Purpose:** Validate workflows that span multiple endpoints

**Examples:**
- Order creation → payment verification → state update
- Webhook reception → validation → event logging → idempotency on retry

**Tools:** Playwright API testing with sequence verification

**Assertions:**
- State transitions are correct
- Order state changes after payment verification
- Webhook events are processed only once

### 2.4 UI Tests

**Purpose:** Validate frontend rendering and deterministic user interactions

**Examples:**
- Page loads and displays payment form
- Amount displayed matches backend-controlled amount
- Configuration does not expose secrets in frontend
- Error messages are user-friendly

**Tools:** Playwright browser automation (Chromium only for Phase 3)

**Assertions:**
- Elements present/visible
- Correct text displayed
- Form interactivity
- No console errors (where safe)

---

## 3. TEST DATA STRATEGY

### Data Isolation

- No real customer data
- No real payment card numbers (use Razorpay test cards only)
- Generated order IDs, receipt numbers, event IDs
- Controlled test amounts (e.g., ₹500.00 fixed from config)

### Test Fixtures

**Webhook test payloads:**
- Valid webhook event (payment.captured, payment.failed, refund.created)
- Signature generation for controlled testing

**Signature test data:**
- Test order IDs and payment IDs
- Known test secret for deterministic signature generation
- Valid/invalid/tampered signature variations

**Order test data:**
- Valid order creation requests
- Invalid/malformed requests (missing fields, wrong types)

---

## 4. ENVIRONMENT STRATEGY

### Local Deterministic Tests (No Credentials Required)

**Can run without Razorpay credentials:**
- Health check
- Configuration endpoint (verify structure)
- Signature verification (HMAC validation with test data)
- Webhook signature validation
- Webhook idempotency (with mock payloads)
- Error handling
- API contract validation

**Execution:** `npm test` (all deterministic tests)

### Razorpay Test Mode Tests (Requires Credentials)

**Requires `.env` with valid Razorpay Test Mode credentials:**
- Order creation via Razorpay API
- Payment verification against actual Razorpay payment
- Refund creation via Razorpay API
- Full checkout flow (future phase)

**Execution:** Marked as `@skip-without-credentials` or similar

**Detection:** Test checks if `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are configured; skips if missing with clear message

### Webhook Infrastructure Tests

**Requires webhook endpoint accessibility:**
- Webhook event delivery (requires external source or ngrok tunnel)
- Webhook retry scenarios

**Current limitation:** Local testing uses mock payloads; production webhook testing requires external infrastructure

---

## 5. RISK-BASED PRIORITIES

### CRITICAL (Payment Integrity)

1. **Payment Signature Verification**
   - Prevents fake/spoofed payments
   - Invalid signatures must be rejected
   - Defect: Could allow payment forgery

2. **Payment Amount Integrity**
   - Backend must control amount
   - Frontend cannot change amount
   - Defect: Could allow underpayment

3. **Webhook Idempotency**
   - Same event must not process twice
   - Prevents duplicate refunds, double payments
   - Defect: Refund processed twice = customer credit twice

### HIGH (State & Data)

4. **Order State Transitions**
   - created → paid → refunded workflow
   - No invalid transitions
   - Defect: Unclear order status leads to QA confusion

5. **Webhook Signature Validation**
   - Prevents fake webhook injection
   - Defect: False payment.captured webhook marks order as paid

6. **Error Handling**
   - No sensitive info leakage
   - Client receives safe messages
   - Defect: Error message exposes API key or internal path

### MEDIUM (Behavior)

7. **API Contracts**
   - Endpoints return expected structure
   - HTTP status codes correct
   - Defect: Breaks frontend integration

8. **Configuration Security**
   - Secrets not exposed in config endpoint
   - Defect: API key visible in response

### LOW (Future)

9. **Refund Workflows**
10. **Cross-browser Compatibility**
11. **Performance**

---

## 6. EVIDENCE STRATEGY

### Artifacts Generated

- **Test List:** Playwright test discovery output
- **HTML Report:** Playwright HTML report with pass/fail summary
- **Test Code:** Source in `tests/` directory
- **Test Cases Document:** `docs/TEST-CASES.md` with inventory
- **Logs:** Console output showing what was tested
- **Validation Report:** Confirmation of security controls

### What is NOT Evidence

- Simulated/fabricated test results
- Claim of "payment processed" without actual Razorpay transaction
- Claim of "webhook processed" without actual webhook delivery
- Assumed pass status (only actual execution counts)

---

## 7. TEST EXECUTION CRITERIA

### PASS Criteria

Test passes when:
- Assert condition is true
- HTTP status code is as expected
- Response structure matches schema
- Signature validation works as designed
- No unexpected errors occur

### FAIL Criteria

Test fails when:
- Assert condition is false
- Defect in application behavior
- Environment/setup issue (reported separately)

### SKIP Criteria

Test is skipped when:
- Razorpay credentials not configured (and test requires them)
- Webhook infrastructure not available
- Test environment incomplete
- **Clearly documented as SKIPPED, not hidden or assumed PASS**

---

## 8. FIRST BATCH SCOPE

### First Controlled Automation Batch

Tests that are deterministic and can run locally without Razorpay credentials:

1. **Health Check** — Verify application is running
2. **Config Endpoint** — Verify structure, no secret exposure
3. **Signature Verification** — HMAC validation with test data
4. **Webhook Signature Validation** — HMAC validation
5. **Webhook Idempotency** — Event ID deduplication
6. **Error Handling** — Safe error messages
7. **Order Creation** — Valid requests (assuming Razorpay configured)
8. **Order Creation Errors** — Invalid requests, error handling

### Deferred to Later Phase

- End-to-end checkout flow
- Full payment lifecycle
- Webhook state transitions
- Refund workflows
- Database validation

---

## 9. DEFINITION OF DONE (Phase 3, First Batch)

✅ **Completed:**
- TEST-STRATEGY.md created
- TEST-CASES.md created with test inventory
- Deterministic API tests implemented
- Deterministic security tests implemented
- Webhook validation tests implemented
- Error handling tests implemented
- Tests executed and results reported
- HTML report generated
- Environment limitations documented

⏹️ **STOP:** Do not proceed to full automation, CI/CD, or deployment

---

## 10. BLOCKERS & ASSUMPTIONS

### Blockers for Full Testing

- **Razorpay Test Mode Credentials:** Required for order creation, payment verification, refunds
- **Webhook Infrastructure:** Webhook event delivery testing requires ngrok or similar tunnel
- **Database:** Current in-memory storage; state persistence testing requires database

### Assumptions

- Application is running on localhost:3000
- Node.js v18+ available
- Playwright installed
- .env file can be populated with test credentials (or tests skip gracefully)

---

## 11. NEXT PHASES (Out of Scope)

**Phase 3.2:** Full payment workflow (with Razorpay Test Mode)  
**Phase 3.3:** Webhook event processing and state transitions  
**Phase 4:** CI/CD integration  
**Phase 5:** Production-readiness validation  

---

**Test Strategy Status:** Ready for First Batch Implementation
