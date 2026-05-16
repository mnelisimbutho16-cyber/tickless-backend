const { Resend } = require('resend');
const logger = require('../utils/logger');

// Lazy init — only creates Resend client when first email is sent
function getResend() {
  return new Resend(process.env.RESEND_API_KEY || 'placeholder');
}

const FROM = process.env.EMAIL_FROM || 'orders@tickless.app';

// ── Tracking Email ────────────────────────────────────────────────────────────
async function sendTrackingEmail({ to, customerName, orderNumber, trackingUrl, storeName }) {
  try {
    const resend = getResend();
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `Your order #${orderNumber} is on its way`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">${storeName}</h2>
          <h1 style="font-size:22px;margin:0 0 16px">Your order is on its way, ${customerName} 👋</h1>
          <p style="color:#444">We'll keep you updated every step of the way. Track your order in real time:</p>
          <a href="${trackingUrl}" style="display:inline-block;background:#000;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
            Track My Order →
          </a>
          <p style="color:#999;font-size:13px">Order #${orderNumber}</p>
        </div>
      `,
    });
    logger.info(`Tracking email sent to ${to} for order #${orderNumber}`);
  } catch (error) {
    logger.error('sendTrackingEmail failed:', error);
  }
}

// ── Preemptive Delay Warning ──────────────────────────────────────────────────
async function sendDelayWarning({ to, customerName, orderNumber, trackingUrl, storeName, estimatedDelay }) {
  try {
    const resend = getResend();
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `A quick update on your order #${orderNumber}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">${storeName}</h2>
          <h1 style="font-size:22px;margin:0 0 16px">Heads up on your order, ${customerName}</h1>
          <p style="color:#444">Your order is still on its way, but there's a small carrier delay. We wanted to let you know before you had to ask.</p>
          ${estimatedDelay ? `<p><strong>Expected delay:</strong> ${estimatedDelay}</p>` : ''}
          <a href="${trackingUrl}" style="display:inline-block;background:#000;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
            See Live Status →
          </a>
          <p style="color:#999;font-size:13px">No need to contact support — we're watching this for you.</p>
        </div>
      `,
    });
    logger.info(`Delay warning sent to ${to} for order #${orderNumber}`);
  } catch (error) {
    logger.error('sendDelayWarning failed:', error);
  }
}

// ── Return Confirmation ───────────────────────────────────────────────────────
async function sendReturnConfirmation({ to, customerName, orderNumber, returnUrl, qrCodeUrl, storeCreditOffer, storeName }) {
  try {
    const resend = getResend();
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `Your return for order #${orderNumber} is confirmed`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">${storeName}</h2>
          <h1 style="font-size:22px;margin:0 0 16px">Return confirmed, ${customerName}</h1>

          ${storeCreditOffer ? `
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:16px 0">
            <strong>💡 Better option available:</strong> Take <strong>$${storeCreditOffer} store credit</strong> instead — that's 10% more than your refund.
            <br><br>
            <a href="${returnUrl}?accept_credit=true" style="color:#16a34a;font-weight:bold;text-decoration:none">
              Accept Store Credit →
            </a>
          </div>
          ` : ''}

          <p style="color:#444">Your return QR code — scan at any drop-off location. No printer needed.</p>
          ${qrCodeUrl ? `<img src="${qrCodeUrl}" width="180" height="180" alt="Return QR Code" style="display:block;margin:16px 0">` : ''}
          <a href="${returnUrl}" style="display:inline-block;background:#000;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
            View Return Details →
          </a>
        </div>
      `,
    });
    logger.info(`Return confirmation sent to ${to} for order #${orderNumber}`);
  } catch (error) {
    logger.error('sendReturnConfirmation failed:', error);
  }
}

// ── Win-Back Email ────────────────────────────────────────────────────────────
async function sendWinBack({ to, customerName, storeName, discountCode, shopUrl }) {
  try {
    const resend = getResend();
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `We made it right — here's something for you`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">${storeName}</h2>
          <h1 style="font-size:22px;margin:0 0 16px">Hey ${customerName} — we hope we got it right</h1>
          <p style="color:#444">We noticed your recent return and wanted to make sure you're happy. Here's something as a thank you:</p>
          <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center;margin:16px 0">
            <p style="margin:0;font-size:13px;color:#999">Your discount code</p>
            <p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:8px 0">${discountCode}</p>
            <p style="margin:0;font-size:13px;color:#999">15% off your next order</p>
          </div>
          <a href="${shopUrl}/discount/${discountCode}" style="display:inline-block;background:#000;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
            Shop Now →
          </a>
        </div>
      `,
    });
    logger.info(`Win-back email sent to ${to}`);
  } catch (error) {
    logger.error('sendWinBack failed:', error);
  }
}

module.exports = {
  sendTrackingEmail,
  sendDelayWarning,
  sendReturnConfirmation,
  sendWinBack,
};
