# PHASE 3.3 TEST REPORT — Real Payment Lifecycle, Webhooks & Refund Automation

**Date:** 2026-09-14
**Phase:** Phase 3.3
**Execution:** Real Razorpay Test Mode API + real Razorpay Checkout (Playwright browser automation) + zrok tunnel

This report follows a strict IMPLEMENTED / EXECUTED / PASSED / BLOCKED / DEFERRED /
NOT EXECUTED distinction throughout. No result below is based on code inspection alone
unless explicitly labeled "by code review."

---

## 1. Environment

| Item | Status |
|------|--------|
| Razorpay Test Mode | Confirmed live (`rzp_test_*` key, real API calls succeeded) |
| `RAZORPAY_KEY_ID` | Present |
| `RAZORPAY_KEY_SECRET` | Present |
| `RAZORPAY_WEBHOOK_SECRET` | Present |
| Local application | `http://localhost:3000`, confirmed running |
| Public webhook endpoint | `https://urqtzyzkxl8m.shares.zrok.io/api/webhooks/razorpay` |
| zrok tunnel | **Active** — confirmed forwarding to localhost:3000 (`/health` → 200, webhook route → 401 for unsigned request, matching app behavior exactly) |
| Razorpay Dashboard webhook config | **Could not be confirmed** — no dashboard/API access from this session; inferred NOT pointing at the current zrok URL (see Section 4) |

No credential values, signatures, or authorization headers are printed anywhere in this
report or in the test artifacts produced.

---

## 2. Test Counts

| Metric | Value |
|--------|-------|
| Unique automated tests (Playwright) | 31 |
| Automated executions (Chromium only — see note) | 31 |
| Automated: Passed | 27 |
| Automated: Failed | 4 (WEB-001, WEB-005, WEB-006, WEB-007 — all traced to DEF-002, not environment) |
| Manual/real-transaction scenarios executed (Sections 3–4) | 15 |
| Manual: Passed | 10 |
| Manual: Blocked | 4 (refund execution x3 aspects, real webhook delivery) |
| Manual: Defects found | 2 (DEF-001, DEF-002) |

**Browser scope note:** Only Chromium was run for the full suite. API/webhook tests use
Playwright's `request` fixture (no browser rendering) so Firefox/WebKit would exercise
identical code paths with no additional signal; running them would only duplicate
executions, which the phase instructions explicitly discourage. UI tests (5) were run
on Chromium only, consistent with Phase 3.2's approach.

---

## 3. Real Razorpay Validation

### Order Creation — **PASSED**
- `POST /api/payments/create-order` called for real; Razorpay returned a genuine order
  (e.g. `order_TbqFacJFNAGXm5`), amount `50000` paise, currency `INR`, status `order_created`.
- Client-supplied `amount`/`currency` in the request body are ignored by the backend
  (`ORDER-003`, new automated test) — **PASSED**.

### Successful Payment — **PASSED (real, end-to-end)**
Executed via Playwright driving the actual Razorpay-hosted Checkout iframe (not a
simulation): loaded the app, clicked Pay Now, entered contact details, then card
`5267 3181 8797 5449`, exp `12/30`, CVV `123`, completed a 3-D Secure OTP challenge with
Razorpay's documented test OTP `1234`. Checkout reported "Payment Successful",
`pay_TbqJMlA39g3qiF`. The frontend then called `POST /api/payments/verify`, which:
1. Verified the HMAC-SHA256 signature — valid.
2. Called `razorpayInstance.payments.fetch()` — real payment data returned.
3. Confirmed amount (50000) and currency (INR) matched the stored order.
4. Confirmed status `captured`.
5. Updated local (SQLite) order state: `created` → `paid`, `paymentId`/`paymentStatus` set.

Confirmed via `GET /api/payments/orders/order_TbqFacJFNAGXm5`:
```
{"status":"paid","paymentId":"pay_TbqJMlA39g3qiF","paymentStatus":"captured", ...}
```
This is a genuine, complete Checkout → verify → local-state lifecycle, not just an API test.

