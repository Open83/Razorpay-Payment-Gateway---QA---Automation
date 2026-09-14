# Defect Log

Defects discovered during real Razorpay Test Mode execution (Phase 3.3). Each
defect was reproduced against the live application and, where noted, against
the raw Razorpay API directly (bypassing the app) to isolate root cause.
Per QA policy, defects found during testing were **not** silently fixed —
they are documented here for triage.

---

## DEF-001: Unhandled exception crashes the server on any refund API error

**Status: ✅ RESOLVED (Phase 3.3.1, 2026-09-14)** — see Resolution section below.

**Severity:** High (availability — a single bad/edge-case request takes down the entire process)

**Component:** `src/routes/refunds.js`, `POST /api/refunds/create`

**Preconditions:**
- Application running with valid Razorpay Test Mode credentials
- A `POST /api/refunds/create` request reaches the Razorpay API call (i.e. passes the `paymentId` presence check) and Razorpay's SDK rejects the call for any reason

**Steps to reproduce:**
1. Start the app with real credentials.
2. `POST /api/refunds/create` with a valid-looking `paymentId` (e.g. a real captured payment) so the request reaches `razorpayInstance.payments.refund(...)`.
3. Have Razorpay reject the refund (in our environment this happened for every refund attempt — see DEF-001 evidence and the account-level limitation noted below).

**Expected:** A sanitized 400/404 JSON error response; server keeps running.

**Actual:** The process crashes with an uncaught `TypeError: Cannot read properties of undefined (reading 'includes')` and the entire Node process exits. All in-flight requests fail and the app must be manually restarted.

**Root cause:** `razorpay` npm SDK v2.9.8 throws error objects shaped `{ statusCode, error: {...} }` with **no top-level `.message` property** (confirmed directly: `err.message === undefined` for every SDK error observed). `sanitizeRazorpayError()` defensively does `error.message || ''`, so it's safe. But immediately after, the route does:
```js
const statusCode = error.message.includes('payment not found') ? 404 : 400;
```
with no guard — `error.message` is `undefined`, so `.includes(...)` throws synchronously inside the `catch` block, which Express's error-handling middleware never sees (it's not inside an async rejection path Express can intercept), so it becomes an uncaught exception and kills the process.

**Evidence (real):**
- Live crash observed at 2026-09-14 ~08:03 local, triggered by a genuine `POST /api/refunds/create` against a real captured payment (`pay_TbqJMlA39g3qiF`).
- Confirmed via isolated diagnostic script calling `razorpayInstance.payments.refund()` directly: `ERROR keys: ['statusCode','error']`, `ERROR.message: undefined`.
- Server log: `TypeError: Cannot read properties of undefined (reading 'includes') at .../src/routes/refunds.js:116`.
- Persistence (SQLite) was verified intact after the crash + restart — no data was lost, but the request that triggered it received no response at all (connection reset).

**Impact:** Any refund attempt that Razorpay rejects (invalid payment ID, excessive amount, ineligible payment state, etc.) crashes the whole application, not just the one request — a denial-of-service style defect. This also blocked further live execution of Steps 10–12 (full/partial/invalid refund) against the running server within this session.

### Resolution (Phase 3.3.1)

**Root cause confirmed unchanged** from the analysis above. During remediation, the identical unguarded pattern was also found in `src/routes/payments.js` (`GET /api/payments/:paymentId`, same `error.message.includes('not found') ? 404 : 400` line) — not yet observed to crash in practice, but the same latent bug, fixed at the same time.

**Fix applied:**
- `src/routes/refunds.js` and `src/routes/payments.js`: the status-code check no longer touches `error.message` directly. It now uses `error.statusCode === 404 ? 404 : 400` (the SDK does reliably set `.statusCode`, just not `.message`).
- `sanitizeRazorpayError()` in both files now falls back to `error.error?.description` when `error.message` is absent, so the *safe* messages returned to clients are more accurate (e.g. an excessive-amount refund now correctly maps to "Invalid refund amount." instead of the generic fallback), and the server-side diagnostic log now prints the real Razorpay-reported description instead of `undefined`.
- No behavior changed for the success path; only the `catch` blocks were touched.

**Regression tests:** `tests/security/refund-error-handling.spec.js` — `REF-ERR-001` (a Razorpay-rejected refund returns a controlled 400/404, not a dropped connection) and `REF-ERR-002` (an unrelated `GET /health` immediately afterward still returns 200). Both pass.

