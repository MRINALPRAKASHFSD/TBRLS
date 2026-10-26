import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';

const { Pool } = pg;

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/tbrls_test';

export const testPool = new Pool({
  connectionString: TEST_DATABASE_URL,
  min: 1,
  max: 20,
  connectionTimeoutMillis: 5000,
});

export async function setupTestDatabase(): Promise<void> {
  await runMigrations(TEST_DATABASE_URL);
}

export async function cleanTestDatabase(): Promise<void> {
  const client = await testPool.connect();
  try {
    // Truncating client_policies cascades to token_bucket_states and sliding_window_requests
    await client.query('TRUNCATE TABLE client_policies CASCADE;');
  } finally {
    client.release();
  }
}

export async function closeTestPool(): Promise<void> {
  await testPool.end();
}
