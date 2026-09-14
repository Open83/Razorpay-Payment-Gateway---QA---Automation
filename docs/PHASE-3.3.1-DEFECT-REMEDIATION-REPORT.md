# PHASE 3.3.1 — DEFECT REMEDIATION & PAYMENT LIFECYCLE COMPLETION

**Date:** 2026-09-14
**Scope:** Fix DEF-001 and DEF-002 only, regression-test them, and complete the previously
blocked lifecycle scenarios where genuinely possible. No redesign, no new features, no
scope increase.

---

## DEF-001 — Refund API server crash

- **Root cause:** `src/routes/refunds.js` computed the HTTP status code with
  `error.message.includes('payment not found') ? 404 : 400` inside the `catch` block,
  with no guard. The `razorpay` npm SDK (v2.9.8) throws errors shaped
  `{ statusCode, error: { description, code, ... } }` and **never sets a top-level
  `.message`**, so `.includes(...)` threw a `TypeError` on `undefined` — synchronously,
  inside the `catch` block itself, which Express cannot intercept — crashing the entire
  Node process on every Razorpay-rejected refund.
- **Additional finding during inspection:** the identical pattern existed in
  `src/routes/payments.js` (`GET /api/payments/:paymentId`), not yet observed to crash but
  the same latent bug. Fixed at the same time, in scope of the same root cause.
- **Fix:** In both files, the status code is now derived from `error.statusCode` (which
  the SDK does reliably set) instead of parsing `.message`. `sanitizeRazorpayError()` in
  both files now also falls back to `error.error?.description` when `.message` is absent,
  so the safe client-facing messages are more accurate and the server-side diagnostic log
  shows the real Razorpay-reported description instead of `undefined`. No change to the
  success path.
- **Regression test:** `tests/security/refund-error-handling.spec.js`
  - `REF-ERR-001` — a Razorpay-rejected refund (unknown paymentId) returns a controlled
    `400`/`404` JSON error, sanitized (no raw SDK internals in the response). **PASSED**.
  - `REF-ERR-002` — `GET /health` and `GET /api/payments/config` both succeed immediately
    after the refund error above. **PASSED**.
- **Manual verification:** re-sent the exact request that previously crashed the live
  server (`POST /api/refunds/create` for the real captured payment
  `pay_TbqJMlA39g3qiF`) — now returns a controlled `400` and the server stayed up,
  confirmed by an immediate `GET /health` (`200`) and `GET /api/payments/config` (`200`).
  Also tried an invalid payment ID (`404`) and an excessive amount (`400`,
  `"Invalid refund amount."`) — no crash in either case. Full Playwright suite (37/37)
  passed afterward, and the app was confirmed to survive a full clean restart.
- **Result: RESOLVED.**

---

## DEF-002 — Webhook raw body / signature validation

- **Root cause:** `src/app.js` mounted the global `express.json()` body parser before any
  router, including the webhook router. Express runs middleware in mount order, so by the
  time a request to `/api/webhooks/razorpay` reached the route's own
  `express.raw({ type: 'application/json' })` middleware, the body had already been
  consumed and parsed into a plain object by `express.json()`. `req.body.toString('utf-8')`
  on a plain object (not a `Buffer`) returns the literal string `"[object Object]"`, so the
  HMAC was always computed over that fixed string instead of the real payload — no
  correctly-signed webhook could ever be accepted.
- **Fix:** Moved `app.use('/api/webhooks', webhooksRouter)` to **before**
  `app.use(express.json())` in `src/app.js`. This is a pure reordering of two existing
  `app.use()` calls — nothing was duplicated, removed, or globally disabled. Every other
  route (`/api/payments/*`, `/api/refunds/*`, static files) still gets normal JSON parsing
  from the global middleware mounted immediately after the webhook router. Webhook
  signature validation logic itself (`validateWebhookSignature()`) was **not modified** —
  it still requires a valid HMAC-SHA256 over the untouched raw body; no bypass, no
  weakening, no hardcoded signature, no dev-mode shortcut.
