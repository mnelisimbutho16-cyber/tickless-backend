const axios = require('axios');
const logger = require('../utils/logger');
const { getSupabaseAdminClient } = require('../config/supabase');

// Carrier API configurations
const CARRIER_APIS = {
  ups: {
    baseUrl: 'https://onlinetools.ups.com/ship/v1/track',
    apiKey: process.env.UPS_API_KEY
  },
  fedex: {
    baseUrl: 'https://apis.fedex.com/track/v1/trackingnumbers',
    apiKey: process.env.FEDEX_API_KEY
  },
  usps: {
    baseUrl: 'https://api.usps.com/track/v2',
    apiKey: process.env.USPS_API_KEY
  }
};

async function triggerTrackingEngine(orderId, shopifyOrder, shopRecord, fulfillment = null) {
  const supabase = getSupabaseAdminClient();
  
  try {
    logger.info(`Triggering tracking engine for order ${shopifyOrder?.id || orderId}`);

    // Get tracking info for this order
    const { data: trackingInfo, error } = await supabase
      .from('tracking_info')
      .select('*')
      .eq('order_id', orderId)
      .eq('shop_domain', shopRecord.domain)
      .single();

    if (error || !trackingInfo) {
      logger.info(`No tracking info found for order ${orderId}`);
      return;
    }

    // Start tracking monitoring
    await startTrackingMonitoring(trackingInfo, shopRecord);

    logger.info(`Tracking monitoring started for order ${orderId}`);

  } catch (error) {
    logger.error(`Tracking engine failed for order ${orderId}:`, error);
    throw error;
  }
}