**Manual verification:** re-sent the exact request that previously crashed the process (`POST /api/refunds/create` for the real captured payment `pay_TbqJMlA39g3qiF`) against the fixed code:
```
{"error":"Refund creation failed","message":"Operation failed. Please try again."}   HTTP 400
```
followed immediately by `GET /health` → `200 {"status":"ok",...}` and `GET /api/payments/config` → `200`. Server log now shows the real diagnostic instead of a stack trace: `[create-refund] Razorpay error: invalid request sent | statusCode: 400`. Also verified with an invalid payment ID (→ `404`) and an excessive amount (→ `400`, message `"Invalid refund amount."`) — no crash in any case, full Playwright suite (37/37) still green afterward, and the app survived a full clean restart.

**Result:** RESOLVED and regression-tested.

---

## DEF-002: Webhook signature validation can never succeed — global JSON body parser destroys the raw body before it reaches the webhook route

**Status: ✅ RESOLVED (Phase 3.3.1, 2026-09-14)** — see Resolution section below.

**Severity:** High (the entire webhook feature is non-functional for real traffic, though it fails closed/safe — no false-accepts, only permanent false-rejects)

**Component:** `src/app.js` (global middleware order) + `src/routes/webhooks.js`

**Preconditions:** Any request to `POST /api/webhooks/razorpay`, real or simulated, with a correctly computed signature.

**Steps to reproduce:**
1. Compute `hmac_sha256(rawBody, RAZORPAY_WEBHOOK_SECRET)` exactly as `validateWebhookSignature()` does.
2. Send that exact raw body + correct signature to `POST /api/webhooks/razorpay` (confirmed both via `fetch()` and via `curl --data-binary` with a byte-identical file, to rule out client-side body mangling).
3. Observe the response.

**Expected:** HTTP 200, `{ success: true, message: 'Webhook received and validated' }`.

**Actual:** HTTP 401 `Webhook signature validation failed` — **every time**, even with a provably correct signature over the provably correct bytes.

**Root cause:** `src/app.js:10` mounts `app.use(express.json())` globally, before any router is mounted (`src/app.js:14-16`). Express middleware runs in mount order for every matching request, including `/api/webhooks/razorpay`. By the time the request reaches the webhook router's own `express.raw({ type: 'application/json' })` middleware (`src/routes/webhooks.js`), the body stream has already been consumed and parsed into a plain JS object by the global `express.json()`. `express.raw()` then has nothing left to read, so `req.body` in the handler is the **already-parsed object**, not a `Buffer`. The handler calls `req.body.toString('utf-8')`, which — because `req.body` is a plain object, not a Buffer — ignores the `'utf-8'` argument and returns the string literal `"[object Object]"`. The HMAC is then computed over `"[object Object]"` instead of the real raw JSON, so it can never match a signature Razorpay (or anything else) computed over the real payload.

**Reproduction of the mechanism in isolation** (standalone Express app mirroring the exact middleware order, no app code touched):
```
typeof req.body: object (NOT a Buffer)
req.body value: {"event":"test"}
```
confirming `express.raw()` receives an already-parsed object when a global `express.json()` runs first.

**Evidence (real):**
- A correctly HMAC-signed `payment.captured` webhook, referencing the real order/payment from this session (`order_TbqFacJFNAGXm5` / `pay_TbqJMlA39g3qiF`), was rejected with 401 both via `fetch()` and via byte-exact `curl --data-binary`.
- The previous Phase 3.1/3.2 reconciliation attributed the equivalent failures (WEB-001, WEB-005, WEB-006, WEB-007 — all tests that depend on a webhook being *accepted*) to "test infrastructure / payload serialization issues." This investigation shows the true root cause is this application-level middleware ordering bug, not the test suite. The tests that only assert *rejection* (WEB-002/003/004/007, invalid/missing signature or tampered payload) still pass, because they were already expecting a 401 — they never actually exercised the accept path, so the defect went undetected.

**Impact:**
- No real Razorpay webhook (or any correctly-signed webhook) can ever be accepted by this application as currently deployed.
- Webhook-driven state transitions (Step 17 of this phase) and idempotency-on-duplicate-acceptance (Step 16) cannot be exercised end-to-end over HTTP; they were verified instead at the unit/store level (`src/orderStore.js`) directly, bypassing the broken HTTP path — see the Phase 3.3 test report.
- Fails safe, not open: because the computed signature is always wrong, no forged webhook can be accepted either. This is a functional defect, not a security hole.

