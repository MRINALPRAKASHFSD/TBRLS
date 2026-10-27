import { describe, expect, it } from 'vitest';
import { isPlaceholderKey, loadConfig, validateConfig } from '../../src/config.js';

describe('Configuration & Production Validation (Unit Tests)', () => {
  describe('isPlaceholderKey', () => {
    it('identifies known placeholder strings and patterns', () => {
      expect(isPlaceholderKey('')).toBe(true);
      expect(isPlaceholderKey('   ')).toBe(true);
      expect(isPlaceholderKey('tbrls-admin-dev-secret-key-change-me')).toBe(true);
      expect(isPlaceholderKey('tbrls-check-dev-secret-key-change-me')).toBe(true);
      expect(isPlaceholderKey('change-me')).toBe(true);
      expect(isPlaceholderKey('changeme')).toBe(true);
      expect(isPlaceholderKey('my-secret-changeme-key')).toBe(true);
      expect(isPlaceholderKey('admin')).toBe(true);
      expect(isPlaceholderKey('password')).toBe(true);
    });

    it('returns false for strong production secrets', () => {
      expect(isPlaceholderKey('k9#mP$2vL8!zQ7xR4wT1yU6iO3sA5dF0')).toBe(false);
      expect(isPlaceholderKey('prod-svc-check-839210-live-sec')).toBe(false);
      expect(isPlaceholderKey('prod-admin-948172-live-sec')).toBe(false);
    });
  });

  describe('Production Environment Validation', () => {
    it('refuses to start in production if ADMIN_API_KEY is missing or empty', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          CHECK_API_KEY: 'prod-check-key-xyz-1234567890',
        })
      ).toThrow(/Insecure production configuration: ADMIN_API_KEY is required/);

      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          ADMIN_API_KEY: '   ',
          CHECK_API_KEY: 'prod-check-key-xyz-1234567890',
        })
      ).toThrow(/Insecure production configuration: ADMIN_API_KEY is required/);
    });

    it('refuses to start in production if ADMIN_API_KEY is a placeholder', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          ADMIN_API_KEY: 'tbrls-admin-dev-secret-key-change-me',
          CHECK_API_KEY: 'prod-check-key-xyz-1234567890',
        })
      ).toThrow(/Insecure production configuration: ADMIN_API_KEY is required and cannot be empty or a known placeholder/);
    });

    it('refuses to start in production if CHECK_API_KEY is missing or empty', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          ADMIN_API_KEY: 'prod-admin-key-abc-1234567890',
        })
      ).toThrow(/Insecure production configuration: CHECK_API_KEY is required/);

      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          ADMIN_API_KEY: 'prod-admin-key-abc-1234567890',
          CHECK_API_KEY: '',
        })
      ).toThrow(/Insecure production configuration: CHECK_API_KEY is required/);
    });

    it('refuses to start in production if CHECK_API_KEY is a placeholder', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          ADMIN_API_KEY: 'prod-admin-key-abc-1234567890',
          CHECK_API_KEY: 'tbrls-check-dev-secret-key-change-me',
        })
      ).toThrow(/Insecure production configuration: CHECK_API_KEY is required and cannot be empty or a known placeholder/);
    });

    it('loads successfully in production when both keys are strong custom secrets', () => {
      const cfg = loadConfig({
        NODE_ENV: 'production',
        ADMIN_API_KEY: 'prod-admin-key-abc-1234567890',
        CHECK_API_KEY: 'prod-check-key-xyz-1234567890',
        PORT: '8080',
      });

      expect(cfg.nodeEnv).toBe('production');
      expect(cfg.adminApiKey).toBe('prod-admin-key-abc-1234567890');
      expect(cfg.checkApiKey).toBe('prod-check-key-xyz-1234567890');
      expect(cfg.port).toBe(8080);
    });
  });

  describe('Development and Test Defaults', () => {
    it('permits default local development placeholders when NODE_ENV is development', () => {
      const cfg = loadConfig({
        NODE_ENV: 'development',
      });

      expect(cfg.nodeEnv).toBe('development');
      expect(cfg.adminApiKey).toBe('tbrls-admin-dev-secret-key-change-me');
      expect(cfg.checkApiKey).toBe('tbrls-check-dev-secret-key-change-me');
    });

    it('permits default local placeholders when NODE_ENV is test', () => {
      const cfg = loadConfig({
        NODE_ENV: 'test',
      });

      expect(cfg.nodeEnv).toBe('test');
      expect(cfg.adminApiKey).toBe('tbrls-admin-dev-secret-key-change-me');
      expect(cfg.checkApiKey).toBe('tbrls-check-dev-secret-key-change-me');
    });

    it('detects and enables databaseSsl for remote Supabase and SSL URLs', () => {
      const localCfg = loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://localhost:5432/tbrls_dev',
      });
      expect(localCfg.databaseSsl).toBe(false);

      const supabaseCfg = loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:pass@db.kbkchutjljieqavhrviw.supabase.co:5432/postgres',
      });
      expect(supabaseCfg.databaseSsl).toBe(true);

      const sslParamCfg = loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:pass@remotehost:5432/postgres?sslmode=require',
      });
      expect(sslParamCfg.databaseSsl).toBe(true);

      const explicitSslCfg = loadConfig({
        NODE_ENV: 'development',
        DATABASE_SSL: 'true',
      });
      expect(explicitSslCfg.databaseSsl).toBe(true);
    });
  });
});
