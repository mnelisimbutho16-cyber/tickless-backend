# Shopify Post-Purchase Backend

A comprehensive Shopify app backend that automates the post-purchase experience through intelligent engines for upselling, tracking, and returns management.

## 🚀 Features

### Core Functionality
- **Shopify OAuth Integration** - Secure authentication and token management
- **Webhook Processing** - Real-time event handling for orders, fulfillments, and returns
- **Multi-tenant Architecture** - Row Level Security for data isolation
- **AI-Powered Upsells** - GPT-4o integration for personalized offers
- **Real-time Tracking** - Automated carrier polling (UPS, FedEx, USPS)
- **Smart Returns** - QR code generation and store credit offers
- **Merchant Dashboard** - Comprehensive analytics and insights

### Business Value
- **Reduced Support Tickets** - Proactive customer communication
- **Increased Revenue** - Intelligent upselling opportunities
- **Better Customer Experience** - Real-time tracking and updates
- **Streamlined Returns** - Automated processing with credit incentives
- **Operational Insights** - Detailed metrics and analytics

## 📋 System Architecture

```
Shopify installs app
        ↓
OAuth handshake → save shop token to Supabase
        ↓
Register 6 webhooks (orders, fulfillments, returns)
        ↓
Webhook fires → hits your Express endpoint
        ↓
Event saved to Supabase → triggers the right engine
        ↓
├── Upsell Engine → GPT-4o picks offer
├── Tracking Engine → polls carrier every 30min
└── Returns Engine → generates QR + credit offer
```

## 🛠 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: Supabase (PostgreSQL with RLS)
- **AI**: OpenAI GPT-4o
- **Authentication**: JWT, Shopify OAuth
- **Monitoring**: Winston logging, Health checks
- **Scheduling**: Node-cron for automated tasks

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd shopify-post-purchase-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```
   
   Configure your environment variables:
   - Shopify API credentials
   - Supabase database URL and keys
   - OpenAI API key
   - Carrier API keys (UPS, FedEx, USPS)

4. **Database Setup**
   ```bash
   npm run migrate
   ```

5. **Start the application**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 🔧 Configuration

### Shopify App Setup
1. Create a Shopify app in your Partner Dashboard
2. Configure webhook URLs: `https://your-domain.com/api/webhooks/shopify`
3. Set required scopes in environment variables
4. Configure app bridge URLs for embedded apps

### Supabase Setup
1. Create a new Supabase project
2. Run the provided SQL migrations
3. Configure Row Level Security policies
4. Set up service role keys for admin operations

### Environment Variables
```env
# Shopify
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret
HOST_URL=https://your-app-domain.com

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
SUPABASE_ANON_KEY=your_anon_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# Carriers
UPS_API_KEY=your_ups_key
FEDEX_API_KEY=your_fedex_key
USPS_API_KEY=your_usps_key
```

## 📊 API Endpoints

### Authentication
- `GET /api/auth/shopify` - Begin OAuth flow
- `GET /api/auth/shopify/callback` - OAuth callback
- `GET /api/auth/shop` - Get shop information

### Webhooks
- `POST /api/webhooks/shopify` - Shopify webhook handler
- `GET /api/webhooks/status/:shopDomain` - Webhook status
- `POST /api/webhooks/retry/:eventId` - Retry failed webhook

### Dashboard
- `GET /api/dashboard/overview` - Dashboard metrics
- `GET /api/dashboard/orders` - Order management
- `GET /api/dashboard/upsells` - Upsell performance
- `GET /api/dashboard/tracking` - Tracking information
- `GET /api/dashboard/returns` - Returns management

### Analytics
- `GET /api/dashboard/analytics/customer-journey` - Customer journey analytics
- `GET /api/dashboard/analytics/revenue` - Revenue analytics

### Engines
- `POST /api/engines/upsell/trigger/:orderId` - Manual upsell trigger
- `POST /api/engines/tracking/trigger/:orderId` - Manual tracking trigger
- `GET /api/engines/status` - Engine status overview

## 🔄 Automated Processes

### Scheduled Tasks
- **Tracking Poll**: Every 30 minutes
- **Webhook Processing**: Every 5 minutes
- **Data Cleanup**: Daily at 2 AM
- **Health Checks**: Hourly

### Webhook Events
- `orders/create` - New order processing
- `orders/updated` - Order status changes
- `orders/cancelled` - Cancellation handling
- `fulfillments/create` - Shipping initialization
- `fulfillments/updated` - Tracking updates
- `returns/create` - Return processing

## 🛡 Security Features

- **Row Level Security** - Multi-tenant data isolation
- **JWT Authentication** - Secure session management
- **Webhook Verification** - HMAC signature validation
- **Rate Limiting** - API abuse prevention
- **Input Validation** - Request sanitization
- **Error Handling** - Secure error responses

## 📈 Monitoring & Logging

### Log Levels
- **Error**: System errors and failures
- **Warn**: Warning conditions
- **Info**: General operational information
- **Debug**: Detailed debugging information

### Health Checks
- Database connectivity
- Memory usage monitoring
- Active job status
- API response times

## 🔍 Database Schema

### Core Tables
- `shops` - Multi-tenant shop information
- `orders` - Order data and metadata
- `webhook_events` - Event processing queue
- `customer_journeys` - Customer lifecycle tracking
- `upsells` - AI-powered offer management
- `tracking_info` - Shipping and delivery data
- `returns` - Return processing and credit offers

### Relationships
- Shops → Orders (1:N)
- Orders → Line Items (1:N)
- Orders → Customer Journeys (1:1)
- Orders → Upsells (1:N)
- Orders → Tracking Info (1:N)
- Orders → Returns (1:N)

## 🚀 Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates installed
- [ ] Monitoring and alerting setup
- [ ] Backup strategies implemented
- [ ] Load balancing configured
- [ ] Error tracking integrated

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Check the documentation
- Review the API endpoints
- Examine the logs for errors
- Create an issue with detailed information

## 🔄 Version History

- **v1.0.0** - Initial release with core functionality
  - Shopify OAuth integration
  - Webhook processing
  - AI-powered upsells
  - Real-time tracking
  - Returns management
  - Merchant dashboard