- **Deterministic local webhook test (before touching Razorpay/zrok):**
  1. Valid signature over the real raw body → **`200`, accepted** (previously `401`).
  2. Invalid signature → **`401`, rejected** (unchanged).
  3. Payload modified after signing, original signature kept → **`401`, rejected**
     (tamper detection intact).
  4. Same event ID sent twice → first **`200` "received and validated"**, second
     **`200` "already processed"** (idempotency intact).
  5. A different event ID with the same payload → processed independently.
  6. The real order (`order_TbqFacJFNAGXm5`, already `paid` from Phase 3.3) correctly
     stayed `paid` after re-receiving its own `payment.captured` webhook — a same-state
     no-op via the state machine, not a duplicate or a regression.
  - All of the above were executed twice: once with an ad-hoc script (deleted afterward)
    and once as the permanent Playwright regression tests below, with identical results.
- **Real Razorpay webhook test:** **BLOCKED, unchanged from Phase 3.3.** The zrok tunnel
  (`https://urqtzyzkxl8m.shares.zrok.io`) is confirmed active and reachable end-to-end
  (`/health` returns `200` through it). No webhook event from Razorpay's own servers has
  been observed at `GET /api/webhooks/events` from any transaction in this project.
  Per the user's direction in Phase 3.3, this remains reported as **BLOCKED** (most likely
  no Dashboard webhook is configured against the current tunnel URL) rather than assumed
  resolved — fixing DEF-002 makes real delivery *possible to accept correctly* if and when
  it arrives, but does not by itself cause Razorpay to send anything.
- **Regression tests:** `tests/security/webhook-validation.spec.js`
  - Pre-existing `WEB-001`, `WEB-005`, `WEB-006`, `WEB-007` (all previously failing due to
    DEF-002, all left with their original assertions unchanged) now **PASS**.
  - New `WEB-FIX-001`..`WEB-FIX-004`, using a correctly Razorpay-shaped payload against the
    real order/payment, additionally confirm the webhook-driven state transition survives
    the fix (not just the HTTP status code). **PASSED**.
  - Side-effect fix: `WEB-001`'s event ID was hardcoded (`evt_valid_001`), which was
    harmless against the old in-memory idempotency store but became a test-isolation bug
    once idempotency became durable (SQLite) — the second time the suite ever ran, the ID
    was already "processed" from the first run. Fixed by timestamping the ID.
- **Result: RESOLVED at the deterministic/local level.** Real Razorpay-originated
  delivery remains BLOCKED for reasons outside this codebase (Dashboard configuration,
  not accessible from this session).

---

## Payment Lifecycle

| Stage | Status | Notes |
|-------|--------|-------|
| Order | ✅ PASSED (Phase 3.3, unaffected by this phase) | Real Razorpay order, unchanged |
| Payment (Checkout) | ✅ PASSED (Phase 3.3, unaffected by this phase) | Real captured payment, unchanged |
| Verification | ✅ PASSED (Phase 3.3, re-confirmed this phase) | Signature, amount, replay all still pass |
| Failure | PARTIAL (Phase 3.3, unaffected) | See Phase 3.3 report — international-card decline observed, dedicated decline-card scenario not re-attempted this phase |
| Cancel/Retry | ✅ PASSED (Phase 3.3, unaffected) | Not re-executed this phase — no code path touched |
| State transitions | ✅ PASSED (verified via deterministic webhook + real order this phase) | `created→paid→refunded`/`failed` guards confirmed intact; a duplicate/out-of-order event on an already-`paid` order correctly no-ops rather than regressing it |
| Webhook (deterministic, local) | ✅ PASSED (this phase, post-fix) | See DEF-002 above |
| Webhook (real, Razorpay-delivered) | **BLOCKED** (unchanged from Phase 3.3) | Dashboard configuration outside session access |
| Refund | **BLOCKED — Razorpay environment/account limitation** (unchanged from Phase 3.3, re-confirmed post-fix) | See below |

### Refund — real attempt, post-fix

With DEF-001 fixed, the full refund was attempted again against the real captured payment
(`pay_TbqJMlA39g3qiF`). Razorpay rejected it identically to Phase 3.3:
`400 BAD_REQUEST_ERROR "invalid request sent"`, now surfaced safely as
`{"error":"Refund creation failed","message":"Operation failed. Please try again."}`
instead of crashing the server. This was already confirmed in Phase 3.3 (via raw HTTPS
calls bypassing the SDK and app entirely) to originate from Razorpay's side, not the
application — an account/Test-Mode-level restriction on this specific test account, not
a code defect. **No refund was fabricated or claimed successful.** Partial refund was not
attempted separately since a full refund cannot be produced under this restriction.
Invalid-refund scenarios (unknown payment ID → `404`, excessive amount → `400`
`"Invalid refund amount."`) were both re-verified live, safely, with no crash.

