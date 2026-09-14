import express from 'express';
import { config } from './config.js';
import paymentsRouter from './routes/payments.js';
import webhooksRouter from './routes/webhooks.js';
import refundsRouter from './routes/refunds.js';

const app = express();

// The webhook route needs the exact raw request body to verify Razorpay's
// HMAC signature (see docs/DEFECTS.md, DEF-002). It must be mounted BEFORE
// the global express.json() parser below - otherwise express.json() would
// consume and parse the body first, and the webhook route's own
// express.raw() middleware (src/routes/webhooks.js) would never see the
// original bytes. Every other route still gets normal JSON parsing via the
// global middleware mounted after this.
app.use('/api/webhooks', webhooksRouter);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/api/payments', paymentsRouter);
app.use('/api/refunds', refundsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.app.nodeEnv,
  });
});

// Home page redirect
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} does not exist`,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
  });
});

// Start server
const port = config.app.port;
app.listen(port, () => {
  console.log(`✅ Server running on ${config.app.appUrl}`);
  console.log(`Environment: ${config.app.nodeEnv}`);
});

export default app;
