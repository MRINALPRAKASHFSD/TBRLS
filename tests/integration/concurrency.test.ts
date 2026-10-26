import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { cleanTestDatabase, closeTestPool, setupTestDatabase, testPool } from '../helpers/test-db.js';

describe('Concurrency & Double-Spending Prevention (Integration Tests)', () => {
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

  it('guarantees zero double-spending under 50 simultaneous concurrent requests', async () => {
    const clientKey = 'concurrent-test-client';
    const capacity = 10;
    const refillRate = 0.0001; // virtually zero refill during the test window

    // 1. Setup client policy with capacity 10
    const setupRes = await app.inject({
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

    // 2. Launch 50 simultaneous requests concurrently
    const totalRequests = 50;
    const promises = Array.from({ length: totalRequests }).map(() =>
      app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { clientKey, cost: 1 },
      })
    );

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

    // 3. Strictly verify quota: exactly 10 ALLOW, exactly 40 DENY
    expect(allowCount).toBe(capacity);
    expect(denyCount).toBe(totalRequests - capacity);

    // 4. Verify database state: tokens balance must be 0
    const stateRes = await testPool.query(
      'SELECT tokens FROM token_bucket_states WHERE client_key = $1;',
      [clientKey]
    );
    expect(stateRes.rows.length).toBe(1);
    expect(Math.floor(Number(stateRes.rows[0].tokens))).toBe(0);
  });

  it('handles first-time client key concurrent initialization safely', async () => {
    const firstTimeKey = 'first-time-burst-client';
    const totalRequests = 20;

    // Launch 20 concurrent requests for an unseen client key
    const promises = Array.from({ length: totalRequests }).map(() =>
      app.inject({
        method: 'POST',
        url: '/v1/check',
        payload: { clientKey: firstTimeKey, cost: 1 },
      })
    );

    const responses = await Promise.all(promises);

    // All requests should return 200 without duplicate key or collision errors
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(['ALLOW', 'DENY']).toContain(body.decision);
    }
  });
});
