# Deployment Guide

## Production Deployment Checklist

### 1. Environment Setup
- [ ] Configure production environment variables
- [ ] Set up SSL certificates
- [ ] Configure domain and DNS
- [ ] Set up monitoring and alerting

### 2. Database Setup
- [ ] Create Supabase project
- [ ] Run database migrations
- [ ] Configure Row Level Security
- [ ] Set up backup strategies
- [ ] Test database connections

### 3. Shopify App Configuration
- [ ] Create Shopify Partner app
- [ ] Configure app URLs and webhooks
- [ ] Set up app bridge for embedded apps
- [ ] Configure required scopes
- [ ] Test OAuth flow

### 4. External Services
- [ ] Configure OpenAI API key
- [ ] Set up carrier API credentials (UPS, FedEx, USPS)
- [ ] Configure email service (SendGrid, Mailgun)
- [ ] Set up Redis for distributed rate limiting

### 5. Security Configuration
- [ ] Enable HTTPS
- [ ] Configure CORS properly
- [ ] Set up rate limiting
- [ ] Configure security headers
- [ ] Test authentication flows

### 6. Monitoring & Logging
- [ ] Set up log aggregation
- [ ] Configure error tracking
- [ ] Set up performance monitoring
- [ ] Configure health checks
- [ ] Set up alerting rules

## Docker Deployment

### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Set permissions
RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start application
CMD ["npm", "start"]
```

### docker-compose.yml
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    env_file:
      - .env.production
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

### Health Check Script (healthcheck.js)
```javascript
const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => {
  process.exit(1);
});

req.on('timeout', () => {
  process.exit(1);
});

req.end();
```

## Environment Variables

### Production (.env.production)
```env
# Application
NODE_ENV=production
PORT=3000
HOST_URL=https://your-app-domain.com

# Shopify
SHOPIFY_API_KEY=your_production_api_key
SHOPIFY_API_SECRET=your_production_api_secret
SHOPIFY_WEBHOOK_SECRET=your_production_webhook_secret
SHOPIFY_SCOPES=read_orders,write_orders,read_products,read_customers,write_customers,read_fulfillments,write_fulfillments,read_inventory,write_inventory

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# JWT
JWT_SECRET=your_strong_jwt_secret

# Carriers
UPS_API_KEY=your_ups_api_key
FEDEX_API_KEY=your_fedex_api_key
USPS_API_KEY=your_usps_api_key

# Email Service
EMAIL_SERVICE_API_KEY=your_email_service_key
EMAIL_FROM_ADDRESS=noreply@your-domain.com

# Redis (optional)
REDIS_URL=redis://localhost:6379

# Monitoring
LOG_LEVEL=info
SENTRY_DSN=your_sentry_dsn
```

## Deployment Steps

### 1. Build and Deploy
```bash
# Build Docker image
docker build -t shopify-post-purchase-backend .

# Run with docker-compose
docker-compose up -d

# Or run standalone
docker run -d \
  --name shopify-backend \
  -p 3000:3000 \
  --env-file .env.production \
  shopify-post-purchase-backend
```

### 2. Database Migration
```bash
# Run migrations
npm run migrate

# Or run directly with node
node src/database/migrate.js
```

### 3. Verify Deployment
```bash
# Check health endpoint
curl https://your-app-domain.com/health

# Check logs
docker logs shopify-backend
```

## Monitoring Setup

### 1. Application Monitoring
- Set up Prometheus metrics endpoint
- Configure Grafana dashboards
- Set up alerting rules

### 2. Error Tracking
- Configure Sentry or similar service
- Set up error notifications
- Track performance metrics

### 3. Log Management
- Set up log aggregation (ELK stack)
- Configure log rotation
- Set up log-based alerts

## Performance Optimization

### 1. Database Optimization
- Add database indexes
- Optimize query performance
- Set up connection pooling

### 2. Caching Strategy
- Implement Redis caching
- Cache frequently accessed data
- Set up CDN for static assets

### 3. Load Balancing
- Set up multiple app instances
- Configure load balancer
- Implement health checks

## Security Considerations

### 1. Network Security
- Use HTTPS everywhere
- Configure firewall rules
- Set up VPN for admin access

### 2. Application Security
- Validate all inputs
- Sanitize outputs
- Implement rate limiting

### 3. Data Protection
- Encrypt sensitive data
- Set up data backups
- Configure access controls

## Backup Strategy

### 1. Database Backups
- Daily automated backups
- Point-in-time recovery
- Cross-region replication

### 2. Application Backups
- Code repository backups
- Configuration backups
- Asset backups

## Scaling Considerations

### 1. Horizontal Scaling
- Multiple app instances
- Database read replicas
- Distributed caching

### 2. Vertical Scaling
- Increase server resources
- Optimize database performance
- Monitor resource usage

## Troubleshooting

### Common Issues
1. **Database Connection Errors**
   - Check connection strings
   - Verify network connectivity
   - Check database status

2. **Webhook Failures**
   - Verify webhook URLs
   - Check HMAC signatures
   - Review error logs

3. **Performance Issues**
   - Monitor resource usage
   - Check database queries
   - Review application logs

### Debug Commands
```bash
# Check application logs
docker logs shopify-backend

# Check database connectivity
npm run health-check

# Test webhook endpoint
curl -X POST https://your-domain.com/api/webhooks/test

# Check cron jobs
curl https://your-domain.com/api/engines/status
```

## Maintenance

### Regular Tasks
- Update dependencies
- Review security patches
- Monitor performance metrics
- Clean up old data
- Test backup procedures

### Update Process
1. Create backup
2. Deploy new version
3. Run migrations if needed
4. Verify functionality
5. Monitor for issues
