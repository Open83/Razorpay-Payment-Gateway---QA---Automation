# Local Development Setup

## Prerequisites

- **Node.js** `>=22.5.0` (check: `node --version`) — required by the built-in `node:sqlite`
  module used for persistence (`src/db.js`); earlier Node versions do not have it
- **npm** v9 or higher (check: `npm --version`)
- **Git**
- A modern browser (Chromium is installed automatically by Playwright; Firefox/WebKit are
  configured in `playwright.config.js` but not required for the default test run)

## Step-by-Step Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Open83/Razorpay-Payment-Gateway---QA---Automation.git
cd Razorpay-Payment-Gateway---QA---Automation
```

### 2. Install Dependencies

```bash
npm install
```
or, to install exactly what the committed lockfile specifies (what CI does):
```bash
npm ci
```

This installs the app's runtime dependencies (`express`, `razorpay`, `dotenv`) and the
`@playwright/test` dev dependency. Persistence uses Node's built-in `node:sqlite` — no
separate database package is installed.

**Verify installation:**
```bash
npx playwright --version
```

### 3. Install Playwright Browsers

```bash
npx playwright install chromium
```
(Or `npx playwright install` for all three browsers, if you want to run the `firefox`/
`webkit` projects manually — the default test scripts only use Chromium.)

### 4. Set Up Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your own Razorpay Test Mode credentials:
   ```
   RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET=your_test_secret_key_here
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
   APP_URL=http://localhost:3000
   NODE_ENV=test
   ```
   - See [`docs/RAZORPAY-GUIDE.md`](docs/RAZORPAY-GUIDE.md) for how to obtain these and for
     a verified-working Test Mode payment flow.
   - Ensure you are in **TEST MODE** in your Razorpay dashboard.
   - **Never commit `.env`** — it's already git-ignored.

Without real credentials, the app still runs and most of the CI-safe test suite still
passes (routes that need Razorpay return a sanitized `503`/error response instead) — see
[`docs/CI-CD.md`](docs/CI-CD.md) for exactly which tests do and don't need real
credentials.

### 5. Persistence (SQLite)

The app persists orders, refunds, and webhook events to a local SQLite file. On first run,
it automatically creates `data/app.db` (and its `-wal`/`-shm` companion files) — no manual
database setup, migration step, or separate service is required. The `data/` directory is
git-ignored; deleting it resets the app to a clean state.

### 6. Running the Application

```bash
npm start
```
or directly:
```bash
node src/app.js
```
The app runs on `http://localhost:3000`.

**Verify the app is running:**
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/payments/config
```
The config endpoint returns only the public key ID (or `NOT_CONFIGURED`) and a
`configured` boolean — never a secret.

**In a browser:** open `http://localhost:3000` to see the demo checkout page. Completing
an actual payment requires valid Razorpay Test Mode credentials in `.env`.

### 7. Running Tests

```bash
npm run test:ci        # 34 CI-safe tests — what GitHub Actions runs, no real Razorpay account needed
npm run test:razorpay  # 3 Razorpay-live tests — needs your own real .env credentials
npm test                 # all 37 tests, against whatever .env currently has
npm run test:ui        # interactive Playwright UI
npm run test:debug     # step-through debugger
npm run test:report    # view the last HTML report
```

`test:ci` and `test:razorpay` both restrict to the Chromium project
(`--project=chromium`) and split the suite via Playwright's `--grep`/`--grep-invert` on
the `@razorpay-live` tag — see [`docs/CI-CD.md`](docs/CI-CD.md) for exactly which 3 tests
that tag covers and why.

The Playwright tests automatically start the Express app via the `webServer` setting in
`playwright.config.js` — you don't need to start it manually before running tests.

## Troubleshooting

### "Command not found: npm"
- Install Node.js `>=22.5.0` from https://nodejs.org/
- Restart your terminal/shell

### `node:sqlite` errors / app won't start
- Check your Node version: `node --version` — this project requires `>=22.5.0`.
  Older versions (including v18/v20) do not have the built-in `node:sqlite` module this
  app's persistence layer depends on.

### Playwright browsers not found
```bash
npx playwright install chromium
```

### Tests timeout or can't reach localhost:3000
- Ensure the app is running: `node src/app.js`
- Check that port 3000 is not already in use: `netstat -ano | findstr :3000` (Windows) or
  `lsof -i :3000` (macOS/Linux)

### `.env` file not loaded
- Ensure `.env` is in the project root
- Restart your terminal after creating/modifying `.env`

### Razorpay-live tests fail
- `npm run test:razorpay` needs real, valid Razorpay Test Mode credentials in `.env`.
- Two of the three (`SIG-001`, `REPLAY-001`) reference one specific real payment captured
  during this project's own testing — they will only pass against the exact Razorpay
  account that created it, not just any valid Test Mode account. This is expected and
  documented in `docs/CI-CD.md` and inside the test file itself.

## Development Workflow

1. Make code changes under `src/`
2. Run the CI-safe suite locally: `npm run test:ci`
3. Use `npm run test:ui` for interactive debugging
4. Commit and push — GitHub Actions runs the CI-safe suite automatically on `main` and on pull requests

## Next Steps

- Read [`docs/RAZORPAY-GUIDE.md`](docs/RAZORPAY-GUIDE.md) to set up your own Razorpay Test
  Mode credentials
- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the app and its persistence/
  state machine fit together
- See [`README.md`](README.md) for the project overview, test summary, and known limitations
