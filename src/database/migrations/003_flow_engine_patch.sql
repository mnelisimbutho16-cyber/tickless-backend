-- ============================================================
-- 003_flow_engine_patch.sql
-- Run this AFTER 001_initial_schema.sql and 002_rls_policies.sql
-- ============================================================

-- 1. Customer flow state — tracks promo pausing per customer
ALTER TABLE customer_journeys
  ADD COLUMN IF NOT EXISTS promos_paused  BOOLEAN              DEFAULT false,
  ADD COLUMN IF NOT EXISTS pause_reason   TEXT,
  ADD COLUMN IF NOT EXISTS paused_at      TIMESTAMP WITH TIME ZONE;

-- 2. Plan tier on shops — needed for billing enforcement
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS plan            VARCHAR(50)          DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS trial_ends_at   TIMESTAMP WITH TIME ZONE;

-- 3. Notifications log — prevents double-sending any email
CREATE TABLE IF NOT EXISTS notifications_log (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain       VARCHAR(255) NOT NULL REFERENCES shops(domain),
    order_id          UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_email    VARCHAR(255),
    notification_type VARCHAR(100) NOT NULL,  -- 'tracking' | 'delay_warning' | 'return_confirm' | 'winback_scheduled' | 'winback_sent'
    sent_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for notifications_log
CREATE INDEX IF NOT EXISTS idx_notifications_log_order_id  ON notifications_log(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_log_type      ON notifications_log(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_log_email     ON notifications_log(customer_email);
CREATE INDEX IF NOT EXISTS idx_notifications_log_sent_at   ON notifications_log(sent_at);

-- 4. Index for promo pause lookups (called on every order create)
CREATE INDEX IF NOT EXISTS idx_customer_journeys_email_promos
  ON customer_journeys(customer_email, shop_domain, promos_paused);
