-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create shops table (multi-tenant base)
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) UNIQUE NOT NULL,
    access_token TEXT NOT NULL,
    scope TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    shopify_order_id BIGINT NOT NULL,
    order_number VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(255),
    financial_status VARCHAR(100),
    fulfillment_status VARCHAR(100),
    total_price DECIMAL(10,2),
    currency VARCHAR(3),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    raw_data JSONB,
    UNIQUE(shop_domain, shopify_order_id)
);

-- Create order line items table
CREATE TABLE IF NOT EXISTS order_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    shopify_line_item_id BIGINT NOT NULL,
    product_id BIGINT,
    variant_id BIGINT,
    title TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price DECIMAL(10,2),
    sku VARCHAR(255),
    vendor VARCHAR(255),
    product_type VARCHAR(255),
    raw_data JSONB
);

-- Create fulfillments table
CREATE TABLE IF NOT EXISTS fulfillments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    shopify_fulfillment_id BIGINT NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id),
    status VARCHAR(100),
    tracking_company VARCHAR(255),
    tracking_number VARCHAR(255),
    tracking_numbers TEXT[],
    tracking_urls TEXT[],
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    raw_data JSONB,
    UNIQUE(shop_domain, shopify_fulfillment_id)
);

-- Create fulfillment line items table
CREATE TABLE IF NOT EXISTS fulfillment_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fulfillment_id UUID NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
    shopify_line_item_id BIGINT NOT NULL,
    quantity INTEGER NOT NULL,
    raw_data JSONB
);

-- Create returns table
CREATE TABLE IF NOT EXISTS returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    shopify_return_id BIGINT NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id),
    customer_email VARCHAR(255),
    return_status VARCHAR(100),
    total_amount DECIMAL(10,2),
    currency VARCHAR(3),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    raw_data JSONB,
    UNIQUE(shop_domain, shopify_return_id)
);

-- Create return line items table
CREATE TABLE IF NOT EXISTS return_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    shopify_line_item_id BIGINT NOT NULL,
    quantity INTEGER NOT NULL,
    return_reason TEXT,
    raw_data JSONB
);

-- Create webhook events table
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create customer journeys table
CREATE TABLE IF NOT EXISTS customer_journeys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    order_id UUID NOT NULL REFERENCES orders(id),
    customer_email VARCHAR(255),
    current_stage VARCHAR(100),
    stages_completed TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_domain, order_id)
);

-- Create upsells table
CREATE TABLE IF NOT EXISTS upsells (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    order_id UUID NOT NULL REFERENCES orders(id),
    customer_email VARCHAR(255),
    product_id BIGINT,
    variant_id BIGINT,
    product_title TEXT,
    original_price DECIMAL(10,2),
    offer_price DECIMAL(10,2),
    discount_percentage DECIMAL(5,2),
    upsell_type VARCHAR(50),
    ai_reasoning TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    accepted BOOLEAN,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tracking info table
CREATE TABLE IF NOT EXISTS tracking_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    order_id UUID NOT NULL REFERENCES orders(id),
    fulfillment_id UUID REFERENCES fulfillments(id),
    tracking_number VARCHAR(255) NOT NULL,
    carrier VARCHAR(100),
    status VARCHAR(100) DEFAULT 'unknown',
    current_status VARCHAR(100),
    estimated_delivery TIMESTAMP WITH TIME ZONE,
    last_location TEXT,
    last_checked TIMESTAMP WITH TIME ZONE,
    tracking_events JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tracking queue table
CREATE TABLE IF NOT EXISTS tracking_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_id UUID NOT NULL REFERENCES tracking_info(id),
    shop_domain VARCHAR(255) NOT NULL REFERENCES shops(domain),
    order_id UUID NOT NULL REFERENCES orders(id),
    tracking_number VARCHAR(255) NOT NULL,
    carrier VARCHAR(100),
    status VARCHAR(50) DEFAULT 'queued',
    next_check TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tracking events table
CREATE TABLE IF NOT EXISTS tracking_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_id UUID NOT NULL REFERENCES tracking_info(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    event_type VARCHAR(100),
    previous_status VARCHAR(100),
    new_status VARCHAR(100),
    event_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create return processing table
CREATE TABLE IF NOT EXISTS return_processing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID NOT NULL REFERENCES returns(id),
    qr_code_url TEXT,
    qr_code_data TEXT,
    credit_offer_amount DECIMAL(10,2),
    credit_offer_percentage DECIMAL(5,2),
    credit_offer_expires_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create order events table for audit trail
CREATE TABLE IF NOT EXISTS order_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    event_type VARCHAR(100),
    event_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_shop_domain ON orders(shop_domain);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_shop_domain ON webhook_events(shop_domain);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_customer_journeys_shop_domain ON customer_journeys(shop_domain);
CREATE INDEX IF NOT EXISTS idx_customer_journeys_current_stage ON customer_journeys(current_stage);
CREATE INDEX IF NOT EXISTS idx_upsells_shop_domain ON upsells(shop_domain);
CREATE INDEX IF NOT EXISTS idx_upsells_status ON upsells(status);
CREATE INDEX IF NOT EXISTS idx_tracking_info_shop_domain ON tracking_info(shop_domain);
CREATE INDEX IF NOT EXISTS idx_tracking_info_tracking_number ON tracking_info(tracking_number);
CREATE INDEX IF NOT EXISTS idx_tracking_queue_next_check ON tracking_queue(next_check);
CREATE INDEX IF NOT EXISTS idx_tracking_queue_status ON tracking_queue(status);
CREATE INDEX IF NOT EXISTS idx_returns_shop_domain ON returns(shop_domain);
CREATE INDEX IF NOT EXISTS idx_fulfillments_shop_domain ON fulfillments(shop_domain);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_shops_updated_at BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fulfillments_updated_at BEFORE UPDATE ON fulfillments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_returns_updated_at BEFORE UPDATE ON returns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_webhook_events_updated_at BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customer_journeys_updated_at BEFORE UPDATE ON customer_journeys FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_upsells_updated_at BEFORE UPDATE ON upsells FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tracking_info_updated_at BEFORE UPDATE ON tracking_info FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tracking_queue_updated_at BEFORE UPDATE ON tracking_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_return_processing_updated_at BEFORE UPDATE ON return_processing FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
