import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { cleanTestDatabase, closeTestPool, setupTestDatabase, TEST_DATABASE_URL, testPool } from '../helpers/test-db.js';

/**
 * Dual Fastify Instances with Separate DB Pools (Single-Process Concurrency Test)
 *
 * Verifies that two distinct Fastify app instances and independent PostgreSQL connection
 * pools running within the same Node.js process share rate limiting state reliably through
 * PostgreSQL row locks and atomic stored procedures.
 *
 * Note: This is an in-process integration test with two app instances and separate pools;
 * it does not spawn separate operating-system processes.
 */
describe('Dual Fastify Instances with Separate DB Pools (In-Process Integration Tests)', () => {
  let poolA: pg.Pool;
  let poolB: pg.Pool;
  let appA: FastifyInstance;
  let appB: FastifyInstance;

  beforeAll(async () => {
    await setupTestDatabase();

    // Create two separate database connection pools to the configured test database
    // Uses TEST_DATABASE_URL directly rather than string manipulation of development URLs
    poolA = new pg.Pool({
      connectionString: TEST_DATABASE_URL,
      max: 10,
    });
    poolB = new pg.Pool({
      connectionString: TEST_DATABASE_URL,
      max: 10,
    });

    // Build two independent Fastify application instances
    appA = buildApp({ poolOverride: poolA, logger: false });
    appB = buildApp({ poolOverride: poolB, logger: false });

    await appA.ready();
    await appB.ready();
  });

  afterAll(async () => {
    if (appA) await appA.close();
    if (appB) await appB.close();
    if (poolA) await poolA.end();
    if (poolB) await poolB.end();
    await closeTestPool();
  });

  beforeEach(async () => {
    await cleanTestDatabase();
  });

  it('guarantees exact Token Bucket quota enforcement across two app instances and connection pools without double-spending', async () => {
    const clientKey = 'multi-inst-tb-client';
    const capacity = 10;
    const refillRate = 0.0001; // Negligible refill during concurrent test

    // Setup policy via instance A
    const setupRes = await appA.inject({
      method: 'PUT',
      url: `/v1/admin/policies/${clientKey}`,
      headers: { 'X-Admin-Key': config.adminApiKey },
      payload: {
        policyType: 'TOKEN_BUCKET',
        capacity,
        refillRate,
      },
    });
    expect(setupRes.statusCode).toBe(200);

    // Concurrently dispatch 50 requests split evenly across appA (25) and appB (25)
    const totalRequests = 50;
    const promises: Promise<any>[] = [];

    for (let i = 0; i < totalRequests; i++) {
      const targetApp = i % 2 === 0 ? appA : appB;
      promises.push(
        targetApp.inject({
          method: 'POST',
          url: '/v1/check',
          headers: { 'X-Check-Key': config.checkApiKey },
          payload: { clientKey, cost: 1 },
        })
      );
    }

    const responses = await Promise.all(promises);

    let allowCount = 0;
    let denyCount = 0;

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      if (body.decision === 'ALLOW') {
        allowCount++;
      } else if (body.decision === 'DENY') {
        denyCount++;
      }
    }

    // Verify ACID serialization: exactly 10 ALLOW across both instances, 40 DENY
    expect(allowCount).toBe(capacity);
    expect(denyCount).toBe(totalRequests - capacity);

    // Verify PostgreSQL persistence has exactly 0 remaining tokens
    const stateRes = await testPool.query(
      'SELECT tokens FROM token_bucket_states WHERE client_key = $1;',
      [clientKey]
    );
    expect(stateRes.rows.length).toBe(1);
    expect(Math.floor(Number(stateRes.rows[0].tokens))).toBe(0);
  });

  it('guarantees exact Sliding Window quota enforcement across two app instances and connection pools', async () => {
    const clientKey = 'multi-inst-sw-client';
    const windowLimit = 6;
    const windowDurationSeconds = 60;

    // Setup sliding window policy via instance B
    const setupRes = await appB.inject({
      method: 'PUT',
      url: `/v1/admin/policies/${clientKey}`,
      headers: { 'X-Admin-Key': config.adminApiKey },
      payload: {
        policyType: 'SLIDING_WINDOW',
        windowLimit,
        windowDurationSeconds,
      },
    });
    expect(setupRes.statusCode).toBe(200);

    // Concurrently dispatch 30 requests split evenly across appA and appB
    const totalRequests = 30;
    const promises: Promise<any>[] = [];

    for (let i = 0; i < totalRequests; i++) {
      const targetApp = i % 2 === 0 ? appA : appB;
      promises.push(
        targetApp.inject({
          method: 'POST',
          url: '/v1/check',
          headers: { 'X-Check-Key': config.checkApiKey },
          payload: { clientKey, cost: 1 },
        })
      );
    }

    const responses = await Promise.all(promises);

    let allowCount = 0;
    let denyCount = 0;

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      if (body.decision === 'ALLOW') {
        allowCount++;
      } else if (body.decision === 'DENY') {
        denyCount++;
      }
    }

    expect(allowCount).toBe(windowLimit);
    expect(denyCount).toBe(totalRequests - windowLimit);

    // Verify exactly 6 records exist in sliding_window_requests
    const countRes = await testPool.query(
      'SELECT COUNT(*) FROM sliding_window_requests WHERE client_key = $1;',
      [clientKey]
    );
    expect(Number(countRes.rows[0].count)).toBe(windowLimit);
  });
});
