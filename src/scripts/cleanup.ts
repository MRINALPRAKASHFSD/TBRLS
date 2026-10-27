import pg from 'pg';
import { loadConfig } from '../config.js';
import { RateLimiterService } from '../limiter/rate-limiter-service.js';

async function main() {
  const cfg = loadConfig();
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    connectionTimeoutMillis: cfg.databaseConnectionTimeoutMs,
  });

  const limiter = new RateLimiterService(pool);
  const args = process.argv.slice(2);

  const doSlidingWindow = args.includes('--sliding-window') || args.includes('--all') || (!args.includes('--metrics') && !args.includes('--sliding-window'));
  const doMetrics = args.includes('--metrics') || args.includes('--all') || (!args.includes('--metrics') && !args.includes('--sliding-window'));

  const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? Number(batchSizeArg.split('=')[1]) : 5000;

  const maxBatchesArg = args.find((a) => a.startsWith('--max-batches='));
  const maxBatches = maxBatchesArg ? Number(maxBatchesArg.split('=')[1]) : 100;

  const retentionHoursArg = args.find((a) => a.startsWith('--retention-hours='));
  const retentionHours = retentionHoursArg ? Number(retentionHoursArg.split('=')[1]) : 24;

  console.log('[CLEANUP] Starting TBRLS database maintenance cleanup task...');

  try {
    if (doSlidingWindow) {
      console.log(`[CLEANUP] Pruning expired sliding-window requests (batchSize=${batchSize}, maxBatches=${maxBatches})...`);
      const { totalDeleted, batchesExecuted } = await limiter.pruneExpiredSlidingWindowRequests({
        batchSize,
        maxBatches,
        defaultWindowSeconds: cfg.defaultWindowDurationSeconds,
      });
      console.log(`[CLEANUP] Successfully deleted ${totalDeleted} expired sliding-window records across ${batchesExecuted} batches.`);
    }

    if (doMetrics) {
      console.log(`[CLEANUP] Pruning rate limit metrics older than ${retentionHours} hours...`);
      const { deletedCount } = await limiter.pruneMetrics(retentionHours);
      console.log(`[CLEANUP] Successfully deleted ${deletedCount} historical metric records.`);
    }

    console.log('[CLEANUP] Maintenance completed successfully.');
  } catch (err) {
    console.error('[CLEANUP ERROR] Failed to complete maintenance cleanup:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
