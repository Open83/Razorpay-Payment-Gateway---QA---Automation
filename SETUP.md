# Local Development Setup

## Prerequisites

- **Node.js** v18 or higher (check: `node --version`)
- **npm** v9 or higher (check: `npm --version`)
- **Git**
- A modern browser (Chrome, Firefox, or Safari) — required for Playwright tests

## Step-by-Step Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/razorpay-qa-automation.git
cd razorpay-qa-automation
```

### 2. Install Dependencies

```bash
npm install
```

This installs:
- `@playwright/test` — Test runner and browser automation framework

**Verify installation:**
```bash
npx playwright --version
```

Expected output: `Version X.XX.X`

### 3. Set Up Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Razorpay Test Mode credentials:
   ```
   RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXX
   RAZORPAY_KEY_SECRET=your_test_secret_key_here
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
   APP_URL=http://localhost:3000
   NODE_ENV=test
   ```

   **How to get these credentials:**
   - Visit [RAZORPAY-GUIDE.md](docs/RAZORPAY-GUIDE.md) for detailed instructions
   - Ensure you are in **TEST MODE** in your Razorpay dashboard
   - Never commit `.env` to Git

### 4. Verify Playwright Installation

Download Playwright browsers:

```bash
npx playwright install
```

This may take a few minutes. Browsers are cached in `~/.cache/ms-playwright/`.

### 5. Run Tests Locally

#### Run all tests:
```bash
npm test
```

Expected output: Test results with pass/fail summary

#### Run with interactive UI:
```bash
npm run test:ui
```

This opens the Playwright Test UI, allowing you to:
- Run tests interactively
- Inspect failures
- View traces
- Debug step-by-step

#### Run in debug mode:
```bash
npm run test:debug
```

Launches a debugger where you can step through test code.

#### View test report:
```bash
npm run test:report
```

Opens the HTML test report in your browser.

### 6. Running the Application

#### Automatic (via Playwright)
The Playwright tests automatically start the Express app via `webServer` configuration in `playwright.config.js`.

#### Manual Start
```bash
npm start
```

Or directly with Node.js:
```bash
node src/app.js
```

The app will start on `http://localhost:3000`.

**Verify the app is running:**
```bash
curl http://localhost:3000/api/payments/config
```

Expected response:
```json
{
  "keyId": "rzp_test_XXXXXXXXXXXXX",
  "currency": "INR",
  "configured": true
}
```

**Access the demo app in browser:**
- Open http://localhost:3000 in your browser
- You should see the payment form with product details
- Requires valid Razorpay credentials in `.env` to complete payments

**Health check:**
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "environment": "development"
}
```

## Troubleshooting

### "Command not found: npm"
- Install Node.js from https://nodejs.org/ (v18+)
- Restart your terminal/shell

### Playwright browsers not found
```bash
npx playwright install
```

### Tests timeout or can't reach localhost:3000
- Ensure the app is running: `node src/app.js`
- Check that port 3000 is not in use: `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows)

### .env file not loaded
- Ensure `.env` file is in the project root directory
- Restart your terminal after creating/modifying `.env`
- Verify variables are readable: `cat .env` (should not error)

### Playwright test fails with connection errors
- Ensure Razorpay Test Mode credentials are correct in `.env`
- Check your internet connection (tests call Razorpay API)
- Verify `APP_URL` matches your running app URL

## Development Workflow

1. **Make code changes** to `src/`
2. **Run tests locally:**
   ```bash
   npm test
   ```
3. **Use UI mode for debugging:**
   ```bash
   npm run test:ui
   ```
4. **Commit and push** (CI runs tests automatically)

## Next Steps

- Read [docs/RAZORPAY-GUIDE.md](docs/RAZORPAY-GUIDE.md) to set up Razorpay test credentials
- Explore test examples in `tests/` (coming in Phase 2)
- Check [README.md](README.md) for project overview

---

**Need help?** Check the [FAQ section](#faq) or open an issue on GitHub.
