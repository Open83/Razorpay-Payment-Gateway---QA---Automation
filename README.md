# Razorpay Payment Gateway — QA & Automation

A QA engineering portfolio project: a minimal Razorpay-integrated payment demo, built
specifically to be tested — with real Razorpay Test Mode transactions, Playwright
automation, security testing, and a CI/CD pipeline, applied the way a QA engineer would
apply them to a real payment integration.

**This is not a production payment platform.** It exists to demonstrate QA methodology
against a genuine (if small) payment gateway integration.

---

## Project Overview

The application is a single-product checkout demo: create a Razorpay order, pay for it
through Razorpay's real hosted Checkout (Test Mode), verify the payment server-side, and
track its state through to refund. The QA problem it demonstrates is the one every real
payment integration has to get right: *can you prove — with evidence, not assumptions —
that signatures are verified, amounts can't be tampered with, webhooks can't be forged,
duplicate events can't cause duplicate side effects, and none of that breaks under
adversarial or unexpected input?*

Across this project's phases, that testing effort also found and fixed two genuine
High-severity defects in the application itself (see [Defects Found & Fixed](#defects-found--fixed)) —
that's the other half of what a QA engineer is for.

---

## QA Scope

- **Functional & API testing** — order creation, payment verification, refund endpoints, health/config endpoints
- **UI testing** — Playwright browser automation against the real frontend and, for one flow, the real Razorpay Checkout iframe
- **Payment lifecycle testing** — order → real Checkout payment → server-side verification → local state transition to `paid`
- **Security testing**:
  - Payment signature verification (HMAC-SHA256), including tampered order/payment IDs and missing signatures
  - Amount integrity — the backend controls the amount; client-supplied values are ignored, and a mismatch between a stored order and the real payment amount is rejected
  - Replay protection — repeating a verification call against the same real payment doesn't create duplicate state
  - Webhook HMAC validation over the *raw* request body
  - Webhook idempotency — durable, SQLite-backed, duplicate event IDs are recognized and not reprocessed
  - Refund request validation and error sanitization (no raw SDK errors leaked to clients)
- **Persistence & state management** — SQLite-backed orders/refunds/webhook events, with an explicit state machine guarding every transition
- **Regression testing** — both defects below have dedicated, automated regression tests that run on every CI build

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (`>=22.5.0`) |
| Language | JavaScript (ESM) |
| Web framework | Express |
| Payment gateway | Razorpay Test Mode (`razorpay` npm SDK) |
| Persistence | SQLite via Node's built-in `node:sqlite` |
| Test automation | Playwright Test (API + UI) |
| CI/CD | GitHub Actions |

No other runtime dependencies are used (`dotenv` for environment loading is the only other production dependency).

---

## Test Summary

**37 total automated tests**, all written with Playwright Test:

| Category | Count | Runs in CI? |
|---|---|---|
| CI-safe | **34** | ✅ Automatically, on every push/PR |
| Razorpay-live (`SIG-001`, `REPLAY-001`, `UI-002`) | **3** | ❌ Manual only |

The 3 Razorpay-live tests are **intentionally excluded** from GitHub Actions:
- `SIG-001` and `REPLAY-001` verify against one *specific* real, already-captured Razorpay
  Test Mode payment from this project's own account — not something a generic CI runner
  (or another developer's fork) can reproduce.
- `UI-002` needs the app's own order-creation call to succeed against genuinely valid
  Razorpay credentials, which CI intentionally does not provide (see [CI/CD](#cicd) below).

**GitHub Actions runs the 34 CI-safe tests, not all 37.** The 3 Razorpay-live tests are run
locally and manually, on demand, against real credentials:
```bash
npm run test:ci        # the 34 CI-safe tests — what GitHub Actions runs
npm run test:razorpay  # the 3 Razorpay-live tests — manual, real credentials required
```

---

## Real Payment Evidence

A genuine Razorpay Test Mode Checkout payment was completed end-to-end: an order was
created through the real Razorpay Orders API, paid through Razorpay's actual hosted
Checkout UI (a real test card + OTP challenge, not a simulated response), verified
server-side (HMAC signature check, then a live `payments.fetch()` call against Razorpay),
and the local order was transitioned to `paid` with the returned payment ID recorded.

No credential values or full payment identifiers are published here; the detailed,
evidenced walkthrough is in
[`docs/PHASE-3.3-TEST-REPORT.md`](docs/PHASE-3.3-TEST-REPORT.md).

---

## Defects Found & Fixed

Two genuine High-severity defects were discovered during testing, root-caused, fixed, and
given dedicated regression tests. Full detail in [`docs/DEFECTS.md`](docs/DEFECTS.md).

### DEF-001 — Refund error handling crashed the server
Any Razorpay-rejected refund request crashed the entire Node process (an unguarded
`error.message.includes(...)` call on an SDK error object that doesn't set `.message`).
**Fixed** by deriving the status code from `error.statusCode` instead. **Regression
tests:** `REF-ERR-001`, `REF-ERR-002` — the server is confirmed to stay up and keep
serving other requests immediately after a Razorpay-rejected refund.

### DEF-002 — Webhook raw-body signature validation was broken
A global `express.json()` body parser was consuming the request body before the webhook
route's own raw-body handler could see it, so the HMAC signature was computed over the
wrong bytes — **no correctly-signed webhook could ever be accepted.** **Fixed** by
mounting the webhook route before the global JSON parser (no other route's parsing
changed). **Regression tests:** `WEB-001/005/006/007` and `WEB-FIX-001..004` — signature
acceptance, tamper rejection, and idempotency are all now exercised deterministically.

Both remain documented as **RESOLVED** with reproduction steps, root cause, and
regression evidence.

---

## Webhook Limitation

**Real Razorpay-originated webhook delivery was not demonstrated.** A public tunnel was
confirmed reachable, but no webhook event from Razorpay's own servers was ever observed
arriving at the application — most likely a Dashboard webhook configuration gap outside
this project's control, not a code defect.

What **was** genuinely implemented and deterministically tested, using the real webhook
secret and correctly-computed HMAC signatures: raw-body signature validation, event-ID
idempotency (including durable behavior across a server restart), duplicate-event
handling, and webhook-driven order state transitions. See
[`docs/DEFECTS.md`](docs/DEFECTS.md) (DEF-002) and
[`docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md`](docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md).

## Refund Limitation

**A successful real Razorpay refund was not demonstrated.** The refund route, its
request validation, error handling, state transition to `refunded`, and persistence are
all implemented and tested. Actual execution against Razorpay's Test Mode API was blocked
by an account/environment-level restriction on this specific Razorpay Test Mode account
(confirmed independently via raw HTTPS calls that bypassed the SDK and this app entirely —
i.e., not something this application's code caused). See
[`docs/DEFECTS.md`](docs/DEFECTS.md) for the evidence.

---

## CI/CD

GitHub Actions workflow: [`.github/workflows/playwright.yml`](.github/workflows/playwright.yml)

- Triggers on `push` and `pull_request` to `main`
- Node.js 24, `npm ci` (requires the committed `package-lock.json`)
- Installs Chromium only (not Firefox/WebKit — the API/webhook tests don't render a page,
  and UI coverage was already validated on Chromium)
- Runs the 34-test **CI-safe suite** (`npm run test:ci`) — no real Razorpay credentials
  are used; the workflow sets fixed, non-secret placeholder values just so the app's
  "is Razorpay configured" guards don't short-circuit the tests' own logic
- Uploads the Playwright HTML report on every run, and failure traces/screenshots only
  when something fails
- Full detail, including two confirmed-passing real GitHub Actions runs, in
  [`docs/CI-CD.md`](docs/CI-CD.md)

---

## Setup

**Requirements:** Node.js `>=22.5.0` (required by the built-in `node:sqlite` persistence
layer), npm, Git.

```bash
git clone https://github.com/Open83/Razorpay-Payment-Gateway---QA---Automation.git
cd Razorpay-Payment-Gateway---QA---Automation

npm install          # or: npm ci (uses the committed lockfile)

cp .env.example .env
# Edit .env and add your own Razorpay Test Mode credentials (see docs/RAZORPAY-GUIDE.md).
# Never commit .env or share its values.

npm start            # starts the app on http://localhost:3000
```

The app creates a local `data/app.db` SQLite file on first run (git-ignored) — no
separate database setup is required.

**Running tests:**
```bash
npm run test:ci        # the 34 CI-safe tests (no real Razorpay account needed)
npm run test:razorpay  # the 3 Razorpay-live tests (needs your own real .env credentials)
npm test                # everything (37) against whatever credentials .env has, if any
npm run test:report     # view the last HTML report
```

---

## Project Structure

```
.
├── .github/workflows/
│   └── playwright.yml        # GitHub Actions CI workflow
├── docs/                     # QA documentation (see below)
├── public/
│   ├── index.html            # Demo checkout page
│   └── app.js                 # Frontend Checkout integration
├── src/
│   ├── app.js                 # Express app + middleware ordering
│   ├── config.js              # Environment/config loading
│   ├── db.js                  # SQLite connection (node:sqlite)
│   ├── orderStore.js          # Order/refund/webhook-event persistence
│   ├── stateMachine.js        # Payment/order lifecycle state machine
│   └── routes/
│       ├── payments.js
│       ├── refunds.js
│       └── webhooks.js
├── tests/
│   ├── api/                   # Health/config/order API tests
│   ├── security/              # Signature, webhook, refund-error, error-handling tests
│   └── ui/                    # Frontend UI tests
├── .env.example
├── package.json
└── playwright.config.js
```

---

## Documentation

| Document | Contents |
|---|---|
| [`SETUP.md`](SETUP.md) | Detailed local setup and troubleshooting |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Application design, persistence, and state machine |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security controls and the two resolved defects |
| [`docs/RAZORPAY-GUIDE.md`](docs/RAZORPAY-GUIDE.md) | Razorpay Test Mode credential and test-payment setup |
| [`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md) | QA test strategy (written early in the project; later phases evolved beyond its original scope) |
| [`docs/TEST-CASES.md`](docs/TEST-CASES.md) | Full test case inventory |
| [`docs/DEFECTS.md`](docs/DEFECTS.md) | DEF-001 / DEF-002 — root cause, fix, regression evidence |
| [`docs/CI-CD.md`](docs/CI-CD.md) | CI workflow detail and real GitHub Actions run evidence |
| `docs/PHASE-*.md` | Dated phase-by-phase test reports (the project's working history) |

---

## Contributing

This is a demonstration portfolio project. Issues and feedback are welcome.

## License

MIT