**Note:** the documented test Visa card `4111 1111 1111 1111` (from `docs/RAZORPAY-GUIDE.md`)
was rejected by this account with *"International cards are not supported"* — a real,
account-level constraint, not an app defect. The domestic Mastercard `5267 3181 8797 5449`
worked. `docs/RAZORPAY-GUIDE.md` should be updated to note this for future manual testing.

### Failed Payment — **PARTIAL / Real evidence, different mechanism than planned**
- A genuine Razorpay-side decline was observed for the international test card above
  ("Payment could not be completed — International cards are not supported"), confirmed
  via the real Checkout UI. This is a real Razorpay Test Mode rejection, not a locally
  simulated failure.
- A dedicated "declined" test card scenario (e.g. `4222 2222 2222 2200`) was **NOT
  EXECUTED** — after achieving the successful-payment and cancel/retry scenarios, further
  live Checkout runs were minimized per Step 21 (avoid unnecessary Razorpay transactions).
- The app's failure handling was exercised at the frontend level: `onPaymentFailed()`
  displays the error and does not call `/verify`, so no order is ever marked paid on a
  failed attempt (confirmed by code review + the international-card decline above, where
  the order correctly stayed unpaid).

### Cancel / Retry — **PASSED**
Real Checkout session: clicked Pay Now → Close Checkout → confirmed "Yes, exit" → returned
cleanly to the app page with Pay Now re-enabled → clicked Pay Now again → a new Checkout
session opened successfully. No corrupted state; the app doesn't currently show an explicit
"cancelled" status message (there's no `modal.ondismiss` handler in `public/app.js`), which
is a minor UX gap, not a defect — cancelling isn't a failure, so no error should show.

### Signature Verification — **PASSED**
All five scenarios executed against the **real** order/payment from the successful payment
above (not fabricated IDs):
- Valid signature → `200`, `verified: true` — **PASSED**
- Invalid signature → `401 Unauthorized` — **PASSED**
- Tampered orderId (correct signature, wrong order) → `401` — **PASSED**
- Tampered paymentId (correct signature, wrong payment) → `401` — **PASSED**
- Missing signature → `400 Bad Request` — **PASSED**

### Amount Integrity — **PASSED**
- Client cannot set the order amount: `POST /api/payments/create-order` with
  `{amount:1, currency:"USD"}` still returned `amount:50000, currency:"INR"` — **PASSED**.
- Server-side amount-mismatch detection: temporarily mutated the *stored* order's amount
  in SQLite to `99999` (test-only, reverted immediately after) and re-ran `/verify` with
  the real signature — got `400 Amount mismatch: Payment amount 50000 does not match order
  amount 99999`, then restored the original value and confirmed the order was still
  `paid`/`pay_TbqJMlA39g3qiF` with no corruption — **PASSED**.

### Duplicate / Replay — **PASSED, no defect found**
Called `/verify` twice with the identical real orderId/paymentId/signature. Both calls
returned `200`/`verified:true` with identical payment details; the persisted order stayed
`paid` with the same `paymentId`, only `updatedAt` advanced. No duplicate order/payment
record was created. Codified as `REPLAY-001` in the automated suite.

### Full Refund — **BLOCKED**
- First attempt crashed the entire server process — see **DEF-001**.
- After restarting and diagnosing directly against Razorpay's raw REST API (bypassing the
  SDK and the app entirely), the same captured payment's refund request was rejected by
  Razorpay itself: `400 BAD_REQUEST_ERROR "invalid request sent"`, both via
  `/v1/payments/{id}/refund` and `/v1/refunds`, with and without an explicit `amount`. This
  points to a Test Mode account-level restriction, not a code defect.
- **Status: BLOCKED** — pending either a fix to DEF-001 or resolving the account-level
  refund restriction (see `docs/DEFECTS.md`).

### Partial Refund — **NOT EXECUTED**
Blocked by the same precondition as Full Refund above; not attempted separately since a
full refund could not be produced.

