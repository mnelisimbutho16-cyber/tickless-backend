const logger = require('../utils/logger');
const { getSupabaseAdminClient } = require('../config/supabase');
const { triggerTrackingEngine } = require('./trackingEngine');

async function processFulfillmentEvent(topic, payload, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  try {
    const fulfillment = payload;
    
    logger.info(`Processing fulfillment event: ${topic} for fulfillment ${fulfillment.id} in shop ${shopRecord.domain}`);

    // Save fulfillment to database
    const fulfillmentData = {
      shop_domain: shopRecord.domain,
      shopify_fulfillment_id: fulfillment.id,
      order_id: fulfillment.order_id,
      status: fulfillment.status,
      tracking_company: fulfillment.tracking_company,
      tracking_number: fulfillment.tracking_number,
      tracking_numbers: fulfillment.tracking_numbers || [],
      tracking_urls: fulfillment.tracking_urls || [],
      created_at: fulfillment.created_at,
      updated_at: fulfillment.updated_at,
      raw_data: fulfillment
    };

    const { data: savedFulfillment, error: saveError } = await supabase
      .from('fulfillments')
      .upsert(fulfillmentData, { 
        onConflict: 'shop_domain,shopify_fulfillment_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (saveError) throw saveError;

    // Process fulfillment line items
    if (fulfillment.line_items && fulfillment.line_items.length > 0) {
      await processFulfillmentLineItems(fulfillment.line_items, savedFulfillment.id);
    }

    // Handle different fulfillment events
    switch (topic) {
      case 'fulfillments/create':
        await handleFulfillmentCreate(savedFulfillment, fulfillment, shopRecord);
        break;
      
      case 'fulfillments/updated':
        await handleFulfillmentUpdate(savedFulfillment, fulfillment, shopRecord);
        break;
    }

    logger.info(`Successfully processed fulfillment event: ${topic} for fulfillment ${fulfillment.id}`);

  } catch (error) {
    logger.error(`Failed to process fulfillment event ${topic}:`, error);
    throw error;
  }
}

async function processFulfillmentLineItems(lineItems, fulfillmentId) {
  const supabase = getSupabaseAdminClient();
  
  // Clear existing fulfillment line items
  await supabase
    .from('fulfillment_line_items')
    .delete()
    .eq('fulfillment_id', fulfillmentId);

  // Insert new line items
  const lineItemsData = lineItems.map(item => ({
    fulfillment_id: fulfillmentId,
    shopify_line_item_id: item.id,
    quantity: item.quantity,
    raw_data: item
  }));

  const { error } = await supabase
    .from('fulfillment_line_items')
    .insert(lineItemsData);

  if (error) throw error;
}

async function handleFulfillmentCreate(fulfillment, shopifyFulfillment, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  // Update customer journey stage
  await supabase
    .from('customer_journeys')
    .update({
      current_stage: 'shipped',
      stages_completed: ['order_placed', 'order_fulfilled', 'shipped'],
      updated_at: new Date().toISOString()
    })
    .eq('order_id', fulfillment.order_id);

  // Create tracking record
  if (fulfillment.tracking_number) {
    const trackingData = {
      shop_domain: shopRecord.domain,
      order_id: fulfillment.order_id,
      fulfillment_id: fulfillment.id,
      tracking_number: fulfillment.tracking_number,
      carrier: fulfillment.tracking_company || 'Unknown',
      status: 'in_transit',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await supabase
      .from('tracking_info')
      .insert(trackingData);
  }

  // Trigger tracking engine to start monitoring
  setImmediate(() => {
    triggerTrackingEngine(fulfillment.order_id, null, shopRecord, fulfillment);
  });

  logger.info(`Fulfillment creation processed for fulfillment ${fulfillment.shopify_fulfillment_id}`);
}

async function handleFulfillmentUpdate(fulfillment, shopifyFulfillment, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  // Update tracking info if tracking details changed
  if (fulfillment.tracking_number) {
    await supabase
      .from('tracking_info')
      .update({
        tracking_number: fulfillment.tracking_number,
        carrier: fulfillment.tracking_company || 'Unknown',
        updated_at: new Date().toISOString()
      })
      .eq('fulfillment_id', fulfillment.id);
  }

  // Update journey stage based on fulfillment status
  let journeyStage = 'shipped';
  if (fulfillment.status === 'success') {
    journeyStage = 'delivered';
  } else if (fulfillment.status === 'cancelled') {
    journeyStage = 'fulfilment_cancelled';
  }

  await supabase
    .from('customer_journeys')
    .update({
      current_stage: journeyStage,
      updated_at: new Date().toISOString()
    })
    .eq('order_id', fulfillment.order_id);

  logger.info(`Fulfillment update processed for fulfillment ${fulfillment.shopify_fulfillment_id}`);
}

module.exports = {
  processFulfillmentEvent
};
