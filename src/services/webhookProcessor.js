const logger = require('../utils/logger');
const { getSupabaseAdminClient } = require('../config/supabase');

// Import engine processors
const { processOrderEvent }       = require('./orderEngine');
const { processFulfillmentEvent } = require('./fulfillmentEngine');
const { processReturnEvent }      = require('./returnEngine');
const { orchestrateFlow }         = require('./flowEngine'); // ← THE BRAIN

async function processWebhookEvent(eventId, topic, payload, shopRecord) {
  const supabase = getSupabaseAdminClient();
  let processingError = null;

  try {
    logger.info(`Processing webhook event ${eventId}: ${topic} for ${shopRecord.domain}`);

    // ── Route to engine + trigger flow orchestration ──────────────────────────
    switch (topic) {

      case 'orders/create':
      case 'orders/updated':
      case 'orders/cancelled':
        await processOrderEvent(topic, payload, shopRecord);
        await orchestrateFlow('order', topic, payload, shopRecord);
        break;

      case 'fulfillments/create':
      case 'fulfillments/updated':
        await processFulfillmentEvent(topic, payload, shopRecord);
        await orchestrateFlow('fulfillment', topic, payload, shopRecord);
        break;

      case 'returns/create':
      case 'returns/update':   // fires when return is approved/resolved
        await processReturnEvent(topic, payload, shopRecord);
        await orchestrateFlow('return', topic, payload, shopRecord); // pauses promos immediately
        break;

      case 'refunds/create':
        // Refund is the final step — queue win-back sequence
        await orchestrateFlow('refund', topic, payload, shopRecord);
        break;

      case 'app/uninstalled':
        await supabase
          .from('shops')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('domain', shopRecord.domain);
        logger.info(`Shop uninstalled: ${shopRecord.domain}`);
        break;

      default:
        logger.warn(`Unhandled webhook topic: ${topic}`);
        return;
    }

    // ── Mark event as successfully processed ──────────────────────────────────
    await supabase
      .from('webhook_events')
      .update({
        processed:    true,
        processed_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .eq('id', eventId);

    logger.info(`Successfully processed webhook event ${eventId}`);

  } catch (error) {
    processingError = error;
    logger.error(`Failed to process webhook event ${eventId}:`, error);

    // ── Increment retry_count so broken events don't loop forever ─────────────
    const { data: current } = await supabase
      .from('webhook_events')
      .select('retry_count')
      .eq('id', eventId)
      .single();

    await supabase
      .from('webhook_events')
      .update({
        processed:   false,
        error:       error.message,
        retry_count: (current?.retry_count ?? 0) + 1,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', eventId);
  }

  return { success: !processingError, error: processingError };
}

// ── Retry unprocessed events (called by cron job) ─────────────────────────────
async function processUnprocessedEvents() {
  const supabase = getSupabaseAdminClient();

  try {
    const { data: events, error } = await supabase
      .from('webhook_events')
      .select('*')
      .eq('processed', false)
      .lt('retry_count', 3)           // max 3 attempts
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw error;
    if (!events || events.length === 0) {
      logger.debug('No unprocessed webhook events found');
      return;
    }

    logger.info(`Retrying ${events.length} unprocessed webhook events`);

    for (const event of events) {
      const { data: shop } = await supabase
        .from('shops')
        .select('*')
        .eq('domain', event.shop_domain)
        .eq('is_active', true)
        .single();

      if (!shop) {
        logger.warn(`Shop not found for event ${event.id}: ${event.shop_domain}`);
        continue;
      }

      await processWebhookEvent(event.id, event.event_type, event.payload, shop);
    }

  } catch (error) {
    logger.error('Failed to process unprocessed events:', error);
  }
}

// ── Clean up events older than 30 days ────────────────────────────────────────
async function cleanupOldEvents() {
  const supabase = getSupabaseAdminClient();

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { error } = await supabase
      .from('webhook_events')
      .delete()
      .lt('created_at', thirtyDaysAgo.toISOString());

    if (error) throw error;
    logger.info('Cleaned up old webhook events');

  } catch (error) {
    logger.error('Failed to cleanup old events:', error);
  }
}

module.exports = {
  processWebhookEvent,
  processUnprocessedEvents,
  cleanupOldEvents,
};