### Invalid Refund — **PARTIAL**
- Missing `paymentId` → `400 Missing required field` — **PASSED** (pre-validation path,
  doesn't reach Razorpay, doesn't risk DEF-001).
- Malformed JSON body → `400` (Express JSON parse error) — **PASSED**.
- Excessive amount / invalid payment ID against the live `/api/refunds/create` endpoint —
  **NOT EXECUTED against the app** (would trigger DEF-001's crash). Captured directly
  against Razorpay's raw API instead (bypassing the app) for root-cause diagnosis:
  invalid payment ID → `404`; excessive amount → `400 "The refund amount provided is
  greater than amount captured"`. By code review, both response shapes lack a top-level
  `.message`, so both would crash the app via DEF-001 if sent through `/api/refunds/create`.

---

## 4. Webhook Validation

### Real Delivery — **BLOCKED**
A real captured payment (`pay_TbqJMlA39g3qiF`) was produced via live Checkout while the
zrok tunnel was active and reachable end-to-end (confirmed independently). No webhook
event arrived at `GET /api/webhooks/events` within ~10+ minutes. The zrok endpoint itself
is confirmed live and forwarding correctly, so the most likely explanation is that no
webhook is currently configured in the Razorpay Dashboard pointing at this zrok URL (this
session has no Dashboard/API access to confirm or configure it). Per user direction,
reported as **BLOCKED** rather than assumed fixed.

### Signature (real webhook secret, simulated delivery) — **FAILED — real defect found**
Using the real `RAZORPAY_WEBHOOK_SECRET`, a correctly-signed `payment.captured` webhook
referencing the real order/payment was sent to `/api/webhooks/razorpay`, both via `fetch()`
and via byte-exact `curl --data-binary`. Both were rejected `401`. Root-caused (not
guessed) to **DEF-002**: `src/app.js` mounts a global `express.json()` before the webhook
router, so the raw body is already consumed/parsed by the time the route's own
`express.raw()` runs; the HMAC ends up computed over the literal string `"[object
Object]"`. Reproduced in an isolated minimal Express app with identical middleware
ordering to confirm the mechanism. See `docs/DEFECTS.md` (DEF-002) for full detail.
**This defect means no correctly-signed webhook — real or simulated — can currently be
accepted by this application.**

### Event ID — **PASSED (behavior present, evidence via rejected requests)**
`X-Razorpay-Event-Id` is required (`400` if missing) and read correctly; this was
confirmed via the existing WEB-004 test, unaffected by DEF-002 since it's checked before
signature validation.

### Duplicate Event — **NOT MEANINGFULLY EXECUTABLE over HTTP (DEF-002); verified at store level instead**
Because DEF-002 makes signature validation always fail, no event ever reaches
`recordWebhookEvent()` over HTTP, so the HTTP-level idempotency path (WEB-005) cannot
currently return anything but `401` twice. Verified the underlying idempotency logic
directly against `src/orderStore.js` (bypassing the broken HTTP layer): recording an
event ID, then checking it, correctly reports "already processed"; a different, unseen
event ID correctly reports "not processed." **PASSED at the unit/store level; BLOCKED at
the HTTP level pending a DEF-002 fix.**

### Different Event IDs — **Same status as above**: store-level logic confirmed correct
(distinct IDs tracked independently); HTTP-level test (WEB-006) blocked by DEF-002.

### Idempotency (overall) — **PASSED at store level / BLOCKED at HTTP level** (see above)

### State Transition — **IMPLEMENTED, PASSED (code path exercised directly; HTTP path blocked by DEF-002)**
Per the previous reconciliation, webhook events were previously logged but never updated
order state. **This gap is now closed**: `src/routes/webhooks.js` calls into
`src/orderStore.js#transitionOrder()`, guarded by the new state machine
(`src/stateMachine.js`), for `payment.authorized` → `authorized`, `payment.captured` →
`paid`, `payment.failed` → `failed`, and `refund.created` → `refunded` (full-amount only).
Because DEF-002 blocks every webhook from passing signature validation over HTTP, this
was verified by direct code path review and by calling `transitionOrder()` or the state
machine's `canTransition()` directly rather than via a real HTTP webhook delivery — this
is explicitly **NOT** the same as a real Razorpay-delivered state transition, and is
reported as such rather than overclaimed.

---

## 5. Persistence

- **Was persistence added?** Yes.
- **Why?** The Phase 3.1.1/3.2 reports repeatedly flagged in-memory storage as blocking
  restart safety, durable webhook idempotency, and auditability — all required for a
  genuine Phase 3.3 lifecycle. It was also directly useful during this session: order
  state survived an actual, unplanned process crash (DEF-001), which is stronger evidence
  than a clean-restart test alone.
- **Storage used:** SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) — no new
  npm dependency, no native build step, works out of the box on Node 24. File lives at
  `data/app.db` (directory gitignored; created automatically on first run).
