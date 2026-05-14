/**
 * flowEngine.js — The Brain
 *
 * Every single order state change passes through here.
 * It reads the full customer state, decides what to do,
 * and either fires an action or blocks one.
 *
 * This is what makes Tickless unbeatable:
 * no other app knows the full picture at once.
 */

const logger                                              = require('../utils/logger');
const { getSupabaseAdminClient }                          = require('../config/supabase');
const { sendTrackingEmail, sendDelayWarning,
        sendReturnConfirmation, sendWinBack }             = require('./emailService');
const { pickUpsell, decideFlow, scoreReturnRisk }         = require('./aiService');
const { generateQRCode }                                  = require('../utils/helpers');

// ── Main Orchestrator ─────────────────────────────────────────────────────────
// Called after every webhook is processed
async function orchestrateFlow(engineType, topic, payload, shopRecord) {
  const supabase = getSupabaseAdminClient();
  const shop     = shopRecord.domain;

  try {
    switch (engineType) {

      // ── ORDER EVENTS ─────────────────────────────────────────────────────────
      case 'order': {
        if (topic === 'orders/create') {
          await handleOrderCreated(payload, shop, supabase);
        }
        if (topic === 'orders/cancelled') {
          await pauseCustomerPromos(payload.email, shop, 'order_cancelled', supabase);
        }
        break;
      }

      // ── FULFILLMENT EVENTS ───────────────────────────────────────────────────
      case 'fulfillment': {
        if (topic === 'fulfillments/create') {
          await handleOrderFulfilled(payload, shop, supabase);
        }
        break;
      }

      // ── RETURN EVENTS ────────────────────────────────────────────────────────
      case 'return': {
        if (topic === 'returns/create') {
          await handleReturnCreated(payload, shop, supabase);
        }
        if (topic === 'returns/update' && payload.status === 'closed') {
          await handleReturnResolved(payload, shop, supabase);
        }
        break;
      }

      // ── REFUND EVENTS ────────────────────────────────────────────────────────
      case 'refund': {
        await handleRefundCreated(payload, shop, supabase);
        break;
      }
    }
  } catch (error) {
    logger.error(`Flow engine error [${engineType}/${topic}]:`, error);
  }
}

// ── Handler: Order Created ────────────────────────────────────────────────────
// Immediately queue the upsell offer for post-checkout
async function handleOrderCreated(payload, shop, supabase) {
  const customerEmail = payload.email;
  const orderTotal    = parseFloat(payload.total_price);
  const orderId       = payload.id;

  if (!customerEmail) return;

  // Check if this customer has promos paused (e.g. open return on another order)
  const paused = await arePromosPaused(customerEmail, shop, supabase);
  if (paused) {
    logger.info(`Skipping upsell for ${customerEmail} — promos paused`);
    return;
  }

  // Get products for AI upsell pick
  const { data: shopData } = await supabase
    .from('shops')
    .select('access_token')
    .eq('domain', shop)
    .single();

  // Fire upsell engine (non-blocking — upsell is shown via Shopify post-purchase extension)
  await supabase.from('upsells').insert({
    shop_domain:  shop,
    order_id:     await getInternalOrderId(orderId, shop, supabase),
    customer_email: customerEmail,
    status:       'pending',
    upsell_type:  'post_purchase',
  });

  logger.info(`Upsell queued for order ${orderId} — ${customerEmail}`);
}

// ── Handler: Order Fulfilled ──────────────────────────────────────────────────
// Sends branded tracking email the moment a fulfillment is created
async function handleOrderFulfilled(payload, shop, supabase) {
  const customerEmail  = payload.receipt?.email || null;
  const trackingNumber = payload.tracking_number;
  const orderGid       = payload.order_id;

  if (!trackingNumber) return;

  // Get order details for the email
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('shopify_order_id', orderGid)
    .eq('shop_domain', shop)
    .single();

  if (!order) return;

  const email = customerEmail || order.customer_email;
  if (!email) return;

  // Don't double-send if already sent
  const alreadySent = await notificationAlreadySent(order.id, 'tracking', supabase);
  if (alreadySent) return;

  const trackingUrl = `${process.env.HOST}/track/${order.id}`;

  // Send branded tracking email
  await sendTrackingEmail({
    to:          email,
    customerName: order.raw_data?.shipping_address?.first_name || 'there',
    orderNumber:  order.order_number,
    trackingUrl,
    storeName:    shop,
  });

  // Log it so we never double-send
  await logNotification(order.id, email, 'tracking', shop, supabase);
  logger.info(`Tracking email sent for order ${order.order_number}`);
}

