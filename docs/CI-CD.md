# CI/CD — GitHub Actions

**Phase:** 4.1 — CI/CD & Regression Engineering
**Workflow file:** `.github/workflows/playwright.yml`
**Status:** New workflow (none existed previously; only a `.gitkeep` placeholder was present in `.github/workflows/`, now replaced by this file).

---

## 1. Trigger

- `push` to `main`
- `pull_request` targeting `main`

## 2. Runner / Node version

- `ubuntu-latest`
- Node.js **24.x**, installed via `actions/setup-node@v4` with `cache: 'npm'`.

**Why 24, not the `>=18.0.0` the project previously declared:** the app's persistence
layer (`src/db.js`) uses Node's built-in `node:sqlite` module, added in Node 22.5 and not
present at all in Node 18/20. The old `engines` field in `package.json` predates Phase 3.3
(when persistence was added) and was never updated — it would have let CI pick an
incompatible Node version and fail at `import { DatabaseSync } from 'node:sqlite'` before a
single test ran. Fixed as part of this phase (`package.json` now says `>=22.5.0`) since it
directly blocks the CI workflow this phase exists to deliver. The workflow itself pins
Node 24 to match the version this whole project has been developed and tested against.

---

## 3. Test classification: CI-safe vs. Razorpay-dependent

This was determined **empirically**, not assumed — by running the full suite three ways
(no Razorpay env vars at all, non-real placeholder values, and real Test Mode
credentials) against a freshly-created database each time, and observing exactly what
changes. Full detail below.

### A. CI-safe (34 tests) — run automatically on every push/PR

Everything **except** the three tests in section B. This includes:
- Health/config (`HEALTH-001`, `CONFIG-001/002/003`)
- Order creation error/validation paths (`ORDER-001/002/003`)
- Error sanitization (`ERR-001/002/003/004`)
- Refund validation and crash-regression (`REF-001`, `REF-ERR-001/002`)
- Signature rejection paths (`SIG-002/003/004/005/006`)
- All webhook validation and idempotency tests (`WEB-001..007`, `WEB-FIX-001..004`)
- Most UI tests (`UI-001`, `UI-003/004/005`)

None of these need genuine Razorpay Test Mode credentials to produce a meaningful,
deterministic result — see the placeholder-credential note below for why they still
need *some* non-empty value.

### B. Razorpay-dependent (3 tests) — excluded from CI, tagged `@razorpay-live`

| Test | Why it can't run in generic CI |
|------|--------------------------------|
| `SIG-001` | Calls `payments.fetch()` on one **specific, real, already-captured** Razorpay Test Mode payment (`pay_TbqJMlA39g3qiF`) from Phase 3.3. Needs the exact account that created it — not reproducible even if a different real Razorpay Test Mode account's secrets are supplied. |
| `REPLAY-001` | Same specific real payment as `SIG-001`. |
| `UI-002` | The app's own page load calls `POST /api/payments/create-order` and needs it to genuinely succeed to display a real amount. This one **would** pass with *any* valid Razorpay Test Mode account's real credentials — it's not tied to one specific historical transaction like the other two — but since that isn't guaranteed in a generic CI run, it's excluded from the default suite too. |

Excluded via Playwright's built-in tag/grep mechanism (Step 7's suggestion): each test's
title has `@razorpay-live` appended, and the CI script runs
`playwright test --grep-invert "@razorpay-live"`. No tests were duplicated, and no
assertions were weakened to make this split — the tag is purely a title-string marker.

A separate, **manual-only** npm script exists for these:
```bash
npm run test:razorpay
```
This is intentionally **not** wired into the GitHub Actions workflow. Per Phase 4.1 scope,
scheduled/nightly gateway testing is not implemented yet — running this suite is a
deliberate, local, controlled action a developer takes with their own real `.env`
credentials.

### Why "CI-safe" tests still need *a* (non-real) credential value