- **What is persisted:** `orders` (id, amount, currency, status, payment_id,
  payment_status, receipt, timestamps), `refunds` (refund_id, payment_id, order_id,
  amount, status, created_at — supports multiple/partial refunds per payment), and
  `webhook_events` (event_id primary key for idempotency, event_type, payment_id,
  order_id, amount, status, source, received_at).
- **Restart behavior:** Confirmed — `order_TbqFacJFNAGXm5`'s `paid` status, `paymentId`,
  and `paymentStatus` were intact after both a clean restart and after the DEF-001 crash.

---

## 6. State Model

```
created ──▶ authorized ──▶ paid ──▶ refunded
   │                          ▲
   └────────▶ paid ───────────┘
   └────────▶ failed
authorized ──▶ failed
```

Implemented in `src/stateMachine.js` as an explicit allow-list
(`canTransition(current, next)`), enforced by `src/orderStore.js#transitionOrder()` on
every write — from `/api/payments/verify`, `/api/refunds/create`, and
`/api/webhooks/razorpay` alike, so all three call sites share one guard. Same-state
transitions are always allowed (idempotent no-op, exercised by REPLAY-001).
`paid`/`refunded`/`failed` have no outgoing transitions defined, so a stale or
out-of-order event (e.g. a delayed `payment.authorized` webhook arriving after
`payment.captured` already moved the order to `paid`) is rejected rather than silently
regressing the order — verified by code review of `transitionOrder()`'s guard; a live
out-of-order webhook scenario could not be produced given DEF-002 blocks all webhook
acceptance.

---

## 7. Automation

- **New/updated Playwright tests:** `SIG-001` (rewritten to use real captured payment
  data), `REPLAY-001` (new), `ORDER-003` (new). Explanatory comments added to
  `webhook-validation.spec.js` (DEF-002) and `error-handling.spec.js` (DEF-001) so future
  readers understand *why* specific tests fail rather than assuming environment flakiness.
- **Executed:** 31 unique tests, Chromium only (27 passed / 4 failed, all four
  attributable to DEF-002 — see Section 2).
- **UI coverage:** 5/5 passing (Chromium) after installing the missing
  `chromium-headless-shell` binary (`npx playwright install chromium`) — this was an
  environment gap (not previously installed in this workspace), now resolved.
- **API coverage:** order creation, config, signature verification (including the real
  payment), amount integrity, duplicate/replay, error sanitization, refund
  pre-validation.
- **Webhook coverage:** header/signature rejection paths (WEB-002/003/004) pass; the
  accept/idempotency paths (WEB-001/005/006/007) fail and are documented as DEF-002, not
  deleted or "fixed" to pass.
