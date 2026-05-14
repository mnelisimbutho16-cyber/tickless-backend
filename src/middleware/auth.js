const jwt = require('jsonwebtoken');
const { getShopByDomain } = require('../config/supabase');
const logger = require('../utils/logger');

// JWT verification middleware
const verifyJWT = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.query.token ||
                  req.cookies.token;

    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'No token provided' 
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get shop information
    const shop = await getShopByDomain(decoded.shopDomain);
    if (!shop) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Shop not found or inactive' 
      });
    }

    // Attach shop and user info to request
    req.shop = shop;
    req.user = decoded;
    
    // Set shop context for database operations
    const supabase = require('../config/supabase').getSupabaseClient();
    await supabase.rpc('set_shop_context', { shop_domain: shop.domain });

    next();
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Invalid token' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Token expired' 
      });
    }
    
    logger.error('JWT verification error:', error);
    return res.status(500).json({ 
      error: 'Authentication error',
      message: 'Failed to verify authentication' 
    });
  }
};

// Shopify webhook verification middleware
const verifyShopifyWebhook = (req, res, next) => {
  try {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];
    
    if (!hmac || !topic || !shop) {
      return res.status(400).json({ 
        error: 'Invalid webhook',
        message: 'Missing required webhook headers' 
      });
    }

    // Verify HMAC signature
    const crypto = require('crypto');
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    
    const calculatedHmac = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('base64');
      
    const isValid = crypto.timingSafeEqual(
      Buffer.from(calculatedHmac),
      Buffer.from(hmac)
    );
    
    if (!isValid) {
      logger.warn(`Invalid webhook HMAC for shop: ${shop}, topic: ${topic}`);
      return res.status(401).json({ 
        error: 'Invalid webhook',
        message: 'Webhook signature verification failed' 
      });
    }

    req.webhookInfo = { topic, shop };
    next();
    
  } catch (error) {
    logger.error('Webhook verification error:', error);
    return res.status(500).json({ 
      error: 'Webhook verification failed',
      message: 'Failed to verify webhook signature' 
    });
  }
};

// Optional authentication middleware
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.query.token ||
                  req.cookies.token;

    if (token) {
      // Try to verify token if present
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const shop = await getShopByDomain(decoded.shopDomain);
      
      if (shop) {
        req.shop = shop;
        req.user = decoded;
        
        // Set shop context for database operations
        const supabase = require('../config/supabase').getSupabaseClient();
        await supabase.rpc('set_shop_context', { shop_domain: shop.domain });
      }
    }
    
    next();
    
  } catch (error) {
    // Don't fail the request if optional auth fails
    logger.debug('Optional authentication failed:', error.message);
    next();
  }
};

// Shop ownership verification
const verifyShopOwnership = async (req, res, next) => {
  try {
    const shopDomain = req.params.shopDomain || req.query.shop;
    
    if (!shopDomain) {
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'Shop domain required' 
      });
    }

    // Verify user has access to this shop
    if (req.user?.shopDomain !== shopDomain) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have access to this shop' 
      });
    }

    next();
    
  } catch (error) {
    logger.error('Shop ownership verification error:', error);
    return res.status(500).json({ 
      error: 'Authorization error',
      message: 'Failed to verify shop ownership' 
    });
  }
};

// API key authentication (for external services)
const verifyApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    
    if (!apiKey) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'API key required' 
      });
    }

    // Verify API key (in production, store hashed keys in database)
    const validApiKeys = [
      process.env.CARRIER_API_KEY,
      process.env.EMAIL_SERVICE_API_KEY
    ];
    
    if (!validApiKeys.includes(apiKey)) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Invalid API key' 
      });
    }

    req.apiKey = apiKey;
    next();
    
  } catch (error) {
    logger.error('API key verification error:', error);
    return res.status(500).json({ 
      error: 'Authentication error',
      message: 'Failed to verify API key' 
    });
  }
};

// Scope verification middleware
const verifyScopes = (requiredScopes) => {
  return (req, res, next) => {
    try {
      const userScopes = req.user?.scopes || [];
      
      const hasRequiredScopes = requiredScopes.every(scope => 
        userScopes.includes(scope)
      );
      
      if (!hasRequiredScopes) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          message: 'Required scopes not satisfied',
          required: requiredScopes,
          provided: userScopes
        });
      }
      
      next();
      
    } catch (error) {
      logger.error('Scope verification error:', error);
      return res.status(500).json({ 
        error: 'Authorization error',
        message: 'Failed to verify scopes' 
      });
    }
  };
};

// Generate JWT token
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { 
    expiresIn: '30d',
    issuer: 'shopify-post-purchase-backend',
    audience: 'shopify-app'
  });
};

// Refresh token
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'Refresh token required' 
      });
    }

    // Verify refresh token (in production, use separate refresh tokens)
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    // Generate new access token
    const newToken = generateToken({
      shopDomain: decoded.shopDomain,
      shopId: decoded.shopId,
      scopes: decoded.scopes
    });

    res.json({ token: newToken });
    
  } catch (error) {
    logger.error('Token refresh error:', error);
    return res.status(401).json({ 
      error: 'Token refresh failed',
      message: 'Invalid refresh token' 
    });
  }
};

module.exports = {
  verifyJWT,
  verifyShopifyWebhook,
  optionalAuth,
  verifyShopOwnership,
  verifyApiKey,
  verifyScopes,
  generateToken,
  refreshToken
};
