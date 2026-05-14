const express = require('express');
const { verifyToken } = require('./auth');
const { triggerUpsellEngine } = require('../services/upsellEngine');
const { triggerTrackingEngine, pollTrackingUpdates } = require('../services/trackingEngine');
const { processReturnEvent } = require('../services/returnEngine');
const { processUnprocessedEvents, cleanupOldEvents } = require('../services/webhookProcessor');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication middleware
router.use(verifyToken);

// Manually trigger upsell engine for an order
router.post('/upsell/trigger/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const shop = req.shop;

    // Get order details
    const supabase = require('../config/supabase').getSupabaseClient();
    await supabase.rpc('set_shop_context', { shop_domain: shop.domain });

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Trigger upsell engine
    const upsell = await triggerUpsellEngine(orderId, order.raw_data, shop);

    res.json({
      message: 'Upsell engine triggered successfully',
      upsell
    });

  } catch (error) {
    logger.error('Failed to trigger upsell engine:', error);
    res.status(500).json({ error: 'Failed to trigger upsell engine' });
  }
});

// Manually trigger tracking engine for an order
router.post('/tracking/trigger/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const shop = req.shop;

    // Get order details
    const supabase = require('../config/supabase').getSupabaseClient();
    await supabase.rpc('set_shop_context', { shop_domain: shop.domain });

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Trigger tracking engine
    await triggerTrackingEngine(orderId, order.raw_data, shop);

    res.json({
      message: 'Tracking engine triggered successfully'
    });

  } catch (error) {
    logger.error('Failed to trigger tracking engine:', error);
    res.status(500).json({ error: 'Failed to trigger tracking engine' });
  }
});

// Force tracking poll (for debugging)
router.post('/tracking/poll', async (req, res) => {
  try {
    await pollTrackingUpdates();
    
    res.json({
      message: 'Tracking poll completed successfully'
    });

  } catch (error) {
    logger.error('Failed to poll tracking updates:', error);
    res.status(500).json({ error: 'Failed to poll tracking updates' });
  }
});

// Process unprocessed webhook events
router.post('/webhooks/process', async (req, res) => {
  try {
    await processUnprocessedEvents();
    
    res.json({
      message: 'Unprocessed webhook events processed successfully'
    });

  } catch (error) {
    logger.error('Failed to process unprocessed events:', error);
    res.status(500).json({ error: 'Failed to process unprocessed events' });
  }
});

// Cleanup old events
router.post('/cleanup', async (req, res) => {
  try {
    await cleanupOldEvents();
    
    res.json({
      message: 'Old events cleaned up successfully'
    });

  } catch (error) {
    logger.error('Failed to cleanup old events:', error);
    res.status(500).json({ error: 'Failed to cleanup old events' });
  }
});

// Get engine status
router.get('/status', async (req, res) => {
  try {
    const supabase = require('../config/supabase').getSupabaseClient();
    const shop = req.shop;

    await supabase.rpc('set_shop_context', { shop_domain: shop.domain });

    // Get engine statistics
    const [
      webhookStats,
      trackingStats,
      upsellStats,
      returnStats
    ] = await Promise.all([
      // Webhook events
      supabase
        .from('webhook_events')
        .select('processed, event_type')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),

      // Tracking queue
      supabase
        .from('tracking_queue')
        .select('status, next_check'),

      // Upsells
      supabase
        .from('upsells')
        .select('status, accepted')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),

      // Returns
      supabase
        .from('returns')
        .select('return_status')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    ]);

    const processedWebhooks = webhookStats.data?.filter(w => w.processed).length || 0;
    const unprocessedWebhooks = webhookStats.data?.filter(w => !w.processed).length || 0;
    
    const activeTracking = trackingStats.data?.filter(t => t.status === 'queued').length || 0;
    const overdueTracking = trackingStats.data?.filter(t => 
      t.status === 'queued' && new Date(t.next_check) < new Date()
    ).length || 0;

    const activeUpsells = upsellStats.data?.filter(u => u.status === 'pending').length || 0;
    const acceptedUpsells = upsellStats.data?.filter(u => u.accepted).length || 0;

    const pendingReturns = returnStats.data?.filter(r => r.return_status === 'pending').length || 0;

    res.json({
      engines: {
        webhooks: {
          processed: processedWebhooks,
          unprocessed: unprocessedWebhooks,
          total: processedWebhooks + unprocessedWebhooks
        },
        tracking: {
          active: activeTracking,
          overdue: overdueTracking
        },
        upsells: {
          active: activeUpsells,
          accepted: acceptedUpsells,
          conversionRate: upsellStats.data?.length > 0 
            ? (acceptedUpsells / upsellStats.data.length * 100).toFixed(1)
            : 0
        },
        returns: {
          pending: pendingReturns
        }
      },
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get engine status:', error);
    res.status(500).json({ error: 'Failed to get engine status' });
  }
});

// Get engine configuration
router.get('/config', async (req, res) => {
  try {
    // Return current engine configuration
    res.json({
      configuration: {
        tracking: {
          pollInterval: '30 minutes',
          carriers: ['UPS', 'FedEx', 'USPS'],
          retryAttempts: 3
        },
        upsells: {
          aiModel: 'GPT-4o',
          discountRange: '10-25%',
          expirationDays: 7
        },
        returns: {
          creditPercentage: 10,
          creditExpirationDays: 30,
          qrCodeEnabled: true
        },
        webhooks: {
          retryAttempts: 3,
          cleanupDays: 30
        }
      }
    });

  } catch (error) {
    logger.error('Failed to get engine configuration:', error);
    res.status(500).json({ error: 'Failed to get engine configuration' });
  }
});

module.exports = router;
