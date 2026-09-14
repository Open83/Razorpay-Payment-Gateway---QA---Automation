import dotenv from 'dotenv';

dotenv.config();

export const config = {
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  app: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  },
  demo: {
    productName: 'Demo Product',
    amountInPaise: 50000, // ₹500.00 in paise
    currency: 'INR',
  },
};

// Validate that required config exists
if (!config.razorpay.keyId) {
  console.warn('⚠️  RAZORPAY_KEY_ID not configured. API calls will fail.');
}
if (!config.razorpay.keySecret) {
  console.warn('⚠️  RAZORPAY_KEY_SECRET not configured. API calls will fail.');
}
if (!config.razorpay.webhookSecret) {
  console.warn('⚠️  RAZORPAY_WEBHOOK_SECRET not configured. Webhook validation will fail.');
}
