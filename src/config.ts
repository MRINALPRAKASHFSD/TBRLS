import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  adminApiKey: string;
  databaseUrl: string;
  databasePoolMin: number;
  databasePoolMax: number;
  databaseConnectionTimeoutMs: number;
  defaultPolicyType: 'TOKEN_BUCKET' | 'SLIDING_WINDOW';
  defaultBucketCapacity: number;
  defaultBucketRefillRate: number;
  defaultWindowLimit: number;
  defaultWindowDurationSeconds: number;
}

function parseNumber(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = Number(envVar);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function loadConfig(): AppConfig {
  const adminApiKey = process.env.ADMIN_API_KEY || 'tbrls-admin-dev-secret-key-change-me';

  return {
    port: parseNumber(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    adminApiKey,
    databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/tbrls_dev',
    databasePoolMin: parseNumber(process.env.DATABASE_POOL_MIN, 2),
    databasePoolMax: parseNumber(process.env.DATABASE_POOL_MAX, 20),
    databaseConnectionTimeoutMs: parseNumber(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 5000),
    defaultPolicyType: (process.env.DEFAULT_POLICY_TYPE === 'SLIDING_WINDOW' ? 'SLIDING_WINDOW' : 'TOKEN_BUCKET'),
    defaultBucketCapacity: parseNumber(process.env.DEFAULT_BUCKET_CAPACITY, 10),
    defaultBucketRefillRate: parseNumber(process.env.DEFAULT_BUCKET_REFILL_RATE, 2.0),
    defaultWindowLimit: parseNumber(process.env.DEFAULT_WINDOW_LIMIT, 60),
    defaultWindowDurationSeconds: parseNumber(process.env.DEFAULT_WINDOW_DURATION_SECONDS, 60),
  };
}

export const config = loadConfig();