---

## Test Execution

- **Unique automated tests:** 37 (31 from Phase 3.3 + `REF-ERR-001`, `REF-ERR-002`,
  `WEB-FIX-001..004`)
- **Executions (Chromium):** 37
- **Passed:** 37
- **Failed:** 0
- **Blocked:** 0 automated (the account-level refund restriction and the real-webhook-
  delivery gap are exercised manually, outside the automated suite, and reported as
  BLOCKED above/in Section "Payment Lifecycle")
- **Deferred:** 0

Full suite was run three times during this phase (post-fix, after adding the new
regression tests, and after a full clean server restart) — 37/37 every time. Only
Chromium was used, consistent with Phase 3.3's rationale (API/webhook tests are
browser-agnostic; UI tests were already covered).

---

## Persistence

Re-verified post-fix: the real order (`order_TbqFacJFNAGXm5`) stayed `paid` with the
correct `paymentId`/`paymentStatus`, and the webhook event log retained all prior entries,
across a full clean server restart performed during this phase. No persistence code was
changed. Webhook idempotency (event IDs) is durable in SQLite, as established in Phase
3.3 — this phase confirmed it in practice by hitting a test-isolation issue caused by that
durability (see DEF-002 side-effect note above), which is itself evidence the durability
is real and working as intended.

---

## Security

- `.env` remains git-ignored; not present in `git status`/`git ls-files`.
- No credential values, signatures, or Authorization headers were printed in any command
  output, log, test file, or this report.
- No production/live Razorpay keys used; all activity against `rzp_test_*`.
- The DEF-002 fix does not weaken signature validation in any way: no bypass, no
  parsed-body fallback, no unsigned-webhook acceptance, no development shortcut, no
  hardcoded signature. `validateWebhookSignature()` is byte-for-byte the same function as
  before; only the middleware order changed so it receives what it always should have.
- No new npm dependencies introduced.

---

## Defects

Both defects opened in Phase 3.3 are now closed:

| ID | Status |
|----|--------|
| DEF-001 | ✅ RESOLVED — fixed, regression-tested, verified live |
| DEF-002 | ✅ RESOLVED (local/deterministic) — fixed, regression-tested, verified live; real Razorpay-originated delivery remains BLOCKED for an unrelated, out-of-session reason (Dashboard config) |

Full detail in `docs/DEFECTS.md` (neither entry was deleted — both are kept as a record of
what was found and how it was fixed).

---

## Documentation

- `docs/DEFECTS.md` — both defects marked RESOLVED with root cause, fix, and verification.
- `docs/TEST-CASES.md` — updated to reflect WEB-001/005/006/007 now passing, and the new
  REF-ERR-*/WEB-FIX-* regression tests.
- `docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md` — this document.

---

## Limitations

- Real Razorpay-originated webhook delivery still cannot be confirmed — this is a
  Dashboard/account configuration question outside this session's access, not something
  the DEF-002 code fix could address on its own.
- The Razorpay Test Mode account-level refund restriction is still in place; full/partial
  refund cannot be genuinely completed until that's resolved on Razorpay's side (or via
  their support).
- Cancel/retry and the international-card decline scenario were not re-executed this
  phase (no code path relevant to either defect was touched, and Step 21 discourages
  unnecessary additional live Checkout transactions).

---

## Final Verdict

**PASS WITH NOTES**

Both High-severity defects (DEF-001, DEF-002) are fixed, regression-tested, and verified
live without weakening any security control — webhook signature validation is, if
anything, now doing its actual job for the first time. The payment lifecycle through
verification, state transitions, and deterministic webhook acceptance is fully
demonstrated. The two remaining BLOCKED items (real Razorpay webhook delivery, refund
execution) are both confirmed to originate outside this application's code, not from any
defect, and are reported honestly as such rather than claimed complete.