Both `/api/payments/verify` and `/api/refunds/create` return `503 Razorpay not configured`
immediately if `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are entirely absent — *before* any
of their actual validation logic (missing fields, signature checks, sanitized error
handling) ever runs. Likewise, `POST /api/webhooks/razorpay` always returns `401` if
`RAZORPAY_WEBHOOK_SECRET` is unset, regardless of the signature sent.

This was confirmed empirically: running the full suite with **no** Razorpay env vars at
all produced **16 failures** (tests that assert `400`/`401`/`200` never got past the `503`
guard). Setting **any** non-empty string for these three variables — genuinely fake values,
never valid against Razorpay's real API — was enough to bring that down to exactly the 3
genuinely account-dependent failures in section B. The workflow therefore sets three
**plain, non-secret placeholder** environment values directly in the YAML (see the workflow
file's own comment for detail) — this is not a GitHub Secret and is not treated as one,
because it isn't sensitive: no call made with it ever succeeds against Razorpay, and it is
the same kind of fallback value the test files themselves already use locally (e.g.
`signature-verification.spec.js`'s `'test_key_secret_for_qa_only'` default).

**Real GitHub Secrets are never referenced by this workflow.** If real Razorpay Test Mode
secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) are ever added
to the repository/environment for the manual `test:razorpay` path, they must stay out of
`playwright.yml` — that workflow is scoped to the CI-safe suite only.

---

## 4. Playwright configuration

`playwright.config.js` was already CI-aware before this phase and was **not restructured**:
- `forbidOnly: !!process.env.CI` — an accidentally-committed `.only()` fails CI instead of
  silently narrowing the run.
- `retries: process.env.CI ? 2 : 0` — tolerates transient flakiness in CI only; local runs
  fail fast.
- `workers: process.env.CI ? 1 : undefined` — single worker in CI, both for determinism
  against the shared SQLite file and to keep CI resource usage modest.
- `webServer: { command: 'node src/app.js', reuseExistingServer: !process.env.CI, ... }` —
  GitHub Actions sets `CI=true` automatically, so in CI Playwright always starts a fresh
  app process, waits for `http://localhost:3000` to respond, runs the tests, then shuts it
  down — no second/duplicate app-start mechanism was introduced.
- `reporter: [['html'], ['list']]` — HTML report for the artifact, list output for readable
  CI logs.

**Browser scope:** the `projects` array still lists `chromium`, `firefox`, `webkit` (useful
for optional local cross-browser runs), but the CI script explicitly passes
`--project=chromium` — the API/webhook tests don't render a page at all (no browser-specific
behavior to catch), and the UI tests were already validated on Chromium in Phase 3.3/3.3.1.
Running all three projects in CI would only multiply identical executions, which Phase 4.1
explicitly discourages.

---

## 5. Package scripts

```json
"test:ci": "playwright test --project=chromium --grep-invert @razorpay-live",
"test:razorpay": "playwright test --project=chromium --grep @razorpay-live"
```

`test:ci` is what the workflow runs. `test:razorpay` is the manual, local-only companion —
run it with your own real `.env` credentials in place:
```bash
npm run test:razorpay
```
Expect `UI-002` to pass with any valid Test Mode account; `SIG-001`/`REPLAY-001` will only
pass against the specific Razorpay Test Mode account that captured `pay_TbqJMlA39g3qiF` in
Phase 3.3 (see the in-file comments in `tests/security/signature-verification.spec.js` for
how to refresh those IDs against your own account if needed).

---

## 6. A necessary SQLite concurrency fix (WAL mode)