// ── Handler: Return Created ───────────────────────────────────────────────────
// The most critical handler — pauses ALL promos for this customer immediately
async function handleReturnCreated(payload, shop, supabase) {
  const orderId = payload.order_id;

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('shopify_order_id', orderId)
    .eq('shop_domain', shop)
    .single();

  if (!order || !order.customer_email) return;

  // ── STEP 1: Pause promos immediately ────────────────────────────────────────
  await pauseCustomerPromos(order.customer_email, shop, 'return_initiated', supabase);
  logger.info(`Promos PAUSED for ${order.customer_email} — return initiated`);

  // ── STEP 2: Score return risk with AI ────────────────────────────────────────
  const { data: history } = await supabase
    .from('returns')
    .select('*')
    .eq('customer_email', order.customer_email)
    .eq('shop_domain', shop);

  const risk = await scoreReturnRisk({
    customer_email: order.customer_email,
    return_count:   history?.length || 0,
    return_history: history || [],
    current_return: payload,
  });

  // ── STEP 3: Generate QR code for return label ────────────────────────────────
  const returnPortalUrl = `${process.env.HOST}/return/${order.id}`;
  const qrCodeUrl       = await generateQRCode(returnPortalUrl);

  // ── STEP 4: Calculate store credit offer (10% above refund value) ───────────
  const refundAmount      = parseFloat(payload.total_refund_set?.shop_money?.amount || order.total_price);
  const storeCreditAmount = parseFloat((refundAmount * 1.10).toFixed(2));
  const creditExpiry      = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

  // Save return processing record
  const { data: returnRecord } = await supabase
    .from('returns')
    .select('id')
    .eq('shopify_return_id', payload.id)
    .eq('shop_domain', shop)
    .single();

  if (returnRecord) {
    await supabase.from('return_processing').insert({
      return_id:                 returnRecord.id,
      qr_code_url:               qrCodeUrl,
      qr_code_data:              returnPortalUrl,
      credit_offer_amount:       storeCreditAmount,
      credit_offer_percentage:   10,
      credit_offer_expires_at:   creditExpiry.toISOString(),
      status:                    'pending',
    });
  }

  // ── STEP 5: Send return confirmation email ───────────────────────────────────
  const alreadySent = await notificationAlreadySent(order.id, 'return_confirm', supabase);
  if (!alreadySent) {
    await sendReturnConfirmation({
      to:               order.customer_email,
      customerName:     order.raw_data?.shipping_address?.first_name || 'there',
      orderNumber:      order.order_number,
      returnUrl:        returnPortalUrl,
      qrCodeUrl,
      storeCreditOffer: storeCreditAmount,
      storeName:        shop,
    });

    await logNotification(order.id, order.customer_email, 'return_confirm', shop, supabase);
  }

  // ── STEP 6: Flag serial returner to merchant ─────────────────────────────────
  if (risk.is_serial_returner || risk.risk_level === 'high') {
    await supabase.from('order_events').insert({
      order_id:   order.id,
      event_type: 'serial_returner_flagged',
      event_data: { risk, customer_email: order.customer_email },
    });
    logger.warn(`Serial returner flagged: ${order.customer_email} — ${risk.pattern}`);
  }
}

// ── Handler: Return Resolved ──────────────────────────────────────────────────
// Return is closed — queue a win-back email for 7 days later
async function handleReturnResolved(payload, shop, supabase) {
  const orderId = payload.order_id;

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('shopify_order_id', orderId)
    .eq('shop_domain', shop)
    .single();

  if (!order || !order.customer_email) return;

  // Resume promos — return is resolved
  await resumeCustomerPromos(order.customer_email, shop, supabase);
  logger.info(`Promos RESUMED for ${order.customer_email} — return resolved`);

  // Schedule win-back email for 7 days from now
  const sendAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await supabase.from('notifications_log').insert({
    shop_domain:       shop,
    order_id:          order.id,
    customer_email:    order.customer_email,
    notification_type: 'winback_scheduled',
    sent_at:           sendAt.toISOString(), // used as "scheduled_for"
  });

  logger.info(`Win-back scheduled for ${order.customer_email} on ${sendAt.toDateString()}`);
}

