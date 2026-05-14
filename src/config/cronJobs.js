const cron = require('node-cron');
const logger = require('../utils/logger');
const { pollTrackingUpdates } = require('../services/trackingEngine');
const { processUnprocessedEvents, cleanupOldEvents } = require('../services/webhookProcessor');
const { getSupabaseAdminClient } = require('../config/supabase');

class CronJobManager {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Cron jobs already running');
      return;
    }

    logger.info('Starting cron job manager...');

    // Poll tracking updates every 30 minutes
    this.scheduleJob('tracking-poll', '*/30 * * * *', async () => {
      await this.executeJob('tracking-poll', async () => {
        logger.info('Executing tracking poll job');
        await pollTrackingUpdates();
        logger.info('Tracking poll job completed');
      });
    });

    // Process unprocessed webhook events every 5 minutes
    this.scheduleJob('webhook-processor', '*/5 * * * *', async () => {
      await this.executeJob('webhook-processor', async () => {
        logger.info('Executing webhook processor job');
        await processUnprocessedEvents();
        logger.info('Webhook processor job completed');
      });
    });

    // Cleanup old events daily at 2 AM UTC
    this.scheduleJob('cleanup', '0 2 * * *', async () => {
      await this.executeJob('cleanup', async () => {
        logger.info('Executing cleanup job');
        await cleanupOldEvents();
        await this.performSystemCleanup();
        logger.info('Cleanup job completed');
      });
    });

    // Health check every hour
    this.scheduleJob('health-check', '0 * * * *', async () => {
      await this.executeJob('health-check', async () => {
        logger.info('Executing health check job');
        await this.performHealthCheck();
        logger.info('Health check job completed');
      });
    });

    // Analytics aggregation every 6 hours
    this.scheduleJob('analytics-aggregation', '0 */6 * * *', async () => {
      await this.executeJob('analytics-aggregation', async () => {
        logger.info('Executing analytics aggregation job');
        await this.aggregateAnalytics();
        logger.info('Analytics aggregation job completed');
      });
    });

    // Upsell expiration check every hour
    this.scheduleJob('upsell-expiration', '0 * * * *', async () => {
      await this.executeJob('upsell-expiration', async () => {
        logger.info('Executing upsell expiration check');
        await this.checkUpsellExpirations();
        logger.info('Upsell expiration check completed');
      });
    });

    // Return credit expiration check daily
    this.scheduleJob('return-credit-expiration', '0 3 * * *', async () => {
      await this.executeJob('return-credit-expiration', async () => {
        logger.info('Executing return credit expiration check');
        await this.checkReturnCreditExpirations();
        logger.info('Return credit expiration check completed');
      });
    });

    this.isRunning = true;
    logger.info(`Cron job manager started with ${this.jobs.size} jobs`);
  }

  scheduleJob(name, cronExpression, task) {
    if (this.jobs.has(name)) {
      logger.warn(`Job ${name} already exists, stopping it first`);
      this.stopJob(name);
    }

    const job = cron.schedule(cronExpression, task, {
      scheduled: false,
      timezone: 'UTC'
    });

    job.start();
    this.jobs.set(name, job);
    
    logger.info(`Scheduled cron job: ${name} (${cronExpression})`);
    return job;
  }

  stopJob(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.stop();
      this.jobs.delete(name);
      logger.info(`Stopped cron job: ${name}`);
    }
  }

  stopAll() {
    logger.info('Stopping all cron jobs...');
    this.jobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    });
    this.jobs.clear();
    this.isRunning = false;
    logger.info('All cron jobs stopped');
  }

  async executeJob(jobName, task) {
    const startTime = Date.now();
    
    try {
      await task();
      
      const duration = Date.now() - startTime;
      logger.info(`Cron job ${jobName} completed successfully in ${duration}ms`);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Cron job ${jobName} failed after ${duration}ms:`, error);
      
      // Send alert for failed jobs (in production, integrate with monitoring service)
      await this.sendJobFailureAlert(jobName, error);
    }
  }

  async performHealthCheck() {
    const supabase = getSupabaseAdminClient();
    
    try {
      // Check database connectivity
      const { data, error } = await supabase
        .from('shops')
        .select('count')
        .limit(1);

      if (error) {
        throw new Error(`Database connection failed: ${error.message}`);
      }

      // Check memory usage
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      };

      // Check disk space (simplified)
      const stats = require('fs').statSync('.');
      
      // Log health metrics
      logger.info('Health check metrics:', {
        uptime: Math.round(process.uptime()),
        memory: memUsageMB,
        activeJobs: this.jobs.size,
        database: 'connected',
        nodeVersion: process.version,
        platform: process.platform
      });

      // Alert if memory usage is high
      if (memUsageMB.heapUsed > 500) {
        logger.warn('High memory usage detected:', memUsageMB);
      }

      // Store health metrics for monitoring
      await this.storeHealthMetrics({
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: memUsageMB,
        activeJobs: this.jobs.size,
        databaseStatus: 'connected'
      });

    } catch (error) {
      logger.error('Health check failed:', error);
      throw error;
    }
  }

  async performSystemCleanup() {
    const supabase = getSupabaseAdminClient();
    
    try {
      // Clean up expired sessions
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { error: sessionError } = await supabase
        .from('user_sessions')
        .delete()
        .lt('created_at', thirtyDaysAgo.toISOString());

      if (sessionError) throw sessionError;

      // Clean up old tracking events (keep last 100 per tracking)
      const { data: trackingIds } = await supabase
        .from('tracking_info')
        .select('id');

      if (trackingIds) {
        for (const tracking of trackingIds) {
          const { error: eventError } = await supabase
            .from('tracking_events')
            .delete()
            .eq('tracking_id', tracking.id)
            .order('created_at', { ascending: false })
            .range(100, 999999); // Keep only 100 most recent events

          if (eventError) throw eventError;
        }
      }

      logger.info('System cleanup completed');

    } catch (error) {
      logger.error('System cleanup failed:', error);
      throw error;
    }
  }

  async aggregateAnalytics() {
    const supabase = getSupabaseAdminClient();
    
    try {
      // Aggregate daily metrics
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
      const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();

      // Get daily order metrics
      const { data: orders, error: orderError } = await supabase
        .from('orders')
        .select('shop_domain, total_price, created_at')
        .gte('created_at', yesterdayStart)
        .lte('created_at', yesterdayEnd);

      if (orderError) throw orderError;

      // Aggregate by shop
      const shopMetrics = {};
      orders?.forEach(order => {
        if (!shopMetrics[order.shop_domain]) {
          shopMetrics[order.shop_domain] = {
            orderCount: 0,
            totalRevenue: 0
          };
        }
        shopMetrics[order.shop_domain].orderCount++;
        shopMetrics[order.shop_domain].totalRevenue += order.total_price || 0;
      });

      // Store aggregated metrics
      for (const [shopDomain, metrics] of Object.entries(shopMetrics)) {
        await supabase
          .from('daily_metrics')
          .upsert({
            shop_domain: shopDomain,
            date: yesterdayStart.split('T')[0],
            order_count: metrics.orderCount,
            total_revenue: metrics.totalRevenue,
            created_at: new Date().toISOString()
          });
      }

      logger.info(`Analytics aggregation completed for ${Object.keys(shopMetrics).length} shops`);

    } catch (error) {
      logger.error('Analytics aggregation failed:', error);
      throw error;
    }
  }

  async checkUpsellExpirations() {
    const supabase = getSupabaseAdminClient();
    
    try {
      // Get expired upsells
      const now = new Date().toISOString();
      
      const { data: expiredUpsells, error } = await supabase
        .from('upsells')
        .select('*')
        .lt('expires_at', now)
        .eq('status', 'pending');

      if (error) throw error;

      // Mark expired upsells
      for (const upsell of expiredUpsells || []) {
        await supabase
          .from('upsells')
          .update({
            status: 'expired',
            updated_at: new Date().toISOString()
          })
          .eq('id', upsell.id);
      }

      if (expiredUpsells?.length > 0) {
        logger.info(`Marked ${expiredUpsells.length} upsells as expired`);
      }

    } catch (error) {
      logger.error('Upsell expiration check failed:', error);
      throw error;
    }
  }

  async checkReturnCreditExpirations() {
    const supabase = getSupabaseAdminClient();
    
    try {
      // Get expired return credits
      const now = new Date().toISOString();
      
      const { data: expiredCredits, error } = await supabase
        .from('return_processing')
        .select('*')
        .lt('credit_offer_expires_at', now)
        .eq('status', 'pending');

      if (error) throw error;

      // Mark expired credits
      for (const credit of expiredCredits || []) {
        await supabase
          .from('return_processing')
          .update({
            status: 'credit_expired',
            updated_at: new Date().toISOString()
          })
          .eq('id', credit.id);
      }

      if (expiredCredits?.length > 0) {
        logger.info(`Marked ${expiredCredits.length} return credits as expired`);
      }

    } catch (error) {
      logger.error('Return credit expiration check failed:', error);
      throw error;
    }
  }

  async storeHealthMetrics(metrics) {
    const supabase = getSupabaseAdminClient();
    
    try {
      await supabase
        .from('health_metrics')
        .insert(metrics);
    } catch (error) {
      logger.error('Failed to store health metrics:', error);
      // Don't throw - health check failure shouldn't break the system
    }
  }

  async sendJobFailureAlert(jobName, error) {
    try {
      // In production, integrate with monitoring service like PagerDuty, Slack, etc.
      logger.error(`ALERT: Cron job ${jobName} failed`, {
        jobName,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      // For now, just log - in production send to alerting system
    } catch (alertError) {
      logger.error('Failed to send job failure alert:', alertError);
    }
  }

  getJobStatus() {
    const status = {};
    this.jobs.forEach((job, name) => {
      status[name] = {
        running: job.running,
        nextDate: job.nextDate()?.toISOString(),
        lastDate: job.lastDate()?.toISOString()
      };
    });
    return status;
  }

  getRunningJobsCount() {
    return this.jobs.size;
  }
}

// Create singleton instance
const cronJobManager = new CronJobManager();

module.exports = cronJobManager;