While building the deterministic `WEB-FIX-001`/`002`/`004` regression tests, each test was
made self-contained by seeding a fresh synthetic order directly via `src/orderStore.js`
(so they don't depend on Phase 3.3's specific historical order — see the in-file comment
in `tests/security/webhook-validation.spec.js`). That import opens a **second** SQLite
connection to the same `data/app.db` file the running app server already has open, from a
separate OS process (the Playwright test runner). Under the default SQLite journal mode,
this produced real, reproducible `SQLITE_BUSY`/"database is locked" errors under the
parallel test load. `src/db.js` now sets:
```js
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
```
WAL mode allows one writer plus concurrent readers across multiple processes on the same
file; `busy_timeout` makes a connection retry for up to 5s instead of erroring immediately
on a brief collision. Both are standard SQLite settings — no schema or query behavior
changed, and the full 37-test suite (including the tagged tests) was re-verified to still
pass with real credentials after this change. This was necessary for the CI-safe suite to
be genuinely deterministic (Step 6/11's reliability requirement), not an unrelated fix.

---

## 7. Artifacts

- **`playwright-report/`** — the full HTML report, uploaded on every run (`if: always()`)
  so a passing run's report is inspectable too, not just failures.
- **`test-results/`** — traces/screenshots, uploaded **only on failure** (`if: failure()`)
  to avoid uploading large artifacts on every green run.
- Both were manually inspected (`grep` across the generated report/results) after a local
  CI-equivalent run and contained no credential values, real or placeholder — see Section 9.
- **Nothing else is uploaded.** `.env`, `data/app.db`, and log files are not artifacts and
  are not part of the checked-out repository state the workflow could accidentally pick up
  (all git-ignored).

---

## 8. Local CI-equivalent execution (recorded result)

Run exactly as CI does — fresh `npm ci`, Chromium install, placeholder env vars, `CI=true`
so Playwright's `webServer` starts a genuinely fresh app process:
```bash
npm ci
npx playwright install --with-deps chromium
CI=true NODE_ENV=test \
  RAZORPAY_KEY_ID=rzp_test_ci_placeholder_not_real \
  RAZORPAY_KEY_SECRET=ci_placeholder_secret_not_real \
  RAZORPAY_WEBHOOK_SECRET=ci_placeholder_webhook_secret_not_real \
  npx playwright test --project=chromium --grep-invert "@razorpay-live"
```
**Result:** 34 passed, 0 failed, 0 flaky, run against a freshly-created (empty) SQLite
database exactly as a fresh CI checkout would have. Confirmed stable across 3 consecutive
runs with placeholder credentials and unaffected when re-run against real credentials
(37/37 including the tagged tests).

---

## 9. Security

- The workflow never echoes an environment variable, never prints `.env`, and never
  uploads `.env` or `data/app.db` (both git-ignored, never checked out, never artifacts).
- The three placeholder values in the workflow are not secrets (see Section 3) and are
  safe to be public — this was a deliberate design choice, not an oversight.
- If real secrets are added later for the manual `test:razorpay` path, they belong in
  GitHub repository/environment secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`) — **the user must add these manually**; this phase does not
  and must not configure them automatically, and they are not referenced anywhere in
  `playwright.yml`.
- Generated `playwright-report/`/`test-results/` were grepped for the placeholder secret
  string and the real key ID after a local run — neither appeared.
- `package-lock.json` is no longer git-ignored (see below) — it contains only package
  names/versions/integrity hashes, no credentials.

---

## 10. Files changed for `npm ci` to work at all

`package-lock.json` was previously listed in `.gitignore`. `npm ci` **requires** a
committed lockfile to reproduce the exact dependency tree — without it, the very first
step of the workflow would fail immediately (`npm ci` errors when no lockfile is present).
This is fixed in `.gitignore` (the line removed, with an explanatory comment left in its
place). This is a direct prerequisite for the CI approach this phase specifies, not a
tangential change.

---

## 11. Limitations

- Real Razorpay Test Mode integration (`SIG-001`, `REPLAY-001`, `UI-002`, and the full
  manual Checkout/webhook/refund lifecycle from Phase 3.3/3.3.1) is **not** exercised by
  this CI workflow, by design. It remains a manual, local activity via `npm run
  test:razorpay` and the procedures documented in `docs/PHASE-3.3-TEST-REPORT.md` /
  `docs/PHASE-3.3.1-DEFECT-REMEDIATION-REPORT.md`.
- No scheduled/nightly Razorpay integration run exists yet (explicitly out of scope for
  this phase).
- The workflow has not yet been executed on GitHub Actions itself (would require a push;
  see the Final Report for why this phase stops short of that).
