-- Enable Row Level Security on all tables
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsells ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

-- Create policy for shops table
-- Only allow access to own shop data
CREATE POLICY "Shops can view own data" ON shops
    FOR SELECT USING (domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own data" ON shops
    FOR UPDATE USING (domain = current_setting('app.current_shop_domain', true));

-- Orders table policies
CREATE POLICY "Shops can view own orders" ON orders
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own orders" ON orders
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own orders" ON orders
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Order line items policies
CREATE POLICY "Shops can view own order line items" ON order_line_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_line_items.order_id 
            AND orders.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can insert own order line items" ON order_line_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_line_items.order_id 
            AND orders.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can update own order line items" ON order_line_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_line_items.order_id 
            AND orders.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

-- Fulfillments table policies
CREATE POLICY "Shops can view own fulfillments" ON fulfillments
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own fulfillments" ON fulfillments
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own fulfillments" ON fulfillments
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Fulfillment line items policies
CREATE POLICY "Shops can view own fulfillment line items" ON fulfillment_line_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM fulfillments 
            WHERE fulfillments.id = fulfillment_line_items.fulfillment_id 
            AND fulfillments.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can insert own fulfillment line items" ON fulfillment_line_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM fulfillments 
            WHERE fulfillments.id = fulfillment_line_items.fulfillment_id 
            AND fulfillments.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

-- Returns table policies
CREATE POLICY "Shops can view own returns" ON returns
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own returns" ON returns
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own returns" ON returns
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Return line items policies
CREATE POLICY "Shops can view own return line items" ON return_line_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM returns 
            WHERE returns.id = return_line_items.return_id 
            AND returns.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can insert own return line items" ON return_line_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM returns 
            WHERE returns.id = return_line_items.return_id 
            AND returns.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

-- Webhook events policies
CREATE POLICY "Shops can view own webhook events" ON webhook_events
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own webhook events" ON webhook_events
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own webhook events" ON webhook_events
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Customer journeys policies
CREATE POLICY "Shops can view own customer journeys" ON customer_journeys
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own customer journeys" ON customer_journeys
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own customer journeys" ON customer_journeys
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Upsells policies
CREATE POLICY "Shops can view own upsells" ON upsells
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own upsells" ON upsells
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own upsells" ON upsells
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Tracking info policies
CREATE POLICY "Shops can view own tracking info" ON tracking_info
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own tracking info" ON tracking_info
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own tracking info" ON tracking_info
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Tracking queue policies
CREATE POLICY "Shops can view own tracking queue" ON tracking_queue
    FOR SELECT USING (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can insert own tracking queue" ON tracking_queue
    FOR INSERT WITH CHECK (shop_domain = current_setting('app.current_shop_domain', true));

CREATE POLICY "Shops can update own tracking queue" ON tracking_queue
    FOR UPDATE USING (shop_domain = current_setting('app.current_shop_domain', true));

-- Tracking events policies
CREATE POLICY "Shops can view own tracking events" ON tracking_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM tracking_info 
            WHERE tracking_info.id = tracking_events.tracking_id 
            AND tracking_info.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can insert own tracking events" ON tracking_events
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM tracking_info 
            WHERE tracking_info.id = tracking_events.tracking_id 
            AND tracking_info.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

-- Return processing policies
CREATE POLICY "Shops can view own return processing" ON return_processing
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM returns 
            WHERE returns.id = return_processing.return_id 
            AND returns.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can insert own return processing" ON return_processing
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM returns 
            WHERE returns.id = return_processing.return_id 
            AND returns.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can update own return processing" ON return_processing
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM returns 
            WHERE returns.id = return_processing.return_id 
            AND returns.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

-- Order events policies
CREATE POLICY "Shops can view own order events" ON order_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_events.order_id 
            AND orders.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

CREATE POLICY "Shops can insert own order events" ON order_events
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_events.order_id 
            AND orders.shop_domain = current_setting('app.current_shop_domain', true)
        )
    );

-- Create function to set shop context for RLS
CREATE OR REPLACE FUNCTION set_shop_context(shop_domain TEXT)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_shop_domain', shop_domain, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if shop is active
CREATE OR REPLACE FUNCTION is_shop_active(shop_domain TEXT)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM shops 
        WHERE domain = shop_domain 
        AND is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
