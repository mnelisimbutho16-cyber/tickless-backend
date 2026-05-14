const OpenAI = require('openai');
const logger = require('../utils/logger');
const { getSupabaseAdminClient } = require('../config/supabase');

// ── Lazy OpenAI init — only runs when first called, not on module load ─────────
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'placeholder' });
}

async function triggerUpsellEngine(orderId, shopifyOrder, shopRecord) {
  const supabase = getSupabaseAdminClient();

  try {
    logger.info(`Triggering upsell engine for order ${shopifyOrder.id} in shop ${shopRecord.domain}`);

    const { data: existingUpsell } = await supabase
      .from('upsells')
      .select('*')
      .eq('order_id', orderId)
      .eq('shop_domain', shopRecord.domain)
      .single();

    if (existingUpsell) {
      logger.info(`Upsell already exists for order ${shopifyOrder.id}`);
      return existingUpsell;
    }

    const customerHistory = await getCustomerOrderHistory(shopifyOrder.email, shopRecord.domain);
    const productCatalog  = await getShopProductCatalog(shopRecord.domain);
    const upsellOffer     = await generateUpsellOffer(shopifyOrder, customerHistory, productCatalog, shopRecord);

    if (!upsellOffer) {
      logger.info(`No suitable upsell offer generated for order ${shopifyOrder.id}`);
      return null;
    }

    const { data: savedUpsell, error } = await supabase
      .from('upsells')
      .insert({
        shop_domain:         shopRecord.domain,
        order_id:            orderId,
        customer_email:      shopifyOrder.email,
        product_id:          upsellOffer.productId,
        variant_id:          upsellOffer.variantId,
        product_title:       upsellOffer.title,
        original_price:      upsellOffer.originalPrice,
        offer_price:         upsellOffer.offerPrice,
        discount_percentage: upsellOffer.discountPercentage,
        upsell_type:         upsellOffer.type,
        ai_reasoning:        upsellOffer.reasoning,
        status:              'pending',
        expires_at:          upsellOffer.expiresAt,
        created_at:          new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    await sendUpsellEmail(savedUpsell, shopifyOrder, shopRecord);

    logger.info(`Upsell created for order ${shopifyOrder.id}: ${upsellOffer.title}`);
    return savedUpsell;

  } catch (error) {
    logger.error(`Upsell engine failed for order ${shopifyOrder.id}:`, error);
    throw error;
  }
}

async function getCustomerOrderHistory(customerEmail, shopDomain) {
  const supabase = getSupabaseAdminClient();
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('shop_domain', shopDomain)
      .eq('customer_email', customerEmail)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return orders || [];
  } catch (error) {
    logger.error('Failed to get customer order history:', error);
    return [];
  }
}

async function getShopProductCatalog(shopDomain) {
  const supabase = getSupabaseAdminClient();
  try {
    const { data: lineItems, error } = await supabase
      .from('order_line_items')
      .select(`product_id, variant_id, title, price, vendor, product_type, orders!inner(shop_domain, created_at)`)
      .eq('orders.shop_domain', shopDomain)
      .gte('orders.created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(100);
    if (error) throw error;

    const productMap = new Map();
    lineItems?.forEach(item => {
      if (!productMap.has(item.product_id)) {
        productMap.set(item.product_id, {
          productId: item.product_id, variantId: item.variant_id,
          title: item.title, vendor: item.vendor,
          productType: item.product_type, prices: []
        });
      }
      productMap.get(item.product_id).prices.push(item.price);
    });

    return Array.from(productMap.values()).map(p => ({
      ...p,
      averagePrice: p.prices.reduce((a, b) => a + b, 0) / p.prices.length,
    }));
  } catch (error) {
    logger.error('Failed to get product catalog:', error);
    return [];
  }
}

async function generateUpsellOffer(order, customerHistory, productCatalog, shopRecord) {
  try {
    const openai     = getOpenAI();
    const orderTotal = parseFloat(order.total_price || 0);
    const minOffer   = (orderTotal * 0.25).toFixed(2);
    const maxOffer   = (orderTotal * 0.35).toFixed(2);

    const systemPrompt = `You are an e-commerce upsell specialist. Pick the best upsell from the catalog.
Rules:
- Price between $${minOffer} and $${maxOffer} (25-35% of order total)
- Never recommend the same product just bought
- Offer 10-25% discount
- Respond in valid JSON only, no markdown

JSON format:
{"productId":"id","variantId":"id","title":"name","originalPrice":29.99,"offerPrice":23.99,"discountPercentage":20,"type":"complementary","reasoning":"one line"}`;

    const userPrompt = `Order: $${order.total_price} — ${order.line_items?.map(i => i.title).join(', ')}
Catalog: ${productCatalog.map(p => `${p.title} ($${p.averagePrice?.toFixed(2)})`).join(', ')}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.3,
      max_tokens: 300,
    });

    const upsellOffer  = JSON.parse(completion.choices[0].message.content);
    const expiresAt    = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    upsellOffer.expiresAt = expiresAt.toISOString();
    return upsellOffer;

  } catch (error) {
    logger.error('Failed to generate upsell offer:', error);
    return null;
  }
}

async function sendUpsellEmail(upsell, order, shopRecord) {
  try {
    logger.info('Upsell email queued:', { email: upsell.customer_email, product: upsell.product_title });
  } catch (error) {
    logger.error('Failed to send upsell email:', error);
  }
}

module.exports = { triggerUpsellEngine };
