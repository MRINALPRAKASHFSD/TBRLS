import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  adminApiKey: string;
  checkApiKey: string;
  databaseUrl: string;
  databaseSsl: boolean;
  databasePoolMin: number;
  databasePoolMax: number;
  databaseConnectionTimeoutMs: number;
  defaultPolicyType: 'TOKEN_BUCKET' | 'SLIDING_WINDOW';
  defaultBucketCapacity: number;
  defaultBucketRefillRate: number;
  defaultWindowLimit: number;
  defaultWindowDurationSeconds: number;
}

export const KNOWN_PLACEHOLDERS = new Set([
  'tbrls-admin-dev-secret-key-change-me',
  'tbrls-check-dev-secret-key-change-me',
  'change-me',
  'changeme',
  'secret',
  'admin',
  'placeholder',
  'password',
  'default',
  'test',
]);

export function isPlaceholderKey(key: string): boolean {
  if (!key || key.trim().length === 0) return true;
  const normalized = key.trim().toLowerCase();
  if (KNOWN_PLACEHOLDERS.has(normalized)) return true;
  if (normalized.includes('change-me') || normalized.includes('changeme')) return true;
  return false;
}

export function validateConfig(cfg: AppConfig): void {
  if (cfg.nodeEnv === 'production') {
    if (!cfg.adminApiKey || cfg.adminApiKey.trim().length === 0 || isPlaceholderKey(cfg.adminApiKey)) {
      throw new Error(
        '[CONFIG ERROR] Insecure production configuration: ADMIN_API_KEY is required and cannot be empty or a known placeholder in production.'
      );
    }
    if (!cfg.checkApiKey || cfg.checkApiKey.trim().length === 0 || isPlaceholderKey(cfg.checkApiKey)) {
      throw new Error(
        '[CONFIG ERROR] Insecure production configuration: CHECK_API_KEY is required and cannot be empty or a known placeholder in production.'
      );
    }
  }
}

function parseNumber(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = Number(envVar);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  // In production, do not provide default fallback placeholders
  const adminApiKey = env.ADMIN_API_KEY ?? (isProd ? '' : 'tbrls-admin-dev-secret-key-change-me');
  const checkApiKey = env.CHECK_API_KEY ?? (isProd ? '' : 'tbrls-check-dev-secret-key-change-me');

  const cfg: AppConfig = {
    port: parseNumber(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    nodeEnv,
    logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
    adminApiKey,
    checkApiKey,
    databaseUrl: env.DATABASE_URL || 'postgres://localhost:5432/tbrls_dev',
    databaseSsl:
      env.DATABASE_SSL === 'true' ||
      Boolean(env.DATABASE_URL && (env.DATABASE_URL.includes('supabase.co') || env.DATABASE_URL.includes('sslmode=require'))),
    databasePoolMin: parseNumber(env.DATABASE_POOL_MIN, 2),
    databasePoolMax: parseNumber(env.DATABASE_POOL_MAX, 20),
    databaseConnectionTimeoutMs: parseNumber(env.DATABASE_CONNECTION_TIMEOUT_MS, 5000),
    defaultPolicyType: (env.DEFAULT_POLICY_TYPE === 'SLIDING_WINDOW' ? 'SLIDING_WINDOW' : 'TOKEN_BUCKET'),
    defaultBucketCapacity: parseNumber(env.DEFAULT_BUCKET_CAPACITY, 10),
    defaultBucketRefillRate: parseNumber(env.DEFAULT_BUCKET_REFILL_RATE, 2.0),
    defaultWindowLimit: parseNumber(env.DEFAULT_WINDOW_LIMIT, 60),
    defaultWindowDurationSeconds: parseNumber(env.DEFAULT_WINDOW_DURATION_SECONDS, 60),
  };

  validateConfig(cfg);
  return cfg;
}

export const config = loadConfig();
