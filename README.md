# Razorpay Payment Gateway — QA & Automation

A professional QA automation portfolio project demonstrating comprehensive testing of Razorpay payment integration using **Playwright Test**.

## Project Purpose

This repository showcases QA engineering skills through rigorous testing of a minimal payment application integrated with Razorpay's Test Mode. The focus is on **QA automation**, not application development.

## Technology Stack

- **Node.js** (v18+)
- **Express.js** (minimal web framework)
- **Playwright Test** (browser & API testing)
- **Razorpay Test Mode** (payment gateway)
- **GitHub Actions** (CI/CD)

## Testing Scope

### Testing Layers
- **UI Automation** — Checkout flow, success/failure pages
- **API Testing** — Order creation, refunds, payment status
- **Webhook Testing** — Signature validation, idempotency, event processing
- **Business Logic** — Amount validation, duplicate prevention, state transitions
- **Integration** — End-to-end payment flows, failure scenarios

### What We Test
- ✅ Payment checkout flow
- ✅ Successful and failed payments
- ✅ Payment cancellation
- ✅ Refunds (full and partial)
- ✅ Webhook delivery and signature validation
- ✅ Duplicate webhook handling
- ✅ Amount validation and business logic
- ✅ State transitions and consistency
- ✅ Failure scenarios (timeouts, network errors, declined cards)

### What We Don't Use
- ❌ Production Razorpay APIs
- ❌ Real payment credentials
- ❌ Real money or customer data
- ❌ Production databases
- ❌ Fake defects or fabricated test results

## Quick Start

### Prerequisites
- Node.js v18 or higher
- Git
- Razorpay Test Mode account (free, instant signup at https://razorpay.com)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/razorpay-qa-automation.git
   cd razorpay-qa-automation
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Razorpay credentials**
   - Copy `.env.example` to `.env`
   - Add your Razorpay Test Mode credentials (see [RAZORPAY-GUIDE.md](docs/RAZORPAY-GUIDE.md))
   ```bash
   cp .env.example .env
   # Edit .env and add your credentials
   ```

4. **Start the application**
   ```bash
   npm start
   ```
   App will run on http://localhost:3000

5. **Run tests**
   ```bash
   npm test                 # Run all tests (requires app running)
   npm run test:ui        # Interactive test UI
   npm run test:debug     # Debug mode
   ```

## Documentation

- **[SETUP.md](SETUP.md)** — Detailed local development setup
- **[RAZORPAY-GUIDE.md](docs/RAZORPAY-GUIDE.md)** — Razorpay test credentials and test mode setup
- **[docs/](docs/)** — Additional architecture and testing documentation (coming in later phases)

## Project Structure

```
razorpay-qa-automation/
├── tests/                    # Playwright test files
│   ├── api/                 # API tests
│   ├── ui/                  # UI/browser tests
│   ├── integration/         # End-to-end tests
│   └── fixtures/            # Test data and helpers
├── src/                     # Application source code
│   ├── app.js              # Express server
│   ├── routes/             # API routes
│   ├── middleware/         # Middleware (webhook validation, etc.)
│   └── config.js           # Configuration
├── docs/                   # Documentation
├── .github/
│   └── workflows/          # GitHub Actions CI/CD
├── playwright.config.js    # Playwright Test configuration
├── package.json            # Dependencies and scripts
├── .env.example            # Environment variables template
└── README.md               # This file
```

## Development

### Running Tests Locally

```bash
# All tests
npm test

# Specific test file
npm test tests/api/payments.spec.js

# With UI (interactive)
npm run test:ui

# Debug mode
npm run test:debug

# View HTML report
npm run test:report
```

### Running the Application

Tests automatically start the app via `webServer` in `playwright.config.js`. To run manually:

```bash
npm install
node src/app.js
```

The app will be available at `http://localhost:3000`.

## CI/CD

Tests run automatically on pull requests via GitHub Actions. See `.github/workflows/test.yml` for configuration.

## Contributing

This is a demonstration portfolio project. Issues and feedback are welcome.

## License

MIT

---

**Status**: Phase 1 (Project Foundation) ✅ Complete
