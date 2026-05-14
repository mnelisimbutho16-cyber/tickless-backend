const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Redis client for distributed rate limiting (optional)
let redisClient = null;

try {
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    logger.info('Redis client initialized for distributed rate limiting');
  }
} catch (error) {
  logger.warn('Redis not available, using memory-based rate limiting');
}

// General API rate limiting
const createApiLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: redisClient ? new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
    }) : undefined
  };

  return rateLimit({ ...defaultOptions, ...options });
};

// Strict rate limiting for sensitive endpoints
const createStrictLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Only 10 requests per windowMs
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded for this endpoint. Please try again later.',
      retryAfter: '15 minutes'
    },
    skipSuccessfulRequests: false
  };

  return createApiLimiter({ ...defaultOptions, ...options });
};

// Webhook rate limiting (per shop)
const createWebhookLimiter = () => {
  return rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // Allow many webhooks (they're important)
    keyGenerator: (req) => {
      // Rate limit per shop domain
      return req.headers['x-shopify-shop-domain'] || req.ip;
    },
    message: {
      error: 'Webhook rate limit exceeded',
      message: 'Too many webhook requests from this shop'
    },
    skip: (req) => {
      // Don't limit health checks or test webhooks
      return req.path.includes('/test') || req.path.includes('/health');
    }
  });
};

// Authentication rate limiting
const createAuthLimiter = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 auth attempts per windowMs
    message: {
      error: 'Too many authentication attempts',
      message: 'Please wait before trying again.',
      retryAfter: '15 minutes'
    },
    skipSuccessfulRequests: true // Don't count successful auth attempts
  });
};

// Dashboard rate limiting (per authenticated user)
const createDashboardLimiter = () => {
  return rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per user
    keyGenerator: (req) => {
      // Rate limit per user/shop
      return req.shop?.domain || req.ip;
    },
    message: {
      error: 'Dashboard rate limit exceeded',
      message: 'Too many dashboard requests. Please wait before refreshing.',
      retryAfter: '1 minute'
    }
  });
};

// Engine trigger rate limiting (to prevent abuse)
const createEngineLimiter = () => {
  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 engine triggers per 5 minutes
    keyGenerator: (req) => {
      return req.shop?.domain || req.ip;
    },
    message: {
      error: 'Engine trigger rate limit exceeded',
      message: 'Too many manual engine triggers. Please wait before trying again.',
      retryAfter: '5 minutes'
    }
  });
};

// Custom middleware for dynamic rate limiting based on shop tier
const createDynamicLimiter = (getLimit) => {
  return async (req, res, next) => {
    try {
      // Get shop-specific limit (could be based on subscription tier)
      const limit = await getLimit(req.shop?.domain);
      
      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: limit,
        keyGenerator: () => req.shop?.domain || req.ip,
        message: {
          error: 'Rate limit exceeded',
          message: `Rate limit of ${limit} requests per 15 minutes exceeded.`,
          retryAfter: '15 minutes'
        }
      });
      
      return limiter(req, res, next);
    } catch (error) {
      logger.error('Dynamic rate limiting error:', error);
      // Fallback to default limiting
      return createApiLimiter()(req, res, next);
    }
  };
};

// Rate limiting middleware that logs violations
const rateLimitLogger = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    if (res.statusCode === 429) {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        shop: req.headers['x-shopify-shop-domain'],
        rateLimitInfo: res.get('X-RateLimit-Limit')
      });
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

// Get rate limit status for monitoring
const getRateLimitStatus = (req) => {
  return {
    limit: req.rateLimit?.limit,
    current: req.rateLimit?.current,
    remaining: req.rateLimit?.remaining,
    resetTime: req.rateLimit?.resetTime
  };
};

module.exports = {
  createApiLimiter,
  createStrictLimiter,
  createWebhookLimiter,
  createAuthLimiter,
  createDashboardLimiter,
  createEngineLimiter,
  createDynamicLimiter,
  rateLimitLogger,
  getRateLimitStatus
};
