const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Generate secure random token
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate UUID
const generateUUID = () => {
  return uuidv4();
};

// Format currency
const formatCurrency = (amount, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount);
};

// Format date
const formatDate = (date, options = {}) => {
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  return new Date(date).toLocaleDateString('en-US', { ...defaultOptions, ...options });
};

// Calculate percentage
const calculatePercentage = (part, total) => {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
};

// Retry function with exponential backoff
const retry = async (fn, maxAttempts = 3, baseDelay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Parse shop domain from various formats
const parseShopDomain = (shop) => {
  if (!shop) return null;
  
  // Remove protocol if present
  shop = shop.replace(/^https?:\/\//, '');
  
  // Remove trailing slash
  shop = shop.replace(/\/$/, '');
  
  // Ensure .myshopify.com suffix
  if (!shop.endsWith('.myshopify.com')) {
    shop += '.myshopify.com';
  }
  
  return shop.toLowerCase();
};

// Validate Shopify shop domain
const isValidShopDomain = (domain) => {
  const regex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  return regex.test(domain);
};

// Extract order number from Shopify order name
const extractOrderNumber = (orderName) => {
  if (!orderName) return null;
  
  // Handle formats like "#1001" or "1001"
  const match = orderName.match(/#?(\d+)/);
  return match ? parseInt(match[1]) : null;
};

// Calculate estimated delivery date
const calculateEstimatedDelivery = (carrier, serviceLevel, origin, destination) => {
  // Simplified estimation - in production, use carrier APIs
  const baseDays = {
    'UPS Ground': 3,
    'UPS 2nd Day Air': 2,
    'UPS Next Day Air': 1,
    'FedEx Ground': 3,
    'FedEx 2Day': 2,
    'FedEx Overnight': 1,
    'USPS Priority': 2,
    'USPS First-Class': 3,
    'USPS Ground': 4
  };
  
  const days = baseDays[serviceLevel] || 3;
  const estimatedDate = new Date();
  estimatedDate.setDate(estimatedDate.getDate() + days);
  
  return estimatedDate.toISOString();
};

// Determine if tracking update requires notification
const shouldNotifyTrackingUpdate = (previousStatus, newStatus) => {
  const notifyStatuses = [
    'out_for_delivery',
    'delivered',
    'delayed',
    'exception',
    'delivery_attempted'
  ];
  
  return notifyStatuses.some(status => 
    newStatus.toLowerCase().includes(status) && 
    !previousStatus.toLowerCase().includes(status)
  );
};

// Generate shop-specific cache key
const generateCacheKey = (shopDomain, key) => {
  return `${shopDomain}:${key}`;
};

// Sanitize phone number
const sanitizePhone = (phone) => {
  if (!phone) return null;
  
  // Remove all non-digit characters
  return phone.replace(/\D/g, '');
};

// Validate email format
const isValidEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// Calculate order value for upsell targeting
const calculateOrderValue = (order) => {
  if (!order || !order.line_items) return 0;
  
  return order.line_items.reduce((total, item) => {
    return total + ((item.price || 0) * (item.quantity || 0));
  }, 0);
};

// Determine customer segment based on order history
const determineCustomerSegment = (orderHistory) => {
  if (!orderHistory || orderHistory.length === 0) return 'new';
  
  const totalOrders = orderHistory.length;
  const totalValue = orderHistory.reduce((sum, order) => sum + (order.total_price || 0), 0);
  const avgOrderValue = totalValue / totalOrders;
  
  if (totalOrders >= 10 && totalValue >= 1000) return 'vip';
  if (totalOrders >= 5) return 'loyal';
  if (totalValue >= 500) return 'high_value';
  if (totalOrders >= 2) return 'returning';
  
  return 'new';
};

// Generate upsell offer expiration
const generateUpsellExpiration = (hours = 168) => { // 7 days default
  const expiration = new Date();
  expiration.setHours(expiration.getHours() + hours);
  return expiration.toISOString();
};

// Check if upsell is still valid
const isUpsellValid = (upsell) => {
  if (!upsell || !upsell.expires_at) return false;
  
  return new Date(upsell.expires_at) > new Date();
};

// Calculate return window (days since order)
const calculateReturnWindow = (orderDate, returnWindowDays = 30) => {
  const order = new Date(orderDate);
  const now = new Date();
  const diffTime = Math.abs(now - order);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return {
    daysSinceOrder: diffDays,
    isEligible: diffDays <= returnWindowDays,
    daysRemaining: Math.max(0, returnWindowDays - diffDays)
  };
};

// Format tracking status for display
const formatTrackingStatus = (status) => {
  const statusMap = {
    'in_transit': 'In Transit',
    'out_for_delivery': 'Out for Delivery',
    'delivered': 'Delivered',
    'delayed': 'Delayed',
    'exception': 'Delivery Exception',
    'unknown': 'Unknown'
  };
  
  return statusMap[status?.toLowerCase()] || 'Unknown';
};

// Calculate shipping cost estimate
const estimateShippingCost = (weight, dimensions, carrier, service) => {
  // Simplified estimation - in production, use carrier APIs
  const baseRates = {
    'UPS Ground': 8.50,
    'FedEx Ground': 9.00,
    'USPS Priority': 7.50
  };
  
  const baseRate = baseRates[`${carrier} ${service}`] || 8.00;
  const weightSurcharge = Math.max(0, (weight - 1) * 0.50); // $0.50 per lb over 1lb
  
  return baseRate + weightSurcharge;
};

// Generate order summary
const generateOrderSummary = (order) => {
  if (!order) return null;
  
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerEmail: order.customer_email,
    totalPrice: order.total_price,
    currency: order.currency,
    status: order.financial_status,
    fulfillmentStatus: order.fulfillment_status,
    itemCount: order.line_items?.length || 0,
    createdAt: order.created_at,
    estimatedDelivery: order.estimated_delivery
  };
};

module.exports = {
  generateToken,
  generateUUID,
  formatCurrency,
  formatDate,
  calculatePercentage,
  retry,
  parseShopDomain,
  isValidShopDomain,
  extractOrderNumber,
  calculateEstimatedDelivery,
  shouldNotifyTrackingUpdate,
  generateCacheKey,
  sanitizePhone,
  isValidEmail,
  calculateOrderValue,
  determineCustomerSegment,
  generateUpsellExpiration,
  isUpsellValid,
  calculateReturnWindow,
  formatTrackingStatus,
  estimateShippingCost,
  generateOrderSummary
};
