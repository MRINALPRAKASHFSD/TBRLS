import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { cleanTestDatabase, closeTestPool, setupTestDatabase, testPool } from '../helpers/test-db.js';

describe('State Persistence & Restart Survivability (Integration Tests)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  beforeEach(async () => {
    await cleanTestDatabase();
  });

  it('preserves client token balances and policies across simulated service restarts', async () => {
    const clientKey = 'restart-survivor-client';

    // 1. Initial service instance
    let app = buildApp({ poolOverride: testPool, logger: false });
    await app.ready();

    // Configure custom policy: capacity 10, refill 0.0001
    await app.inject({
      method: 'PUT',
      url: `/v1/admin/policies/${clientKey}`,
      headers: { 'X-Admin-Key': config.adminApiKey },
      payload: {
        policyType: 'TOKEN_BUCKET',
        capacity: 10,
        refillRate: 0.0001,
      },
    });

    // Make 4 requests: consumes 4 tokens
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: { 'X-Check-Key': config.checkApiKey },
        payload: { clientKey, cost: 1 },
      });
      expect(JSON.parse(res.payload).decision).toBe('ALLOW');
    }

    // Verify 6 remaining
    const beforeRestart = await app.inject({
      method: 'POST',
      url: '/v1/check',
      headers: { 'X-Check-Key': config.checkApiKey },
      payload: { clientKey, cost: 1 },
    });
    expect(JSON.parse(beforeRestart.payload).remaining).toBe(5);

    // 2. Simulate complete service shutdown / restart
    await app.close();

    // 3. Launch a brand new Fastify service instance connecting to the same database
    app = buildApp({ poolOverride: testPool, logger: false });
    await app.ready();

    // 4. Verify state was persisted in PostgreSQL and resumed exactly
    const afterRestart = await app.inject({
      method: 'POST',
      url: '/v1/check',
      headers: { 'X-Check-Key': config.checkApiKey },
      payload: { clientKey, cost: 1 },
    });

    const body = JSON.parse(afterRestart.payload);
    expect(body.decision).toBe('ALLOW');
    // Previously at 5 remaining, consumed 1 -> now 4 remaining
    expect(body.remaining).toBe(4);
    expect(body.limit).toBe(10);

    await app.close();
  });
});
