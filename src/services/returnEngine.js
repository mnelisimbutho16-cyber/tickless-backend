const logger = require('../utils/logger');
const { getSupabaseAdminClient } = require('../config/supabase');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

async function processReturnEvent(topic, payload, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  try {
    const returnRequest = payload;
    
    logger.info(`Processing return event: ${topic} for return ${returnRequest.id} in shop ${shopRecord.domain}`);

    // Save return request to database
    const returnData = {
      shop_domain: shopRecord.domain,
      shopify_return_id: returnRequest.id,
      order_id: returnRequest.order_id,
      customer_email: returnRequest.customer_email,
      return_status: returnRequest.return_status || 'pending',
      total_amount: parseFloat(returnRequest.total_amount) || 0,
      currency: returnRequest.currency,
      created_at: returnRequest.created_at,
      updated_at: returnRequest.updated_at,
      raw_data: returnRequest
    };

    const { data: savedReturn, error: saveError } = await supabase
      .from('returns')
      .upsert(returnData, { 
        onConflict: 'shop_domain,shopify_return_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (saveError) throw saveError;

    // Process return line items
    if (returnRequest.return_line_items && returnRequest.return_line_items.length > 0) {
      await processReturnLineItems(returnRequest.return_line_items, savedReturn.id);
    }

    // Handle return creation
    await handleReturnCreate(savedReturn, returnRequest, shopRecord);

    logger.info(`Successfully processed return event: ${topic} for return ${returnRequest.id}`);

  } catch (error) {
    logger.error(`Failed to process return event ${topic}:`, error);
    throw error;
  }
}

async function processReturnLineItems(lineItems, returnId) {
  const supabase = getSupabaseAdminClient();
  
  // Clear existing return line items
  await supabase
    .from('return_line_items')
    .delete()
    .eq('return_id', returnId);

  // Insert new line items
  const lineItemsData = lineItems.map(item => ({
    return_id: returnId,
    shopify_line_item_id: item.line_item_id,
    quantity: item.quantity,
    return_reason: item.return_reason,
    raw_data: item
  }));

  const { error } = await supabase
    .from('return_line_items')
    .insert(lineItemsData);

  if (error) throw error;
}

async function handleReturnCreate(returnRecord, shopifyReturn, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  // Update customer journey stage
  await supabase
    .from('customer_journeys')
    .update({
      current_stage: 'return_requested',
      stages_completed: ['order_placed', 'return_requested'],
      updated_at: new Date().toISOString()
    })
    .eq('order_id', returnRecord.order_id);

  // Generate QR code for return shipping
  const qrCodeData = await generateReturnQRCode(returnRecord, shopRecord);
  
  // Generate store credit offer
  const creditOffer = await generateStoreCreditOffer(returnRecord, shopRecord);

  // Create return processing record
  const processingData = {
    return_id: returnRecord.id,
    qr_code_url: qrCodeData.url,
    qr_code_data: qrCodeData.data,
    credit_offer_amount: creditOffer.amount,
    credit_offer_percentage: creditOffer.percentage,
    credit_offer_expires_at: creditOffer.expiresAt,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await supabase
    .from('return_processing')
    .insert(processingData);

  // Send return confirmation email (would integrate with email service)
  await sendReturnConfirmationEmail(returnRecord, qrCodeData, creditOffer, shopRecord);

  logger.info(`Return creation processed for return ${returnRecord.shopify_return_id}`);
}

async function generateReturnQRCode(returnRecord, shopRecord) {
  try {
    // Generate unique return ID
    const returnId = uuidv4();
    
    // Create return URL
    const returnUrl = `${process.env.HOST_URL}/returns/${returnId}`;
    
    // Generate QR code
    const qrCodeBuffer = await QRCode.toBuffer(returnUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Store QR code (in production, would upload to S3/Cloudinary)
    const qrCodeData = `data:image/png;base64,${qrCodeBuffer.toString('base64')}`;
    
    return {
      id: returnId,
      url: returnUrl,
      data: qrCodeData
    };

  } catch (error) {
    logger.error('Failed to generate QR code:', error);
    throw new Error('Failed to generate return QR code');
  }
}

async function generateStoreCreditOffer(returnRecord, shopRecord) {
  try {
    // Get order details to calculate credit offer
    const supabase = getSupabaseAdminClient();
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', returnRecord.order_id)
      .single();

    if (error || !order) {
      throw new Error('Order not found for return');
    }

    // Calculate credit offer (10% of order value by default, could be configurable)
    const creditPercentage = 0.10;
    const creditAmount = order.total_price * creditPercentage;
    
    // Set expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    return {
      amount: creditAmount,
      percentage: creditPercentage * 100,
      expiresAt: expiresAt.toISOString()
    };

  } catch (error) {
    logger.error('Failed to generate store credit offer:', error);
    throw new Error('Failed to generate store credit offer');
  }
}

async function sendReturnConfirmationEmail(returnRecord, qrCodeData, creditOffer, shopRecord) {
  try {
    // This would integrate with an email service like SendGrid, Mailgun, etc.
    const emailData = {
      to: returnRecord.customer_email,
      subject: `Return Request Confirmed - Order #${returnRecord.order_id}`,
      template: 'return_confirmation',
      data: {
        shopName: shopRecord.domain,
        orderNumber: returnRecord.order_id,
        returnId: returnRecord.shopify_return_id,
        qrCodeUrl: qrCodeData.url,
        qrCodeImage: qrCodeData.data,
        creditAmount: creditOffer.amount,
        creditExpiresAt: creditOffer.expiresAt
      }
    };

    // Log email for now (would send via email service)
    logger.info('Return confirmation email prepared:', {
      email: returnRecord.customer_email,
      orderId: returnRecord.order_id,
      creditAmount: creditOffer.amount
    });

    // In production: await emailService.send(emailData);

  } catch (error) {
    logger.error('Failed to send return confirmation email:', error);
    // Don't throw error - email failure shouldn't break return processing
  }
}

module.exports = {
  processReturnEvent
};
