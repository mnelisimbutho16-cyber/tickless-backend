const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

let supabase = null;
let supabaseAdmin = null;

async function initializeSupabase() {
  try {
    // Client for application operations (uses RLS)
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Admin client for bypassing RLS when needed
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Test connection
    const { data, error } = await supabase.from('shops').select('count').limit(1);
    if (error && error.code !== 'PGRST116') { // PGRST116 = table doesn't exist
      throw error;
    }

    logger.info('Supabase configuration initialized');
    return { supabase, supabaseAdmin };
  } catch (error) {
    logger.error('Failed to initialize Supabase:', error);
    throw error;
  }
}

function getSupabaseClient() {
  if (!supabase) {
    throw new Error('Supabase not initialized. Call initializeSupabase() first.');
  }
  return supabase;
}

function getSupabaseAdminClient() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin not initialized. Call initializeSupabase() first.');
  }
  return supabaseAdmin;
}

async function createShopRecord(shopDomain, accessToken, scope) {
  const supabaseAdmin = getSupabaseAdminClient();
  
  const { data, error } = await supabaseAdmin
    .from('shops')
    .upsert({
      domain: shopDomain,
      access_token: accessToken,
      scope: scope,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create shop record:', error);
    throw error;
  }

  return data;
}

async function getShopByDomain(shopDomain) {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('domain', shopDomain)
    .eq('is_active', true)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to get shop by domain:', error);
    throw error;
  }

  return data;
}

async function saveWebhookEvent(shopDomain, eventType, payload) {
  const supabaseAdmin = getSupabaseAdminClient();
  
  const { data, error } = await supabaseAdmin
    .from('webhook_events')
    .insert({
      shop_domain: shopDomain,
      event_type: eventType,
      payload: payload,
      processed: false,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save webhook event:', error);
    throw error;
  }

  return data;
}

module.exports = {
  initializeSupabase,
  getSupabaseClient,
  getSupabaseAdminClient,
  createShopRecord,
  getShopByDomain,
  saveWebhookEvent
};