### Resolution (Phase 3.3.1)

**Fix applied:** In `src/app.js`, `app.use('/api/webhooks', webhooksRouter)` was moved **before** `app.use(express.json())`. Express runs middleware/routers in mount order, so a request to `/api/webhooks/razorpay` now reaches the webhook router's own `express.raw({ type: 'application/json' })` middleware first, while the request body is still an untouched stream — `req.body` inside the handler is now a real `Buffer` of the exact bytes Razorpay (or any caller) sent. Every other path (`/api/payments/*`, `/api/refunds/*`, static files) still falls through to the global `express.json()` mounted immediately after, so normal JSON parsing is completely unaffected elsewhere. No middleware was duplicated or removed — this is purely a reordering of two existing `app.use()` calls.

**Deterministic local verification (before touching Razorpay/zrok at all):**
1. Computed `hmac_sha256(rawBody, RAZORPAY_WEBHOOK_SECRET)` over a real JSON payload referencing the real captured payment/order from Phase 3.3.
2. `POST /api/webhooks/razorpay` with that exact body + signature → **`200 { success: true, message: "Webhook received and validated" }`** — this is the same request that returned 401 before the fix, with byte-identical payload and signature computation.
3. Invalid signature over the same body → `401` (unchanged, correctly still rejected).
4. Body modified after signing (amount changed) but original signature kept → `401` (tamper detection works).
5. Same event ID sent twice → first `200 "Webhook received and validated"`, second `200 "Webhook already processed"` (idempotency intact).
6. A different event ID with the same payload → processed independently, `200`.
7. Confirmed the previously-`paid` real order (`order_TbqFacJFNAGXm5`) stayed `paid` after re-receiving its own `payment.captured` event — the state-machine's same-state no-op, not a corruption.

**Regression tests:** `tests/security/webhook-validation.spec.js` — the pre-existing `WEB-001`, `WEB-005`, `WEB-006`, `WEB-007` (previously failing, see the old evidence below) now pass unmodified (their assertions were never changed, only a stale explanatory comment was removed, and `WEB-001`'s hardcoded event ID was made unique — see note below). Four new tests named for this remediation, `WEB-FIX-001`..`WEB-FIX-004`, were also added using a correctly-Razorpay-shaped payload against the real order/payment, so they additionally confirm the webhook-driven state transition (not just the HTTP status code). All pass.

**Side effect discovered and fixed in the same pass:** `WEB-001` used a hardcoded, non-unique `X-Razorpay-Event-Id` (`evt_valid_001`). This was harmless under the old in-memory idempotency store (reset on every restart) but became a **test-isolation bug** once Phase 3.3 made idempotency durable (SQLite) — the second time the suite ever ran against a persistent database, the hardcoded ID was already marked processed from the first run, so the test's "received and validated" assertion failed against a correctly-behaving server. Fixed by timestamping the event ID, consistent with the pattern `WEB-005`/`WEB-006` already used.

**Result:** RESOLVED and regression-tested at the deterministic/local level. Real Razorpay-originated delivery over the zrok tunnel remains **BLOCKED** — see the Phase 3.3.1 remediation report, Section "Webhook" — because no Dashboard webhook is confirmed configured against the current tunnel URL, which is outside this session's access (unrelated to this code defect).

---

## Non-defect environment limitation: Razorpay Test Mode account rejects all refund requests

Not logged as a numbered defect because it was confirmed to originate outside
the application (identical rejection from a raw HTTPS call to Razorpay's API
with no SDK or app code involved), but recorded here because it blocked
Steps 10/11 (full/partial refund) execution:

- `POST https://api.razorpay.com/v1/payments/{id}/refund` and `POST /v1/refunds` both return `400 BAD_REQUEST_ERROR "invalid request sent"` for a real captured payment (`pay_TbqJMlA39g3qiF`), with and without an explicit `amount`.
- This points to a Test Mode account/feature restriction (refunds not enabled, or another account-level gate) rather than a code defect, since the identical request via raw `curl`/`https` (bypassing the `razorpay` SDK and this app entirely) fails the same way.
- **Status:** BLOCKED — needs investigation in the Razorpay Dashboard (Settings, or contacting Razorpay support about the test account's refund capability) before Steps 10/11 can be genuinely executed.
