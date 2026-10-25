import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { RateLimiterService } from '../../src/limiter/rate-limiter-service.js';
import { cleanTestDatabase, closeTestPool, setupTestDatabase, testPool } from '../helpers/test-db.js';

describe('API Integration Tests (Fastify + PostgreSQL)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDatabase();
    app = buildApp({ poolOverride: testPool, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    await closeTestPool();
  });

  beforeEach(async () => {
    await cleanTestDatabase();
  });

  describe('Health Probes', () => {
    it('GET /healthz returns 200 ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('ok');
    });

    it('GET /readyz returns 200 ready when DB is connected', async () => {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('ready');
      expect(body.database).toBe('connected');
    });
  });

  describe('POST /v1/check Authentication & Authorization', () => {
    it('rejects check request without credentials with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { clientKey: 'client-no-auth', cost: 1 },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toContain('Valid check credentials required');
    });

    it('rejects check request with invalid CHECK_API_KEY with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': 'wrong-check-key' },
        payload: { clientKey: 'client-bad-auth', cost: 1 },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Unauthorized');
    });

    it('accepts check request with Authorization: Bearer <CHECK_API_KEY>', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { Authorization: `Bearer ${config.checkApiKey}` },
        payload: { clientKey: 'client-bearer-auth', cost: 1 },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).decision).toBe('ALLOW');
    });

    it('accepts check request with X-API-Key header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-API-Key': config.checkApiKey },
        payload: { clientKey: 'client-x-api-key', cost: 1 },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).decision).toBe('ALLOW');
    });
  });

  describe('POST /v1/check', () => {
    it('returns ALLOW on first-time client key and populates standard rate limit headers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-test-1', cost: 1 },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.decision).toBe('ALLOW');
      expect(body.policyType).toBe('TOKEN_BUCKET');
      expect(body.limit).toBe(config.defaultBucketCapacity);
      expect(body.remaining).toBe(config.defaultBucketCapacity - 1);

      // Verify headers
      expect(res.headers['ratelimit-limit']).toBe(config.defaultBucketCapacity.toString());
      expect(res.headers['ratelimit-remaining']).toBe((config.defaultBucketCapacity - 1).toString());
      expect(res.headers['ratelimit-reset']).toBeDefined();
      expect(res.headers['retry-after']).toBeUndefined();
    });

    it('denies requests when client quota is exhausted and sets Retry-After header', async () => {
      // First configure client with capacity 2 and refill 0.1 tokens/sec
      await app.inject({
        method: 'PUT',
        url: '/v1/admin/policies/client-small',
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: {
          policyType: 'TOKEN_BUCKET',
          capacity: 2,
          refillRate: 0.1,
        },
      });

      // Request 1: consumes 1 token (1 remaining)
      const r1 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-small', cost: 1 },
      });
      expect(JSON.parse(r1.payload).decision).toBe('ALLOW');

      // Request 2: consumes 1 token (0 remaining)
      const r2 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-small', cost: 1 },
      });
      expect(JSON.parse(r2.payload).decision).toBe('ALLOW');

      // Request 3: should be DENIED
      const r3 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-small', cost: 1 },
      });

      expect(r3.statusCode).toBe(200);
      const body3 = JSON.parse(r3.payload);
      expect(body3.decision).toBe('DENY');
      expect(body3.remaining).toBe(0);
      expect(body3.retryAfter).toBeGreaterThanOrEqual(1);

      expect(r3.headers['ratelimit-remaining']).toBe('0');
      expect(r3.headers['retry-after']).toBeDefined();
    });

    it('rejects invalid clientKey with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'invalid key with spaces!@#$', cost: 1 },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Bad Request');
    });

    it('rejects invalid cost with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-valid', cost: -5 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects impossible cost exceeding token-bucket capacity with 400 Bad Request, no Retry-After, and without deducting tokens', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-impossible-cost', cost: config.defaultBucketCapacity + 50 },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('exceeds client bucket capacity');
      expect(res.headers['retry-after']).toBeUndefined();

      // Ensure tokens were not deducted: subsequent valid check gets full capacity - 1
      const validRes = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-impossible-cost', cost: 1 },
      });
      expect(validRes.statusCode).toBe(200);
      expect(JSON.parse(validRes.payload).remaining).toBe(config.defaultBucketCapacity - 1);
    });

    it('rejects impossible cost exceeding sliding-window limit with 400 Bad Request and no Retry-After', async () => {
      const clientKey = 'client-window-impossible';
      await app.inject({
        method: 'PUT',
        url: `/v1/admin/policies/${clientKey}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: {
          policyType: 'SLIDING_WINDOW',
          windowLimit: 10,
          windowDurationSeconds: 60,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 15 },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('exceeds client sliding window limit');
      expect(res.headers['retry-after']).toBeUndefined();
    });

    it('sliding window denial with cost > 1 sets Retry-After to expiry of required oldest requests', async () => {
      const clientKey = 'client-multi-expire';
      await app.inject({
        method: 'PUT',
        url: `/v1/admin/policies/${clientKey}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: {
          policyType: 'SLIDING_WINDOW',
          windowLimit: 5,
          windowDurationSeconds: 10,
        },
      });

      // Insert 4 requests with staggered timestamps into sliding_window_requests:
      // 8s ago (expires in 2s), 6s ago (expires in 4s), 4s ago (expires in 6s), 2s ago (expires in 8s)
      await testPool.query(`
        INSERT INTO sliding_window_requests (client_key, requested_at) VALUES
          ($1, NOW() - INTERVAL '8 seconds'),
          ($1, NOW() - INTERVAL '6 seconds'),
          ($1, NOW() - INTERVAL '4 seconds'),
          ($1, NOW() - INTERVAL '2 seconds');
      `, [clientKey]);

      // Currently 4 requests in window. Limit is 5.
      // If cost = 3, total required capacity is 4 + 3 = 7.
      // Must drop m = 7 - 5 = 2 oldest requests to fit.
      // The 2nd oldest request was 6s ago, so it expires in ~4s.
      // Retry-After should be approximately 4s.
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 3 },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.decision).toBe('DENY');
      expect(body.retryAfter).toBeGreaterThanOrEqual(3);
      expect(body.retryAfter).toBeLessThanOrEqual(5);
      expect(Number(res.headers['retry-after'])).toBe(body.retryAfter);
    });
  });

  describe('Admin Policy Management (/v1/admin/policies)', () => {
    it('rejects unauthenticated admin calls with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/admin/policies/client-abc',
        payload: {
          policyType: 'TOKEN_BUCKET',
          capacity: 10,
          refillRate: 1.0,
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Unauthorized');
    });

    it('creates and updates a client policy via X-Admin-Key', async () => {
      const putRes = await app.inject({
        method: 'PUT',
        url: '/v1/admin/policies/client-pro',
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: {
          policyType: 'TOKEN_BUCKET',
          capacity: 50,
          refillRate: 10.0,
        },
      });

      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.payload);
      expect(putBody.success).toBe(true);
      expect(putBody.policy.capacity).toBe(50);
      expect(putBody.policy.refillRate).toBe(10);

      // Verify retrieval via GET
      const getRes = await app.inject({
        method: 'GET',
        url: '/v1/admin/policies/client-pro',
        headers: { Authorization: `Bearer ${config.adminApiKey}` },
      });

      expect(getRes.statusCode).toBe(200);
      const getBody = JSON.parse(getRes.payload);
      expect(getBody.found).toBe(true);
      expect(getBody.policy.capacity).toBe(50);
      expect(getBody.state.tokens).toBe(50);
    });

    it('switches a client policy to SLIDING_WINDOW and enforces sliding window checks', async () => {
      const putRes = await app.inject({
        method: 'PUT',
        url: '/v1/admin/policies/client-windowed',
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: {
          policyType: 'SLIDING_WINDOW',
          windowLimit: 2,
          windowDurationSeconds: 10,
        },
      });
      expect(putRes.statusCode).toBe(200);

      // Check 1: Allowed (1 remaining)
      const c1 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-windowed', cost: 1 },
      });
      expect(JSON.parse(c1.payload).decision).toBe('ALLOW');
      expect(JSON.parse(c1.payload).remaining).toBe(1);

      // Check 2: Allowed (0 remaining)
      const c2 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-windowed', cost: 1 },
      });
      expect(JSON.parse(c2.payload).decision).toBe('ALLOW');
      expect(JSON.parse(c2.payload).remaining).toBe(0);

      // Check 3: Denied
      const c3 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-windowed', cost: 1 },
      });
      expect(JSON.parse(c3.payload).decision).toBe('DENY');
      expect(JSON.parse(c3.payload).retryAfter).toBeGreaterThanOrEqual(1);

      // Verify RateLimit-Reset header matches Retry-After on DENY
      expect(c3.headers['retry-after']).toBeDefined();
      expect(c3.headers['ratelimit-reset']).toBe(c3.headers['retry-after']);
    });

    it('sliding window admin state reports only requests that are still inside the configured window', async () => {
      const clientKey = 'client-window-prune-test';
      await app.inject({
        method: 'PUT',
        url: `/v1/admin/policies/${clientKey}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: {
          policyType: 'SLIDING_WINDOW',
          windowLimit: 10,
          windowDurationSeconds: 15,
        },
      });

      // Insert an expired request directly into the test database (60 seconds in the past)
      await testPool.query(
        `INSERT INTO sliding_window_requests (client_key, requested_at) VALUES ($1, NOW() - INTERVAL '60 seconds');`,
        [clientKey]
      );

      // Make 1 valid check request within the active window
      const checkRes = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 1 },
      });
      expect(JSON.parse(checkRes.payload).decision).toBe('ALLOW');

      // GET policy state via admin endpoint
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/admin/policies/${clientKey}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
      });
      expect(getRes.statusCode).toBe(200);
      const getBody = JSON.parse(getRes.payload);
      // Total rows in DB is 2, but only 1 is inside the 15-second window
      expect(getBody.state.requestCount).toBe(1);
    });

    it('deletes a custom client policy and resets state', async () => {
      // First create policy
      await app.inject({
        method: 'PUT',
        url: '/v1/admin/policies/client-to-delete',
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: { policyType: 'TOKEN_BUCKET', capacity: 20, refillRate: 5 },
      });

      // Delete
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/v1/admin/policies/client-to-delete',
        headers: { 'X-Admin-Key': config.adminApiKey },
      });
      expect(delRes.statusCode).toBe(200);

      // Verify 404 on GET
      const getRes = await app.inject({
        method: 'GET',
        url: '/v1/admin/policies/client-to-delete',
        headers: { 'X-Admin-Key': config.adminApiKey },
      });
      expect(getRes.statusCode).toBe(404);
    });
  });

  describe('Admin Metrics & Live Dashboard', () => {
    it('rejects unauthenticated metrics calls with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/metrics',
      });
      expect(res.statusCode).toBe(401);
    });

    it('records ALLOW and DENY counts atomically and exposes them via paginated /v1/admin/metrics', async () => {
      const clientKey = 'client-metrics-test';

      // 1 ALLOW check
      await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 1 },
      });

      // Set policy with small capacity to trigger DENY
      await app.inject({
        method: 'PUT',
        url: `/v1/admin/policies/${clientKey}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: { policyType: 'TOKEN_BUCKET', capacity: 1, refillRate: 0.01 },
      });

      // Exhaust remaining token
      await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 1 },
      });

      // Next check triggers DENY
      await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 1 },
      });

      // Query paginated metrics
      const metricsRes = await app.inject({
        method: 'GET',
        url: `/v1/admin/metrics?clientKey=${clientKey}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
      });

      expect(metricsRes.statusCode).toBe(200);
      const metricsBody = JSON.parse(metricsRes.payload);
      expect(metricsBody.pagination).toBeDefined();
      expect(metricsBody.pagination.page).toBe(1);
      expect(metricsBody.metrics.length).toBeGreaterThan(0);
      const totalAllowed = metricsBody.metrics.reduce((acc: number, m: any) => acc + m.allowCount, 0);
      const totalDenied = metricsBody.metrics.reduce((acc: number, m: any) => acc + m.denyCount, 0);
      expect(totalAllowed).toBeGreaterThanOrEqual(2);
      expect(totalDenied).toBeGreaterThanOrEqual(1);

      // Query metrics summary
      const summaryRes = await app.inject({
        method: 'GET',
        url: '/v1/admin/metrics/summary',
        headers: { 'X-Admin-Key': config.adminApiKey },
      });
      expect(summaryRes.statusCode).toBe(200);
      const summaryBody = JSON.parse(summaryRes.payload);
      expect(summaryBody.totalAllowed).toBeGreaterThanOrEqual(2);
      expect(summaryBody.totalDenied).toBeGreaterThanOrEqual(1);
      expect(summaryBody.activeClientsCount).toBeGreaterThanOrEqual(1);
    });

    it('serves dashboard HTML at /admin/dashboard and redirects /admin', async () => {
      const dashRes = await app.inject({
        method: 'GET',
        url: '/admin/dashboard',
      });
      expect(dashRes.statusCode).toBe(200);
      expect(dashRes.headers['content-type']).toContain('text/html');
      expect(dashRes.payload).toContain('TBRLS Admin Dashboard');
      expect(dashRes.payload).toContain('X-Admin-Key');

      const redirectRes = await app.inject({
        method: 'GET',
        url: '/admin',
      });
      expect(redirectRes.statusCode).toBe(302);
      expect(redirectRes.headers.location).toBe('/admin/dashboard');
    });
  });

  describe('Storage Pruning & Maintenance', () => {
    it('pruneExpiredSlidingWindowRequests deletes expired requests across all clients', async () => {
      const activeClient = 'client-active-cleanup';
      const inactiveClient = 'client-inactive-cleanup';

      // Active client with 10-second window
      await app.inject({
        method: 'PUT',
        url: `/v1/admin/policies/${activeClient}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: { policyType: 'SLIDING_WINDOW', windowLimit: 10, windowDurationSeconds: 10 },
      });

      // Inactive client with 60-second window
      await app.inject({
        method: 'PUT',
        url: `/v1/admin/policies/${inactiveClient}`,
        headers: { 'X-Admin-Key': config.adminApiKey },
        payload: { policyType: 'SLIDING_WINDOW', windowLimit: 10, windowDurationSeconds: 60 },
      });

      // Insert requests for both clients:
      // Active client: 1 expired (30s ago), 1 active (2s ago)
      // Inactive client (window = 60s): 1 expired (120s ago), 1 active (10s ago)
      await testPool.query(`
        INSERT INTO sliding_window_requests (client_key, requested_at) VALUES
          ($1, NOW() - INTERVAL '30 seconds'),
          ($1, NOW() - INTERVAL '2 seconds'),
          ($2, NOW() - INTERVAL '120 seconds'),
          ($2, NOW() - INTERVAL '10 seconds');
      `, [activeClient, inactiveClient]);

      const limiter = new RateLimiterService(testPool);
      const pruneResult = await limiter.pruneExpiredSlidingWindowRequests({ batchSize: 100 });
      expect(pruneResult.totalDeleted).toBe(2);

      // Verify remaining rows
      const remainingRows = await testPool.query(
        `SELECT client_key FROM sliding_window_requests ORDER BY client_key;`
      );
      expect(remainingRows.rows.length).toBe(2);
      expect(remainingRows.rows.map((r: any) => r.client_key)).toEqual([activeClient, inactiveClient]);
    });

    it('pruneMetrics deletes metric records older than retention threshold', async () => {
      await testPool.query(`
        INSERT INTO rate_limit_metrics (bucket_minute, client_key, allow_count, deny_count) VALUES
          (NOW() - INTERVAL '40 days', 'old-metric-client', 5, 2),
          (NOW() - INTERVAL '5 days', 'recent-metric-client', 10, 0);
      `);

      const limiter = new RateLimiterService(testPool);
      const pruneResult = await limiter.pruneMetrics(30 * 24);
      expect(pruneResult.deletedCount).toBe(1);

      const remainingMetrics = await testPool.query(`SELECT client_key FROM rate_limit_metrics WHERE client_key IN ('old-metric-client', 'recent-metric-client');`);
      expect(remainingMetrics.rows.length).toBe(1);
      expect(remainingMetrics.rows[0].client_key).toBe('recent-metric-client');
    });
  });

  describe('Fail-Closed Posture on Storage Outage', () => {
    it('returns HTTP 503 Service Unavailable when database pool fails', async () => {
      // Create a broken pool pointing to invalid port
      const brokenPool = new pg.Pool({
        connectionString: 'postgres://localhost:54321/nonexistent',
        connectionTimeoutMillis: 500,
      });

      const degradedApp = buildApp({ poolOverride: brokenPool, logger: false });
      await degradedApp.ready();

      const res = await degradedApp.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey: 'client-fail-closed', cost: 1 },
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Service Unavailable');
      expect(body.message).toContain('Rate limiter storage service unavailable');

      await degradedApp.close();
      await brokenPool.end();
    });
  });
});
