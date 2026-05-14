const express = require('express');
const { verifyToken } = require('./auth');
const { getSupabaseClient } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication middleware to all dashboard routes
router.use(verifyToken);

// Get dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    // Get key metrics
    const [
      ordersResult,
      upsellsResult,
      returnsResult,
      trackingResult
    ] = await Promise.all([
      // Orders in last 30 days
      supabase
        .from('orders')
        .select('count, total_price')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      
      // Upsell performance
      supabase
        .from('upsells')
        .select('status, offer_price, accepted')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      
      // Returns in last 30 days
      supabase
        .from('returns')
        .select('count, total_amount')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      
      // Active tracking
      supabase
        .from('tracking_info')
        .select('count, status')
        .not('status', 'eq', 'delivered')
    ]);

    // Calculate metrics
    const totalOrders = ordersResult.data?.length || 0;
    const totalRevenue = ordersResult.data?.reduce((sum, order) => sum + (order.total_price || 0), 0) || 0;
    
    const totalUpsells = upsellsResult.data?.length || 0;
    const acceptedUpsells = upsellsResult.data?.filter(u => u.accepted).length || 0;
    const upsellRevenue = upsellsResult.data?.filter(u => u.accepted).reduce((sum, u) => sum + (u.offer_price || 0), 0) || 0;
    
    const totalReturns = returnsResult.data?.length || 0;
    const totalReturnAmount = returnsResult.data?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0;
    
    const activeTracking = trackingResult.data?.length || 0;

    res.json({
      overview: {
        totalOrders,
        totalRevenue,
        totalUpsells,
        upsellConversionRate: totalUpsells > 0 ? (acceptedUpsells / totalUpsells * 100).toFixed(1) : 0,
        upsellRevenue,
        totalReturns,
        returnRate: totalOrders > 0 ? (totalReturns / totalOrders * 100).toFixed(1) : 0,
        totalReturnAmount,
        activeTracking
      }
    });

  } catch (error) {
    logger.error('Failed to get dashboard overview:', error);
    res.status(500).json({ error: 'Failed to load dashboard overview' });
  }
});

