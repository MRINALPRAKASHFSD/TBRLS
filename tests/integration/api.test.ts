import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { cleanTestDatabase, closeTestPool, setupTestDatabase, testPool } from '../helpers/test-db.js';

describe('API Integration Tests (Fastify + PostgreSQL)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDatabase();
    app = buildApp({ poolOverride: testPool, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
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

  describe('POST /v1/check', () => {
    it('returns ALLOW on first-time client key and populates standard rate limit headers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
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
        payload: { clientKey: 'client-small', cost: 1 },
      });
      expect(JSON.parse(r1.payload).decision).toBe('ALLOW');

      // Request 2: consumes 1 token (0 remaining)
      const r2 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { clientKey: 'client-small', cost: 1 },
      });
      expect(JSON.parse(r2.payload).decision).toBe('ALLOW');

      // Request 3: should be DENIED
      const r3 = await app.inject({
        method: 'POST',
        url: '/v1/check',
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
        payload: { clientKey: 'client-valid', cost: -5 },
      });

      expect(res.statusCode).toBe(400);
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
        payload: { clientKey: 'client-windowed', cost: 1 },
      });
      expect(JSON.parse(c1.payload).decision).toBe('ALLOW');
      expect(JSON.parse(c1.payload).remaining).toBe(1);

      // Check 2: Allowed (0 remaining)
      const c2 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { clientKey: 'client-windowed', cost: 1 },
      });
      expect(JSON.parse(c2.payload).decision).toBe('ALLOW');
      expect(JSON.parse(c2.payload).remaining).toBe(0);

      // Check 3: Denied
      const c3 = await app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { clientKey: 'client-windowed', cost: 1 },
      });
      expect(JSON.parse(c3.payload).decision).toBe('DENY');
      expect(JSON.parse(c3.payload).retryAfter).toBeGreaterThanOrEqual(1);
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
