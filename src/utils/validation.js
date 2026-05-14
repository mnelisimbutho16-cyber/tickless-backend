const Joi = require('joi');

// Common validation schemas
const schemas = {
  shopDomain: Joi.string().pattern(/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/).required(),
  
  orderId: Joi.uuid().required(),
  
  email: Joi.string().email().required(),
  
  trackingNumber: Joi.string().min(5).max(50).required(),
  
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  })
};

// Webhook validation
const validateWebhook = (req, res, next) => {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    topic: Joi.string().required(),
    shop_domain: schemas.shopDomain
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid webhook payload',
      details: error.details[0].message
    });
  }
  next();
};

// Order validation
const validateOrder = (req, res, next) => {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    email: schemas.email,
    total_price: Joi.number().positive().required(),
    currency: Joi.string().length(3).required(),
    financial_status: Joi.string().required(),
    fulfillment_status: Joi.string().allow(null),
    line_items: Joi.array().items(
      Joi.object({
        id: Joi.number().integer().required(),
        title: Joi.string().required(),
        quantity: Joi.number().integer().positive().required(),
        price: Joi.number().positive().required()
      })
    ).required()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid order payload',
      details: error.details[0].message
    });
  }
  next();
};

// Fulfillment validation
const validateFulfillment = (req, res, next) => {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    order_id: Joi.number().integer().required(),
    status: Joi.string().required(),
    tracking_number: Joi.string().allow(null),
    tracking_company: Joi.string().allow(null),
    line_items: Joi.array().items(
      Joi.object({
        id: Joi.number().integer().required(),
        quantity: Joi.number().integer().positive().required()
      })
    ).required()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid fulfillment payload',
      details: error.details[0].message
    });
  }
  next();
};

// Return validation
const validateReturn = (req, res, next) => {
  const schema = Joi.object({
    id: Joi.number().integer().required(),
    order_id: Joi.number().integer().required(),
    customer_email: schemas.email,
    return_status: Joi.string().required(),
    total_amount: Joi.number().min(0).required(),
    return_line_items: Joi.array().items(
      Joi.object({
        line_item_id: Joi.number().integer().required(),
        quantity: Joi.number().integer().positive().required(),
        return_reason: Joi.string().required()
      })
    ).required()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid return payload',
      details: error.details[0].message
    });
  }
  next();
};

// Query parameter validation
const validatePagination = (req, res, next) => {
  const { error, value } = schemas.pagination.validate(req.query);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid pagination parameters',
      details: error.details[0].message
    });
  }
  req.query = { ...req.query, ...value };
  next();
};

// Sanitize input
const sanitizeInput = (req, res, next) => {
  // Remove potentially harmful characters
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
             .replace(/javascript:/gi, '')
             .replace(/on\w+\s*=/gi, '');
  };

  const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    const sanitized = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = typeof obj[key] === 'string' 
          ? sanitizeString(obj[key])
          : typeof obj[key] === 'object'
          ? sanitizeObject(obj[key])
          : obj[key];
      }
    }
    return sanitized;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

module.exports = {
  schemas,
  validateWebhook,
  validateOrder,
  validateFulfillment,
  validateReturn,
  validatePagination,
  sanitizeInput
};
