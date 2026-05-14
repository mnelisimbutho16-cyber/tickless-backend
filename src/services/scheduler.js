const cron = require('node-cron');
const logger = require('../utils/logger');
const { pollTrackingUpdates } = require('./trackingEngine');
const { processUnprocessedEvents, cleanupOldEvents } = require('./webhookProcessor');

class Scheduler {
  constructor() {
    this.jobs = new Map();
  }

  start() {
    logger.info('Starting scheduler service...');

    // Poll tracking updates every 30 minutes
    this.scheduleJob('tracking-poll', '*/30 * * * *', async () => {
      try {
        logger.info('Running scheduled tracking poll...');
        await pollTrackingUpdates();
        logger.info('Tracking poll completed');
      } catch (error) {
        logger.error('Scheduled tracking poll failed:', error);
      }
    });

    // Process unprocessed webhook events every 5 minutes
    this.scheduleJob('webhook-processor', '*/5 * * * *', async () => {
      try {
        logger.info('Running scheduled webhook processing...');
        await processUnprocessedEvents();
        logger.info('Webhook processing completed');
      } catch (error) {
        logger.error('Scheduled webhook processing failed:', error);
      }
    });

    // Cleanup old events daily at 2 AM
    this.scheduleJob('cleanup', '0 2 * * *', async () => {
      try {
        logger.info('Running scheduled cleanup...');
        await cleanupOldEvents();
        logger.info('Cleanup completed');
      } catch (error) {
        logger.error('Scheduled cleanup failed:', error);
      }
    });

    // Health check every hour
    this.scheduleJob('health-check', '0 * * * *', async () => {
      try {
        logger.info('Running health check...');
        await this.performHealthCheck();
        logger.info('Health check completed');
      } catch (error) {
        logger.error('Health check failed:', error);
      }
    });

    logger.info(`Scheduler started with ${this.jobs.size} jobs`);
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
    
    logger.info(`Scheduled job: ${name} (${cronExpression})`);
    return job;
  }

  stopJob(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.stop();
      this.jobs.delete(name);
      logger.info(`Stopped job: ${name}`);
    }
  }

  stopAll() {
    logger.info('Stopping all scheduled jobs...');
    this.jobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    });
    this.jobs.clear();
    logger.info('All jobs stopped');
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

  async performHealthCheck() {
    const supabase = require('../config/supabase').getSupabaseAdminClient();
    
    try {
      // Check database connection
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

      // Log health metrics
      logger.info('Health check metrics:', {
        uptime: Math.round(process.uptime()),
        memory: memUsageMB,
        activeJobs: this.jobs.size,
        database: 'connected'
      });

      // Alert if memory usage is high (>500MB)
      if (memUsageMB.heapUsed > 500) {
        logger.warn('High memory usage detected:', memUsageMB);
      }

    } catch (error) {
      logger.error('Health check failed:', error);
      throw error;
    }
  }
}

// Create singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;
