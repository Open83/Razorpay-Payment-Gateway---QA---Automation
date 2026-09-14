// Frontend JavaScript for Razorpay Payment Gateway Demo

let currentOrder = null;
let currentPayment = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializePage();
});

/**
 * Initialize page with product information
 */
async function initializePage() {
  try {
    // Fetch product details from backend
    const response = await fetch('/api/payments/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    currentOrder = data;

    // Display product information
    document.getElementById('productName').textContent = data.productName;
    document.getElementById('productAmount').textContent = formatAmount(data.amount);

    clearStatus();
  } catch (error) {
    showStatus('error', 'Initialization Failed',
      `Could not load product details: ${error.message}`);
    console.error('Initialization error:', error);
  }
}

/**
 * Format amount from paise to currency display
 */
function formatAmount(paise) {
  const rupees = paise / 100;
  return '₹' + rupees.toFixed(2);
}

/**
 * Initiate payment using Razorpay Checkout
 */
async function initiatePayment() {
  try {
    if (!currentOrder || !currentOrder.orderId) {
      showStatus('error', 'Order Not Ready', 'Order was not created. Please refresh the page.');
      return;
    }

    showStatus('info', 'Loading Checkout', 'Preparing payment gateway...');

    // Get Razorpay Key ID (from server)
    const keyResponse = await fetch('/api/payments/config', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch(() => null);

    // Fallback if endpoint doesn't exist
    const keyId = keyResponse && keyResponse.ok
      ? (await keyResponse.json()).keyId
      : 'rzp_test_placeholder';

    // Razorpay Checkout options
    const options = {
      key: keyId,
      amount: currentOrder.amount,
      currency: currentOrder.currency,
      order_id: currentOrder.orderId,
      name: 'Razorpay QA Demo',
      description: currentOrder.productName,
      handler: onPaymentSuccess,
      prefill: {
        name: 'Test Customer',
        email: 'test@example.com',
        contact: '9999999999',
      },
      theme: {
        color: '#667eea',
      },
    };

    // Open Razorpay Checkout
    const rzp = new Razorpay(options);
    rzp.on('payment.failed', onPaymentFailed);
    rzp.open();

    clearStatus();
  } catch (error) {
    showStatus('error', 'Payment Initiation Failed',
      `Could not open checkout: ${error.message}`);
    console.error('Payment initiation error:', error);
  }
}

/**
 * Handle successful payment (Razorpay callback)
 */
async function onPaymentSuccess(response) {
  try {
    showStatus('info', 'Verifying Payment', 'Please wait while we verify your payment...');

    const { razorpay_payment_id, razorpay_signature } = response;

    // Verify payment on backend
    const verifyResponse = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: currentOrder.orderId,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      }),
    });

    const verifyData = await verifyResponse.json();

    if (verifyData.verified) {
      currentPayment = verifyData.paymentDetails;
      showPaymentSuccess(verifyData.paymentDetails);
      document.getElementById('refundSection').style.display = 'block';
    } else {
      showStatus('error', 'Verification Failed',
        'Payment signature verification failed');
    }
  } catch (error) {
    showStatus('error', 'Verification Error',
      `Failed to verify payment: ${error.message}`);
    console.error('Payment verification error:', error);
  }
}

/**
 * Handle failed payment (Razorpay callback)
 */
function onPaymentFailed(error) {
  showStatus('error', 'Payment Failed',
    `${error.description || 'Payment was not processed. Please try again.'}`);
  console.error('Payment failed:', error);
}

/**
 * Display successful payment information
 */
function showPaymentSuccess(details) {
  showStatus('success', 'Payment Successful!',
    'Your payment has been verified and processed.');

  const detailsHtml = `
    <div class="detail-row">
      <span class="detail-label">Payment ID</span>
      <span class="detail-value">${details.paymentId}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Order ID</span>
      <span class="detail-value">${details.orderId}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Amount</span>
      <span class="detail-value">${formatAmount(details.amount)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value"><strong>${details.status}</strong></span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Method</span>
      <span class="detail-value">${details.method || 'N/A'}</span>
    </div>
  `;

  document.getElementById('detailsContent').innerHTML = detailsHtml;
  document.getElementById('paymentDetails').classList.add('show');
  document.getElementById('payButton').disabled = true;
  document.getElementById('payButton').textContent = 'Payment Complete';
}

/**
 * Initiate refund for current payment
 */
async function initiateRefund() {
  try {
    if (!currentPayment || !currentPayment.paymentId) {
      showRefundStatus('error', 'No Payment Found',
        'No payment to refund. Please complete a payment first.');
      return;
    }

    document.getElementById('refundButton').disabled = true;
    document.getElementById('refundButton').innerHTML =
      '<span class="spinner"></span>Processing Refund...';

    const refundResponse = await fetch('/api/refunds/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentId: currentPayment.paymentId,
        notes: { reason: 'Test refund from demo' },
      }),
    });

    const refundData = await refundResponse.json();

    if (refundData.refundId) {
      showRefundStatus('success', 'Refund Initiated',
        `Refund ID: ${refundData.refundId}`);
    } else {
      showRefundStatus('error', 'Refund Failed',
        refundData.message || 'Could not create refund');
    }
  } catch (error) {
    showRefundStatus('error', 'Refund Error',
      `Failed to initiate refund: ${error.message}`);
    console.error('Refund error:', error);
  } finally {
    document.getElementById('refundButton').disabled = false;
    document.getElementById('refundButton').innerHTML = 'Create Full Refund';
  }
}

/**
 * Display status message
 */
function showStatus(type, title, message) {
  const statusDiv = document.getElementById('statusSection');
  statusDiv.className = `status ${type}`;
  statusDiv.innerHTML = `
    <div class="status-title">${title}</div>
    <div>${message}</div>
  `;
}

/**
 * Display refund status message
 */
function showRefundStatus(type, title, message) {
  const statusDiv = document.getElementById('refundStatus');
  statusDiv.className = `status ${type}`;
  statusDiv.innerHTML = `
    <div class="status-title">${title}</div>
    <div>${message}</div>
  `;
}

/**
 * Clear status messages
 */
function clearStatus() {
  document.getElementById('statusSection').className = 'status';
  document.getElementById('statusSection').innerHTML = '';
}
