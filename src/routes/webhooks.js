const express = require('express');
const crypto = require('crypto');
const { verifyWebhookHMAC } = require('../config/shopify');
const { saveWebhookEvent, getShopByDomain } = require('../config/supabase');
const { processWebhookEvent } = require('../services/webhookProcessor');
const logger = require('../utils/logger');

const router = express.Router();

// Webhook verification middleware
const verifyWebhook = (req, res, next) => {
  try {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];
    
    if (!hmac || !topic || !shop) {
      return res.status(400).json({ error: 'Missing required webhook headers' });
    }

    // Verify HMAC
    const body = JSON.stringify(req.body);
    const isValid = verifyWebhookHMAC(body, hmac);
    
    if (!isValid) {
      logger.warn(`Invalid webhook HMAC for shop: ${shop}, topic: ${topic}`);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    req.webhookInfo = { topic, shop };
    next();
    
  } catch (error) {
    logger.error('Webhook verification failed:', error);
    res.status(500).json({ error: 'Webhook verification failed' });
  }
};

// Main webhook endpoint for all Shopify webhooks
router.post('/shopify', verifyWebhook, async (req, res) => {
  const startTime = Date.now();
  const { topic, shop } = req.webhookInfo;
  
  try {
    logger.info(`Webhook received: ${topic} from ${shop}`);
    
    // Verify shop exists and is active
    const shopRecord = await getShopByDomain(shop);
    if (!shopRecord) {
      logger.warn(`Webhook from inactive/non-existent shop: ${shop}`);
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Save webhook event to database
    const webhookEvent = await saveWebhookEvent(shop, topic, req.body);
    
    // Process the event asynchronously
    setImmediate(async () => {
      try {
        await processWebhookEvent(webhookEvent.id, topic, req.body, shopRecord);
      } catch (error) {
        logger.error(`Failed to process webhook event ${webhookEvent.id}:`, error);
      }
    });

    // Respond immediately to Shopify (must be within 5 seconds)
    const processingTime = Date.now() - startTime;
    logger.info(`Webhook ${topic} processed in ${processingTime}ms for ${shop}`);
    
    res.status(200).json({ 
      status: 'received',
      eventId: webhookEvent.id
    });
    
  } catch (error) {
    logger.error(`Webhook processing failed for ${topic} from ${shop}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Webhook status check endpoint
router.get('/status/:shopDomain', async (req, res) => {
  try {
    const { shopDomain } = req.params;
    const shop = await getShopByDomain(shopDomain);
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Get recent webhook events
    const supabase = require('../config/supabase').getSupabaseClient();
    const { data: events, error } = await supabase
      .from('webhook_events')
      .select('*')
      .eq('shop_domain', shopDomain)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw error;
    }

    res.json({
      shop: shopDomain,
      isActive: shop.is_active,
      recentEvents: events || [],
      webhookCount: events?.length || 0
    });
    
  } catch (error) {
    logger.error('Webhook status check failed:', error);
    res.status(500).json({ error: 'Failed to get webhook status' });
  }
});

// Retry failed webhook events
router.post('/retry/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    const supabase = require('../config/supabase').getSupabaseAdminClient();
    
    // Get the webhook event
    const { data: event, error } = await supabase
      .from('webhook_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error || !event) {
      return res.status(404).json({ error: 'Webhook event not found' });
    }

    // Get shop record
    const shop = await getShopByDomain(event.shop_domain);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Reset processed status and retry
    await supabase
      .from('webhook_events')
      .update({ 
        processed: false, 
        error: null,
        retry_count: (event.retry_count || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', eventId);

    // Process the event
    await processWebhookEvent(eventId, event.event_type, event.payload, shop);

    res.json({ 
      message: 'Webhook event retried successfully',
      eventId
    });
    
  } catch (error) {
    logger.error('Webhook retry failed:', error);
    res.status(500).json({ error: 'Failed to retry webhook event' });
  }
});

// Test webhook endpoint for development
router.post('/test', (req, res) => {
  const testPayload = {
    id: 123456789,
    email: "customer@example.com",
    created_at: new Date().toISOString(),
    total_price: "100.00",
    currency: "USD",
    financial_status: "paid",
    fulfillment_status: null,
    line_items: [
      {
        id: 987654321,
        title: "Test Product",
        quantity: 1,
        price: "100.00"
      }
    ]
  };

  logger.info('Test webhook received');
  res.json({ 
    message: 'Test webhook received',
    payload: testPayload
  });
});

module.exports = router;
