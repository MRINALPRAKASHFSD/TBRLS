import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  min: config.databasePoolMin,
  max: config.databasePoolMax,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // Catch idle client pool errors without crashing unhandled
  console.error('[DB POOL ERROR] Unexpected error on idle client:', err.message);
});

/**
 * Executes a simple query to verify active PostgreSQL database connectivity.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1;');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

/**
 * Safely drains and closes all pool connections during shutdown.
 */
export async function closeDatabasePool(): Promise<void> {
  await pool.end();
}
