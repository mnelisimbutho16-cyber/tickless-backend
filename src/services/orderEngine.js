const logger = require('../utils/logger');
const { getSupabaseAdminClient } = require('../config/supabase');
const { triggerUpsellEngine } = require('./upsellEngine');
const { triggerTrackingEngine } = require('./trackingEngine');

async function processOrderEvent(topic, payload, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  try {
    const order = payload;
    
    logger.info(`Processing order event: ${topic} for order ${order.id} in shop ${shopRecord.domain}`);

    // Save order to database
    const orderData = {
      shop_domain: shopRecord.domain,
      shopify_order_id: order.id,
      order_number: order.order_number || order.name,
      customer_email: order.email,
      customer_phone: order.phone,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      total_price: parseFloat(order.total_price) || 0,
      currency: order.currency,
      created_at: order.created_at,
      updated_at: order.updated_at,
      cancelled_at: order.cancelled_at || null,
      cancel_reason: order.cancel_reason || null,
      raw_data: order
    };

    const { data: savedOrder, error: saveError } = await supabase
      .from('orders')
      .upsert(orderData, { 
        onConflict: 'shop_domain,shopify_order_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (saveError) throw saveError;

    // Process order line items
    if (order.line_items && order.line_items.length > 0) {
      await processLineItems(order.line_items, savedOrder.id, shopRecord.domain);
    }

    // Handle different order events
    switch (topic) {
      case 'orders/create':
        await handleOrderCreate(savedOrder, order, shopRecord);
        break;
      
      case 'orders/updated':
        await handleOrderUpdate(savedOrder, order, shopRecord);
        break;
      
      case 'orders/cancelled':
        await handleOrderCancel(savedOrder, order, shopRecord);
        break;
    }

    logger.info(`Successfully processed order event: ${topic} for order ${order.id}`);

  } catch (error) {
    logger.error(`Failed to process order event ${topic}:`, error);
    throw error;
  }
}

async function processLineItems(lineItems, orderId, shopDomain) {
  const supabase = getSupabaseAdminClient();
  
  // Clear existing line items for this order
  await supabase
    .from('order_line_items')
    .delete()
    .eq('order_id', orderId);

  // Insert new line items
  const lineItemsData = lineItems.map(item => ({
    order_id: orderId,
    shopify_line_item_id: item.id,
    product_id: item.product_id,
    variant_id: item.variant_id,
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price) || 0,
    sku: item.sku,
    vendor: item.vendor,
    product_type: item.product_type,
    raw_data: item
  }));

  const { error } = await supabase
    .from('order_line_items')
    .insert(lineItemsData);

  if (error) throw error;
}

async function handleOrderCreate(order, shopifyOrder, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  // Create customer journey record
  const journeyData = {
    shop_domain: shopRecord.domain,
    order_id: order.id,
    customer_email: shopifyOrder.email,
    current_stage: 'order_placed',
    stages_completed: ['order_placed'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await supabase
    .from('customer_journeys')
    .insert(journeyData);

  // Trigger upsell engine if order is paid and not fulfilled
  if (shopifyOrder.financial_status === 'paid' && !shopifyOrder.fulfillment_status) {
    setImmediate(() => {
      triggerUpsellEngine(order.id, shopifyOrder, shopRecord);
    });
  }

  // Trigger tracking engine to monitor order
  setImmediate(() => {
    triggerTrackingEngine(order.id, shopifyOrder, shopRecord);
  });

  logger.info(`Order creation processed for order ${order.shopify_order_id}`);
}

async function handleOrderUpdate(order, shopifyOrder, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  // Update customer journey stage if fulfillment status changed
  if (shopifyOrder.fulfillment_status) {
    await supabase
      .from('customer_journeys')
      .update({
        current_stage: 'order_fulfilled',
        stages_completed: ['order_placed', 'order_fulfilled'],
        updated_at: new Date().toISOString()
      })
      .eq('order_id', order.id);
  }

  // Check if order was paid (for financial status updates)
  if (shopifyOrder.financial_status === 'paid' && order.financial_status !== 'paid') {
    setImmediate(() => {
      triggerUpsellEngine(order.id, shopifyOrder, shopRecord);
    });
  }

  logger.info(`Order update processed for order ${order.shopify_order_id}`);
}

async function handleOrderCancel(order, shopifyOrder, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  // Update customer journey stage
  await supabase
    .from('customer_journeys')
    .update({
      current_stage: 'order_cancelled',
      stages_completed: ['order_placed', 'order_cancelled'],
      updated_at: new Date().toISOString()
    })
    .eq('order_id', order.id);

  // Log cancellation for analytics
  await supabase
    .from('order_events')
    .insert({
      order_id: order.id,
      event_type: 'order_cancelled',
      event_data: {
        cancelled_at: shopifyOrder.cancelled_at,
        cancel_reason: shopifyOrder.cancel_reason
      },
      created_at: new Date().toISOString()
    });

  logger.info(`Order cancellation processed for order ${order.shopify_order_id}`);
}

module.exports = {
  processOrderEvent
};