// Get orders with pagination and filters
router.get('/orders', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;
    
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (page - 1) * limit;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    let query = supabase
      .from('orders')
      .select(`
        *,
        order_line_items (
          title,
          quantity,
          price
        ),
        customer_journeys (
          current_stage,
          stages_completed
        )
      `, { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('financial_status', status);
    }

    if (search) {
      query = query.or(`customer_email.ilike.%${search}%,order_number.ilike.%${search}%`);
    }

    // Apply pagination and ordering
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: orders, error, count } = await query;

    if (error) throw error;

    res.json({
      orders: orders || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    logger.error('Failed to get orders:', error);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// Get order details
router.get('/orders/:orderId', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;
    const { orderId } = req.params;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    // Get order with related data
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_line_items (
          *,
          fulfillments (
            tracking_number,
            tracking_company,
            status
          )
        ),
        customer_journeys (
          current_stage,
          stages_completed,
          updated_at
        ),
        upsells (
          product_title,
          offer_price,
          status,
          accepted,
          expires_at
        ),
        tracking_info (
          tracking_number,
          carrier,
          current_status,
          estimated_delivery
        ),
        returns (
          return_status,
          total_amount,
          created_at
        )
      `)
      .eq('id', orderId)
      .single();

    if (error) throw error;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ order });

  } catch (error) {
    logger.error('Failed to get order details:', error);
    res.status(500).json({ error: 'Failed to load order details' });
  }
});

// Get upsells performance
router.get('/upsells', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;
    
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    let query = supabase
      .from('upsells')
      .select(`
        *,
        orders (
          order_number,
          customer_email,
          total_price
        )
      `, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: upsells, error, count } = await query;

    if (error) throw error;

    // Calculate performance metrics
    const totalUpsells = upsells?.length || 0;
    const acceptedUpsells = upsells?.filter(u => u.accepted).length || 0;
    const totalRevenue = upsells?.filter(u => u.accepted).reduce((sum, u) => sum + (u.offer_price || 0), 0) || 0;

    res.json({
      upsells: upsells || [],
      metrics: {
        total: totalUpsells,
        accepted: acceptedUpsells,
        conversionRate: totalUpsells > 0 ? (acceptedUpsells / totalUpsells * 100).toFixed(1) : 0,
        revenue: totalRevenue
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    logger.error('Failed to get upsells:', error);
    res.status(500).json({ error: 'Failed to load upsells' });
  }
});

// Get tracking information
router.get('/tracking', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;
    
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    let query = supabase
      .from('tracking_info')
      .select(`
        *,
        orders (
          order_number,
          customer_email
        ),
        tracking_events (
          event_type,
          new_status,
          created_at
        )
      `, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: tracking, error, count } = await query;

    if (error) throw error;

    res.json({
      tracking: tracking || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    logger.error('Failed to get tracking info:', error);
    res.status(500).json({ error: 'Failed to load tracking information' });
  }
});

// Get returns information
router.get('/returns', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;
    
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    let query = supabase
      .from('returns')
      .select(`
        *,
        orders (
          order_number,
          customer_email,
          total_price
        ),
        return_processing (
          credit_offer_amount,
          credit_offer_percentage,
          status
        )
      `, { count: 'exact' });

    if (status) {
      query = query.eq('return_status', status);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: returns, error, count } = await query;

    if (error) throw error;

    res.json({
      returns: returns || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    logger.error('Failed to get returns:', error);
    res.status(500).json({ error: 'Failed to load returns' });
  }
});

// Get customer journey analytics
router.get('/analytics/customer-journey', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    // Get journey stage distribution
    const { data: stages, error: stagesError } = await supabase
      .from('customer_journeys')
      .select('current_stage')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (stagesError) throw stagesError;

    // Calculate stage distribution
    const stageDistribution = {};
    stages?.forEach(journey => {
      stageDistribution[journey.current_stage] = (stageDistribution[journey.current_stage] || 0) + 1;
    });

    // Get journey completion metrics
    const { data: completedJourneys, error: completedError } = await supabase
      .from('customer_journeys')
      .select('stages_completed, created_at, updated_at')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (completedError) throw completedError;

    // Calculate average completion time
    const completionTimes = completedJourneys
      ?.filter(j => j.stages_completed?.includes('delivered'))
      ?.map(j => {
        const created = new Date(j.created_at);
        const updated = new Date(j.updated_at);
        return (updated - created) / (1000 * 60 * 60); // hours
      }) || [];

    const avgCompletionTime = completionTimes.length > 0
      ? (completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length).toFixed(1)
      : 0;

    res.json({
      stageDistribution,
      metrics: {
        totalJourneys: stages?.length || 0,
        completedJourneys: completedJourneys?.filter(j => j.stages_completed?.includes('delivered')).length || 0,
        avgCompletionHours: parseFloat(avgCompletionTime)
      }
    });

  } catch (error) {
    logger.error('Failed to get customer journey analytics:', error);
    res.status(500).json({ error: 'Failed to load customer journey analytics' });
  }
});

// Get revenue analytics
router.get('/analytics/revenue', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const shopDomain = req.shop.domain;
    const { days = 30 } = req.query;

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Set shop context for RLS
    await supabase.rpc('set_shop_context', { shop_domain: shopDomain });

    // Get daily revenue data
    const { data: orders, error } = await supabase
      .from('orders')
      .select('total_price, created_at')
      .gte('created_at', startDate)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Get upsell revenue
    const { data: upsells, error: upsellError } = await supabase
      .from('upsells')
      .select('offer_price, accepted, created_at')
      .gte('created_at', startDate)
      .eq('accepted', true);

    if (upsellError) throw upsellError;

    // Group by date
    const dailyRevenue = {};
    const dailyUpsellRevenue = {};

    orders?.forEach(order => {
      const date = new Date(order.created_at).toISOString().split('T')[0];
      dailyRevenue[date] = (dailyRevenue[date] || 0) + (order.total_price || 0);
    });

    upsells?.forEach(upsell => {
      const date = new Date(upsell.created_at).toISOString().split('T')[0];
      dailyUpsellRevenue[date] = (dailyUpsellRevenue[date] || 0) + (upsell.offer_price || 0);
    });

    // Combine data
    const combinedData = Object.keys(dailyRevenue).map(date => ({
      date,
      orderRevenue: dailyRevenue[date] || 0,
      upsellRevenue: dailyUpsellRevenue[date] || 0,
      totalRevenue: (dailyRevenue[date] || 0) + (dailyUpsellRevenue[date] || 0)
    }));

    res.json({
      dailyRevenue: combinedData,
      summary: {
        totalOrderRevenue: Object.values(dailyRevenue).reduce((a, b) => a + b, 0),
        totalUpsellRevenue: Object.values(dailyUpsellRevenue).reduce((a, b) => a + b, 0),
        totalRevenue: Object.values(dailyRevenue).reduce((a, b) => a + b, 0) + Object.values(dailyUpsellRevenue).reduce((a, b) => a + b, 0)
      }
    });

  } catch (error) {
    logger.error('Failed to get revenue analytics:', error);
    res.status(500).json({ error: 'Failed to load revenue analytics' });
  }
});

module.exports = router;
