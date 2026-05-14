const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');
const logger = require('../utils/logger');

let shopifyConfig = null;

async function initializeShopify() {
  try {
    shopifyConfig = shopifyApi({
      apiVersion: ApiVersion.January24,
      hostName: process.env.HOST_URL,
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      scopes: process.env.SHOPIFY_SCOPES?.split(',') || [
        'read_orders',
        'write_orders',
        'read_products',
        'read_customers',
        'write_customers',
        'read_fulfillments',
        'write_fulfillments',
        'read_inventory',
        'write_inventory'
      ],
      isEmbeddedApp: true,
    });

    logger.info('Shopify configuration initialized');
    return shopifyConfig;
  } catch (error) {
    logger.error('Failed to initialize Shopify:', error);
    throw error;
  }
}

function getShopifyConfig() {
  if (!shopifyConfig) {
    throw new Error('Shopify not initialized. Call initializeShopify() first.');
  }
  return shopifyConfig;
}

async function createShopifySession(shopDomain, accessToken) {
  const sessionId = `offline_${shopDomain}`;
  const { Session } = require('@shopify/shopify-api');

  const session = new Session({
    id: sessionId,
    shop: shopDomain,
    state: '',
    isOnline: false,
    accessToken,
    scope: process.env.SHOPIFY_SCOPES,
  });

  return session;
}

async function verifyWebhookHMAC(body, hmacHeader) {
  const crypto = require('crypto');
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET;

  const calculatedHmac = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedHmac),
      Buffer.from(hmacHeader)
    );
  } catch {
    return false;
  }
}

module.exports = {
  initializeShopify,
  getShopifyConfig,
  createShopifySession,
  verifyWebhookHMAC,  // ← fixed: was wrongly exported as verifyWebhook
};
