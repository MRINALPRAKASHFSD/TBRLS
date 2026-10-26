import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closeDatabasePool } from './db/pool.js';

async function startServer(): Promise<void> {
  console.log('[TBRLS] Starting Token Bucket Rate Limiter Service...');

  // Automatically ensure database schema migrations are applied on boot
  try {
    const applied = await runMigrations();
    if (applied.length > 0) {
      console.log(`[TBRLS] Applied ${applied.length} pending database migrations.`);
    } else {
      console.log('[TBRLS] Database schema is up-to-date.');
    }
  } catch (err) {
    console.error('[TBRLS FATAL] Database migration failure on boot:', err);
    process.exit(1);
  }

  const app = buildApp();

  // Handle graceful process termination
  const shutdown = async (signal: string) => {
    console.log(`[TBRLS] Received ${signal}. Initiating graceful shutdown...`);
    try {
      await app.close();
      await closeDatabasePool();
      console.log('[TBRLS] Server and database pool cleanly closed.');
      process.exit(0);
    } catch (err) {
      console.error('[TBRLS] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    const address = await app.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[TBRLS] HTTP Server listening on ${address}`);
  } catch (err) {
    console.error('[TBRLS FATAL] Failed to bind HTTP server:', err);
    process.exit(1);
  }
}

startServer();
