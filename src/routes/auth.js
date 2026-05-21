const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { initializeShopify, getShopifyConfig, createShopifySession } = require('../config/shopify');
const { createShopRecord, getShopByDomain, getShopByEmail } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();

// Begin OAuth process
router.get('/shopify', async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    // Validate shop domain format
    const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    if (!shopRegex.test(shop)) {
      return res.status(400).json({ error: 'Invalid shop domain format' });
    }

    // Ensure Shopify SDK is initialized
    await initializeShopify();
    const shopify = getShopifyConfig();

    // Generate state parameter for security
    const state = crypto.randomBytes(16).toString('hex');

    // Store state in cookie for verification on callback
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 5 * 60 * 1000 // 5 minutes
    });

    // Build authorization URL
    const authUrl = shopify.auth.begin({
      shop,
      callbackPath: '/api/auth/shopify/callback',
      isOnline: false,
      state
    });

    logger.info(`OAuth initiated for shop: ${shop}`);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('OAuth initiation failed:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

// OAuth callback handler
router.get('/shopify/callback', async (req, res) => {
  try {
    const { shop, code, state, hmac } = req.query;
    const storedState = req.cookies?.oauth_state;

    // Verify state parameter
    if (!state || state !== storedState) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Clear the state cookie
    res.clearCookie('oauth_state');

    // Ensure Shopify SDK is initialized
    await initializeShopify();
    const shopify = getShopifyConfig();

    // Exchange code for access token
    const session = await shopify.auth.callback({
      shop,
      code,
      hmac
    });

    // Save shop and token to database
    const shopRecord = await createShopRecord(
      shop,
      session.accessToken,
      session.scope
    );

    // Generate JWT token for our app
    const appToken = jwt.sign(
      {
        shopDomain: shop,
        shopId: shopRecord.id,
        scopes: session.scope
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Register webhooks for this shop
    await registerWebhooksForShop(shop, session.accessToken);

    logger.info(`OAuth completed for shop: ${shop}`);

    // Redirect to dashboard with token
    const redirectUrl = `${process.env.HOST_URL}/dashboard?token=${appToken}&shop=${shop}`;
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback failed:', error);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(
    Buffer.from(derived, 'hex'),
    Buffer.from(hash, 'hex')
  );
}

// Login with email and password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const shop = await getShopByEmail(email);
    if (!shop || !shop.password_hash || !shop.password_salt) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = verifyPassword(password, shop.password_salt, shop.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        shopDomain: shop.domain,
        shopId: shop.id,
        email: shop.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      shop: {
        id: shop.id,
        domain: shop.domain,
        storeName: shop.store_name,
        email: shop.email
      }
    });
  } catch (error) {
    logger.error('Login failed:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Register a new shop account
router.post('/register', async (req, res) => {
  try {
    const { email, password, storeName } = req.body;

    if (!email || !password || !storeName) {
      return res.status(400).json({ error: 'Email, password, and storeName are required' });
    }

    const existingShop = await getShopByEmail(email);
    if (existingShop) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const { salt, hash } = hashPassword(password);
    const sanitizedDomain = storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `shop-${Date.now()}`;
    const domain = `${sanitizedDomain}-${Date.now()}.local`;

    const shopRecord = await createShopRecord(domain, '', '', {
      email,
      passwordHash: hash,
      passwordSalt: salt,
      storeName
    });

    const token = jwt.sign(
      {
        shopDomain: shopRecord.domain,
        shopId: shopRecord.id,
        email: shopRecord.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      token,
      shop: {
        id: shopRecord.id,
        domain: shopRecord.domain,
        storeName: shopRecord.store_name,
        email: shopRecord.email
      }
    });
  } catch (error) {
    logger.error('Register failed:', error);
    res.status(500).json({ error: 'Register failed' });
  }
});

// Verify JWT token middleware
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.query.token;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify shop still exists and is active
    const shop = await getShopByDomain(decoded.shopDomain);
    if (!shop) {
      return res.status(401).json({ error: 'Shop not found or inactive' });
    }

    req.shop = shop;
    req.user = decoded;
    next();
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    logger.error('Token verification failed:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
};

// Get shop info
router.get('/shop', verifyToken, async (req, res) => {
  try {
    const shopify = getShopifyConfig();
    const session = await createShopifySession(req.shop.domain, req.shop.access_token);
    
    const shopData = await shopify.rest.Shop.all({
      session
    });

    res.json({
      shop: shopData.data[0],
      app_scopes: req.user.scopes
    });
    
  } catch (error) {
    logger.error('Failed to get shop info:', error);
    res.status(500).json({ error: 'Failed to retrieve shop information' });
  }
});

// Refresh webhooks (for troubleshooting)
router.post('/refresh-webhooks', verifyToken, async (req, res) => {
  try {
    await registerWebhooksForShop(req.shop.domain, req.shop.access_token);
    res.json({ message: 'Webhooks refreshed successfully' });
  } catch (error) {
    logger.error('Failed to refresh webhooks:', error);
    res.status(500).json({ error: 'Failed to refresh webhooks' });
  }
});

// Register webhooks helper function
async function registerWebhooksForShop(shopDomain, accessToken) {
  const shopify = getShopifyConfig();
  const session = await createShopifySession(shopDomain, accessToken);
  
  const webhookTopics = [
    'orders/create',
    'orders/updated', 
    'orders/cancelled',
    'fulfillments/create',
    'fulfillments/updated',
    'returns/create'
  ];

  const webhookPath = '/api/webhooks/shopify';
  const webhookUrl = `${process.env.HOST_URL}${webhookPath}`;

  for (const topic of webhookTopics) {
    try {
      const webhook = new shopify.rest.Webhook({ session });
      webhook.topic = topic;
      webhook.address = webhookUrl;
      webhook.format = 'json';
      
      await webhook.save({
        session
      });
      
      logger.info(`Webhook registered: ${topic} for ${shopDomain}`);
    } catch (error) {
      // Webhook might already exist, which is fine
      if (error.response?.body?.errors?.includes('has already been taken')) {
        logger.info(`Webhook already exists: ${topic} for ${shopDomain}`);
      } else {
        throw error;
      }
    }
  }
}

module.exports = { router, verifyToken };