// ── Handler: Refund Created ───────────────────────────────────────────────────
async function handleRefundCreated(payload, shop, supabase) {
  // Refund = money gone. Make sure promos are paused and win-back is queued.
  const orderId = payload.order_id;

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('shopify_order_id', orderId)
    .eq('shop_domain', shop)
    .single();

  if (!order || !order.customer_email) return;

  await pauseCustomerPromos(order.customer_email, shop, 'refund_issued', supabase);
  logger.info(`Promos paused after refund for ${order.customer_email}`);
}

// ── Carrier Delay Check (called by tracking poller job) ───────────────────────
// This is called from the cron job, not from a webhook
async function checkAndAlertDelays(shop, supabase) {
  // Find tracking records with no scan in 18+ hours
  const cutoff = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();

  const { data: staleTracking } = await supabase
    .from('tracking_info')
    .select('*, orders(*)')
    .eq('shop_domain', shop)
    .neq('status', 'delivered')
    .neq('status', 'returned')
    .lt('last_checked', cutoff);

  if (!staleTracking || staleTracking.length === 0) return;

  for (const track of staleTracking) {
    const order = track.orders;
    if (!order?.customer_email) continue;

    // Don't send if already sent a delay warning for this order
    const alreadySent = await notificationAlreadySent(order.id, 'delay_warning', supabase);
    if (alreadySent) continue;

    // Don't send if customer has an open return (promos paused)
    const paused = await arePromosPaused(order.customer_email, shop, supabase);
    if (paused) continue;

    const trackingUrl = `${process.env.HOST}/track/${order.id}`;

    await sendDelayWarning({
      to:          order.customer_email,
      customerName: order.raw_data?.shipping_address?.first_name || 'there',
      orderNumber:  order.order_number,
      trackingUrl,
      storeName:    shop,
    });

    await logNotification(order.id, order.customer_email, 'delay_warning', shop, supabase);
    logger.info(`Preemptive delay warning sent for order ${order.order_number}`);
  }
}

// ── Send Scheduled Win-Backs (called by cron job) ─────────────────────────────
async function sendScheduledWinBacks(shop, supabase) {
  const now = new Date().toISOString();

  const { data: scheduled } = await supabase
    .from('notifications_log')
    .select('*')
    .eq('shop_domain', shop)
    .eq('notification_type', 'winback_scheduled')
    .lte('sent_at', now); // sent_at used as scheduled_for

  if (!scheduled || scheduled.length === 0) return;

  for (const item of scheduled) {
    // Check promos aren't paused again (customer may have another return)
    const paused = await arePromosPaused(item.customer_email, shop, supabase);
    if (paused) continue;

    const discountCode = `COMEBACK${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    await sendWinBack({
      to:           item.customer_email,
      customerName: 'there',
      storeName:    shop,
      discountCode,
      shopUrl:      `https://${shop}`,
    });

    // Update log entry to mark as sent
    await supabase
      .from('notifications_log')
      .update({ notification_type: 'winback_sent' })
      .eq('id', item.id);

    logger.info(`Win-back email sent to ${item.customer_email}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pauseCustomerPromos(email, shop, reason, supabase) {
  await supabase
    .from('customer_journeys')
    .update({
      promos_paused: true,
      pause_reason:  reason,
      paused_at:     new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    })
    .eq('customer_email', email)
    .eq('shop_domain', shop);
}

async function resumeCustomerPromos(email, shop, supabase) {
  await supabase
    .from('customer_journeys')
    .update({
      promos_paused: false,
      pause_reason:  null,
      paused_at:     null,
      updated_at:    new Date().toISOString(),
    })
    .eq('customer_email', email)
    .eq('shop_domain', shop);
}

async function arePromosPaused(email, shop, supabase) {
  const { data } = await supabase
    .from('customer_journeys')
    .select('promos_paused')
    .eq('customer_email', email)
    .eq('shop_domain', shop)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  return data?.promos_paused === true;
}

async function notificationAlreadySent(orderId, type, supabase) {
  const { data } = await supabase
    .from('notifications_log')
    .select('id')
    .eq('order_id', orderId)
    .eq('notification_type', type)
    .limit(1)
    .single();

  return !!data;
}

async function logNotification(orderId, email, type, shop, supabase) {
  await supabase.from('notifications_log').insert({
    shop_domain:       shop,
    order_id:          orderId,
    customer_email:    email,
    notification_type: type,
  });
}

async function getInternalOrderId(shopifyOrderId, shop, supabase) {
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('shopify_order_id', shopifyOrderId)
    .eq('shop_domain', shop)
    .single();
  return data?.id;
}

module.exports = {
  orchestrateFlow,
  checkAndAlertDelays,
  sendScheduledWinBacks,
};