async function startTrackingMonitoring(trackingInfo, shopRecord) {
  const supabase = getSupabaseAdminClient();
  
  try {
    // Update tracking status to monitoring
    await supabase
      .from('tracking_info')
      .update({
        status: 'monitoring',
        last_checked: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', trackingInfo.id);

    // Add to tracking queue for polling
    const trackingQueueData = {
      tracking_id: trackingInfo.id,
      shop_domain: shopRecord.domain,
      order_id: trackingInfo.order_id,
      tracking_number: trackingInfo.tracking_number,
      carrier: trackingInfo.carrier,
      status: 'queued',
      next_check: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    await supabase
      .from('tracking_queue')
      .insert(trackingQueueData);

    logger.info(`Added tracking ${trackingInfo.tracking_number} to monitoring queue`);

  } catch (error) {
    logger.error('Failed to start tracking monitoring:', error);
    throw error;
  }
}

async function pollTrackingUpdates() {
  const supabase = getSupabaseAdminClient();
  
  try {
    // Get tracking items that need to be checked
    const { data: trackingItems, error } = await supabase
      .from('tracking_queue')
      .select('*')
      .eq('status', 'queued')
      .lte('next_check', new Date().toISOString())
      .limit(50);

    if (error) throw error;
    if (!trackingItems || trackingItems.length === 0) {
      return;
    }

    logger.info(`Polling ${trackingItems.length} tracking updates`);

    for (const item of trackingItems) {
      try {
        await checkTrackingStatus(item);
      } catch (error) {
        logger.error(`Failed to check tracking for ${item.tracking_number}:`, error);
        
        // Update next check time (exponential backoff)
        const nextCheck = new Date();
        nextCheck.setHours(nextCheck.getHours() + Math.pow(2, item.retry_count || 0));
        
        await supabase
          .from('tracking_queue')
          .update({
            next_check: nextCheck.toISOString(),
            retry_count: (item.retry_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);
      }
    }

  } catch (error) {
    logger.error('Failed to poll tracking updates:', error);
  }
}

async function checkTrackingStatus(trackingItem) {
  const supabase = getSupabaseAdminClient();
  
  try {
    // Get tracking details from carrier API
    const trackingDetails = await fetchTrackingFromCarrier(
      trackingItem.carrier,
      trackingItem.tracking_number
    );

    if (!trackingDetails) {
      throw new Error('No tracking details returned from carrier');
    }

    // Update tracking info
    await supabase
      .from('tracking_info')
      .update({
        current_status: trackingDetails.status,
        estimated_delivery: trackingDetails.estimatedDelivery,
        last_location: trackingDetails.currentLocation,
        last_checked: new Date().toISOString(),
        tracking_events: trackingDetails.events,
        updated_at: new Date().toISOString()
      })
      .eq('id', trackingItem.tracking_id);

    // Check for status changes that require action
    await handleTrackingStatusChange(trackingItem, trackingDetails);

    // Update queue
    const nextCheck = calculateNextCheckTime(trackingDetails.status);
    
    await supabase
      .from('tracking_queue')
      .update({
        status: trackingDetails.status === 'delivered' ? 'completed' : 'queued',
        next_check: nextCheck,
        updated_at: new Date().toISOString()
      })
      .eq('id', trackingItem.id);

    logger.info(`Updated tracking ${trackingItem.tracking_number}: ${trackingDetails.status}`);

  } catch (error) {
    logger.error(`Failed to check tracking status for ${trackingItem.tracking_number}:`, error);
    throw error;
  }
}

async function fetchTrackingFromCarrier(carrier, trackingNumber) {
  try {
    const carrierConfig = CARRIER_APIS[carrier.toLowerCase()];
    if (!carrierConfig) {
      throw new Error(`Unsupported carrier: ${carrier}`);
    }

    switch (carrier.toLowerCase()) {
      case 'ups':
        return await fetchUPSTracking(trackingNumber, carrierConfig);
      case 'fedex':
        return await fetchFedExTracking(trackingNumber, carrierConfig);
      case 'usps':
        return await uspsTracking(trackingNumber, carrierConfig);
      default:
        throw new Error(`Unsupported carrier: ${carrier}`);
    }

  } catch (error) {
    logger.error(`Failed to fetch tracking from ${carrier}:`, error);
    return null;
  }
}

async function fetchUPSTracking(trackingNumber, config) {
  try {
    const response = await axios.get(`${config.baseUrl}/track/${trackingNumber}`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;
    
    return {
      status: data.trackResponse?.shipment?.[0]?.package?.[0]?.activity?.[0]?.status?.description || 'unknown',
      estimatedDelivery: data.trackResponse?.shipment?.[0]?.deliveryDate?.[0]?.date,
      currentLocation: data.trackResponse?.shipment?.[0]?.package?.[0]?.activity?.[0]?.location?.address?.city,
      events: data.trackResponse?.shipment?.[0]?.package?.[0]?.activity?.map(activity => ({
        date: activity.date,
        time: activity.time,
        status: activity.status?.description,
        location: activity.location?.address?.city
      })) || []
    };

  } catch (error) {
    logger.error('UPS tracking API error:', error);
    return null;
  }
}

async function fetchFedExTracking(trackingNumber, config) {
  try {
    const response = await axios.post(`${config.baseUrl}/trackingnumbers`, {
      includeDetailedScans: true,
      trackingInfo: [{
        trackingNumberInfo: {
          trackingNumber: trackingNumber
        }
      }]
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;
    const trackResult = data.output?.completeTrackResults?.[0];
    
    return {
      status: trackResult?.trackResults?.[0]?.latestStatusDetail?.description || 'unknown',
      estimatedDelivery: trackResult?.dateAndTimes?.find(dt => dt.type === 'ESTIMATED_DELIVERY')?.dateTime,
      currentLocation: trackResult?.trackResults?.[0]?.latestStatusDetail?.scanLocation?.city,
      events: trackResult?.trackResults?.[0]?.scanEvents?.map(event => ({
        date: event.date,
        time: event.time,
        status: event.eventDescription,
        location: event.scanLocation?.city
      })) || []
    };

  } catch (error) {
    logger.error('FedEx tracking API error:', error);
    return null;
  }
}

async function uspsTracking(trackingNumber, config) {
  try {
    const response = await axios.get(`${config.baseUrl}/tracking/${trackingNumber}`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;
    
    return {
      status: data.trackingSummary?.status || 'unknown',
      estimatedDelivery: data.trackingSummary?.expectedDeliveryDate,
      currentLocation: data.trackingSummary?.location?.city,
      events: data.events?.map(event => ({
        date: event.eventDate,
        time: event.eventTime,
        status: event.eventDescription,
        location: event.eventLocation?.city
      })) || []
    };

  } catch (error) {
    logger.error('USPS tracking API error:', error);
    return null;
  }
}

async function handleTrackingStatusChange(trackingItem, trackingDetails) {
  const supabase = getSupabaseAdminClient();
  
  try {
    // Get current tracking status
    const { data: currentTracking } = await supabase
      .from('tracking_info')
      .select('current_status')
      .eq('id', trackingItem.tracking_id)
      .single();

    const previousStatus = currentTracking?.current_status;
    const newStatus = trackingDetails.status;

    // If status changed, create an event
    if (previousStatus !== newStatus) {
      const eventData = {
        tracking_id: trackingItem.tracking_id,
        order_id: trackingItem.order_id,
        event_type: 'status_change',
        previous_status: previousStatus,
        new_status: newStatus,
        event_data: trackingDetails,
        created_at: new Date().toISOString()
      };

      await supabase
        .from('tracking_events')
        .insert(eventData);

      // Handle specific status changes
      if (newStatus.toLowerCase().includes('delivered')) {
        await handleDelivery(trackingItem, trackingDetails);
      } else if (newStatus.toLowerCase().includes('delay') || newStatus.toLowerCase().includes('exception')) {
        await handleDelay(trackingItem, trackingDetails);
      } else if (newStatus.toLowerCase().includes('out for delivery')) {
        await handleOutForDelivery(trackingItem, trackingDetails);
      }

      logger.info(`Tracking status changed for ${trackingItem.tracking_number}: ${previousStatus} -> ${newStatus}`);
    }

  } catch (error) {
    logger.error('Failed to handle tracking status change:', error);
  }
}

async function handleDelivery(trackingItem, trackingDetails) {
  const supabase = getSupabaseAdminClient();
  
  try {
    // Update customer journey stage
    await supabase
      .from('customer_journeys')
      .update({
        current_stage: 'delivered',
        stages_completed: ['order_placed', 'order_fulfilled', 'shipped', 'delivered'],
        updated_at: new Date().toISOString()
      })
      .eq('order_id', trackingItem.order_id);

    // Send delivery confirmation email
    await sendDeliveryConfirmationEmail(trackingItem, trackingDetails);

    logger.info(`Delivery handled for order ${trackingItem.order_id}`);

  } catch (error) {
    logger.error('Failed to handle delivery:', error);
  }
}

async function handleDelay(trackingItem, trackingDetails) {
  try {
    // Send delay notification email
    await sendDelayNotificationEmail(trackingItem, trackingDetails);

    logger.info(`Delay notification sent for order ${trackingItem.order_id}`);

  } catch (error) {
    logger.error('Failed to handle delay:', error);
  }
}

async function handleOutForDelivery(trackingItem, trackingDetails) {
  try {
    // Send "out for delivery" email
    await sendOutForDeliveryEmail(trackingItem, trackingDetails);

    logger.info(`Out for delivery notification sent for order ${trackingItem.order_id}`);

  } catch (error) {
    logger.error('Failed to handle out for delivery:', error);
  }
}

function calculateNextCheckTime(status) {
  const now = new Date();
  
  // Check more frequently for active shipments
  if (status.toLowerCase().includes('delivered')) {
    // Don't check delivered packages
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 week
  } else if (status.toLowerCase().includes('out for delivery')) {
    // Check every 2 hours for out for delivery
    return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  } else {
    // Check every 30 minutes for in-transit packages
    return new Date(now.getTime() + 30 * 60 * 1000);
  }
}

async function sendDeliveryConfirmationEmail(trackingItem, trackingDetails) {
  // Implementation would integrate with email service
  logger.info('Delivery confirmation email prepared', {
    orderId: trackingItem.order_id,
    trackingNumber: trackingItem.tracking_number
  });
}

async function sendDelayNotificationEmail(trackingItem, trackingDetails) {
  // Implementation would integrate with email service
  logger.info('Delay notification email prepared', {
    orderId: trackingItem.order_id,
    trackingNumber: trackingItem.tracking_number
  });
}

async function sendOutForDeliveryEmail(trackingItem, trackingDetails) {
  // Implementation would integrate with email service
  logger.info('Out for delivery email prepared', {
    orderId: trackingItem.order_id,
    trackingNumber: trackingItem.tracking_number
  });
}

module.exports = {
  triggerTrackingEngine,
  pollTrackingUpdates
};