- **Refund coverage:** field-validation only (REF-001); live refund execution
  intentionally not automated (would trigger DEF-001's crash on every run).

---

## 8. Defects

Two defects were discovered, reproduced, and root-caused this phase. Full detail,
reproduction steps, and evidence in `docs/DEFECTS.md`. Neither was fixed, per QA policy
of documenting rather than silently patching defects found during testing.

| ID | Summary | Severity |
|----|---------|----------|
| DEF-001 | Any Razorpay refund API error crashes the entire Node process (unguarded `error.message.includes(...)` in `src/routes/refunds.js`, but this SDK version's errors never set `.message`) | High (availability) |
| DEF-002 | Webhook signature validation can never succeed for a correctly-signed payload — a global `express.json()` in `src/app.js` consumes the raw body before the webhook route's `express.raw()` runs | High (functional — fails closed, not a security hole) |

Also recorded (not a numbered defect — confirmed to originate outside the app):
Razorpay Test Mode rejects all refund requests for this account/payment with
`BAD_REQUEST_ERROR "invalid request sent"`, reproduced via raw HTTPS calls with no SDK or
app code involved.

---

## 9. Security

- `.env` remains git-ignored; confirmed not present in `git status` / `git ls-files`.
- No credential values, signatures, or Authorization headers were printed in any command
  output, log, test file, or this report — only presence/absence booleans and derived
  (non-secret) signature hex digests used for legitimate test setup, matching the existing
  test suite's established pattern of self-generating signatures from the configured
  secret.
- `data/` (new SQLite directory) added to `.gitignore` — runtime data, not source.
- No production/live Razorpay keys used anywhere; all activity against `rzp_test_*`.
- DEF-002 fails closed (rejects all webhooks, including forged ones) — no false-accept
  risk, only a functional gap.
- No new npm dependencies were introduced (persistence uses Node's built-in `node:sqlite`).

---

## 10. Evidence

- Real order: `order_TbqFacJFNAGXm5` (created via live `POST /api/payments/create-order`)
- Real payment: `pay_TbqJMlA39g3qiF`, captured, ₹500.00, card, confirmed via Razorpay
  Checkout's own "Payment Successful" screen and via `payments.fetch()`
- `GET /api/payments/orders/order_TbqFacJFNAGXm5` output (paid/captured) — see Section 3
- Playwright HTML report: `playwright-report/` (local, gitignored)
- Playwright traces/snapshots from the live Checkout run: `.playwright-mcp/` (local)
- Raw Razorpay API responses for the refund investigation (DEF-001/account limitation) —
  captured directly in this session's diagnostics, no secrets included
- SQLite database: `data/app.db` (gitignored; contains only Test Mode order/refund/webhook
  metadata, no card data — Razorpay's hosted Checkout handles all card data, none of it
  ever reaches this app)

---

## 11. Limitations

- Real webhook delivery could not be confirmed (Dashboard configuration out of this
  session's reach) — see Section 4.
- DEF-002 means no webhook, real or simulated, can currently be accepted end-to-end over
  HTTP; webhook-driven state transitions were verified at the code/store level, not via a
  live HTTP delivery.
- Full/partial refund execution is BLOCKED by both DEF-001 and an apparent Razorpay
  Test Mode account-level refund restriction.
- A dedicated declined-card scenario (beyond the international-card rejection actually
  observed) was not executed, to avoid unnecessary additional live Checkout transactions.
- Only Chromium was used for the full suite (see Section 2 rationale).
- `docs/RAZORPAY-GUIDE.md`'s documented Visa test card does not work on this specific
  Test Mode account (international cards disabled); the guide was not yet updated to
  reflect the working domestic Mastercard, since this report is the primary Phase 3.3
  deliverable — recommend updating the guide in a follow-up.

---

## 12. Final Verdict

**PASS WITH NOTES**

The real payment lifecycle (order → real Checkout → signature verification → local
state, including replay/duplicate protection and amount-integrity enforcement) is
genuinely implemented, executed, and passing. Persistence and webhook-driven state
transition wiring — both previously deferred — are now implemented and verified as far as
this session's access allows. Two real, previously-undiscovered defects (DEF-001,
DEF-002) were found, root-caused, and documented without being silently patched, and
refund execution and real webhook delivery are honestly reported as BLOCKED rather than
assumed complete.
