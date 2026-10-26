import type { Pool } from 'pg';
import { config } from '../config.js';
import type { ClientPolicy, RateCheckResult } from './types.js';

export class DatabaseUnavailableError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

export class RateLimiterService {
  constructor(private readonly pool: Pool) {}

  /**
   * Executes an atomic rate check using the PostgreSQL fn_check_rate_limit stored function.
   * Parameterized SQL prevents injection; row-level locking eliminates race conditions.
   */
  async check(clientKey: string, cost: number = 1): Promise<RateCheckResult> {
    const query = `
      SELECT
        out_decision AS decision,
        out_policy_type AS policy_type,
        out_limit AS limit_val,
        out_remaining AS remaining,
        out_reset AS reset,
        out_retry_after AS retry_after
      FROM fn_check_rate_limit($1, $2, $3, $4, $5, $6, $7);
    `;

    const values = [
      clientKey,
      cost,
      config.defaultPolicyType,
      config.defaultBucketCapacity,
      config.defaultBucketRefillRate,
      config.defaultWindowLimit,
      config.defaultWindowDurationSeconds,
    ];

    try {
      const res = await this.pool.query(query, values);
      if (res.rows.length === 0) {
        throw new Error('Rate check function returned no rows');
      }

      const row = res.rows[0];
      return {
        decision: row.decision as 'ALLOW' | 'DENY',
        policyType: row.policy_type as 'TOKEN_BUCKET' | 'SLIDING_WINDOW',
        limit: Number(row.limit_val),
        remaining: Number(row.remaining),
        reset: Number(row.reset),
        retryAfter: row.retry_after !== null ? Number(row.retry_after) : null,
      };
    } catch (err) {
      throw new DatabaseUnavailableError('Rate limiter storage service unavailable', err);
    }
  }

  /**
   * Creates or updates a client policy in client_policies using parameterized SQL.
   */
  async upsertPolicy(
    clientKey: string,
    policy: {
      policyType: 'TOKEN_BUCKET' | 'SLIDING_WINDOW';
      capacity?: number;
      refillRate?: number;
      windowLimit?: number;
      windowDurationSeconds?: number;
    }
  ): Promise<ClientPolicy> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');

      const capacity = policy.policyType === 'TOKEN_BUCKET' ? (policy.capacity ?? config.defaultBucketCapacity) : null;
      const refillRate = policy.policyType === 'TOKEN_BUCKET' ? (policy.refillRate ?? config.defaultBucketRefillRate) : null;
      const windowLimit = policy.policyType === 'SLIDING_WINDOW' ? (policy.windowLimit ?? config.defaultWindowLimit) : null;
      const windowDurationSeconds = policy.policyType === 'SLIDING_WINDOW' ? (policy.windowDurationSeconds ?? config.defaultWindowDurationSeconds) : null;

      const upsertQuery = `
        INSERT INTO client_policies (
          client_key,
          policy_type,
          capacity,
          refill_rate,
          window_limit,
          window_duration_seconds,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (client_key) DO UPDATE SET
          policy_type = EXCLUDED.policy_type,
          capacity = EXCLUDED.capacity,
          refill_rate = EXCLUDED.refill_rate,
          window_limit = EXCLUDED.window_limit,
          window_duration_seconds = EXCLUDED.window_duration_seconds,
          updated_at = NOW()
        RETURNING
          client_key,
          policy_type,
          capacity,
          refill_rate,
          window_limit,
          window_duration_seconds,
          created_at,
          updated_at;
      `;

      const res = await client.query(upsertQuery, [
        clientKey,
        policy.policyType,
        capacity,
        refillRate,
        windowLimit,
        windowDurationSeconds,
      ]);

      // Synchronize states according to policy switch
      if (policy.policyType === 'TOKEN_BUCKET') {
        // Initialize or update bucket tokens to new capacity
        await client.query(
          `
          INSERT INTO token_bucket_states (client_key, tokens, last_refill_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (client_key) DO UPDATE SET
            tokens = $2,
            last_refill_at = NOW(),
            updated_at = NOW();
        `,
          [clientKey, capacity]
        );
        // Clear sliding window logs
        await client.query('DELETE FROM sliding_window_requests WHERE client_key = $1;', [clientKey]);
      } else {
        // Clear token bucket state and reset window logs
        await client.query('DELETE FROM token_bucket_states WHERE client_key = $1;', [clientKey]);
        await client.query('DELETE FROM sliding_window_requests WHERE client_key = $1;', [clientKey]);
      }

      await client.query('COMMIT;');

      const row = res.rows[0];
      return {
        clientKey: row.client_key,
        policyType: row.policy_type,
        capacity: row.capacity !== null ? Number(row.capacity) : null,
        refillRate: row.refill_rate !== null ? Number(row.refill_rate) : null,
        windowLimit: row.window_limit !== null ? Number(row.window_limit) : null,
        windowDurationSeconds: row.window_duration_seconds !== null ? Number(row.window_duration_seconds) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      await client.query('ROLLBACK;');
      throw new DatabaseUnavailableError('Failed to upsert client policy in storage', err);
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves a client's configured policy and current runtime state.
   */
  async getPolicy(clientKey: string): Promise<{
    policy: ClientPolicy | null;
    state: {
      tokens?: number;
      lastRefillAt?: string;
      activeRequestsCount?: number;
    } | null;
  }> {
    try {
      const policyRes = await this.pool.query(
        'SELECT * FROM client_policies WHERE client_key = $1;',
        [clientKey]
      );

      if (policyRes.rows.length === 0) {
        return { policy: null, state: null };
      }

      const pRow = policyRes.rows[0];
      const policy: ClientPolicy = {
        clientKey: pRow.client_key,
        policyType: pRow.policy_type,
        capacity: pRow.capacity !== null ? Number(pRow.capacity) : null,
        refillRate: pRow.refill_rate !== null ? Number(pRow.refill_rate) : null,
        windowLimit: pRow.window_limit !== null ? Number(pRow.window_limit) : null,
        windowDurationSeconds: pRow.window_duration_seconds !== null ? Number(pRow.window_duration_seconds) : null,
        createdAt: pRow.created_at,
        updatedAt: pRow.updated_at,
      };

      let state: any = null;
      if (policy.policyType === 'TOKEN_BUCKET') {
        const stateRes = await this.pool.query(
          'SELECT tokens, last_refill_at FROM token_bucket_states WHERE client_key = $1;',
          [clientKey]
        );
        if (stateRes.rows.length > 0) {
          state = {
            tokens: Number(stateRes.rows[0].tokens),
            lastRefillAt: stateRes.rows[0].last_refill_at,
          };
        }
      } else {
        const logsRes = await this.pool.query(
          'SELECT COUNT(*) AS active_count FROM sliding_window_requests WHERE client_key = $1;',
          [clientKey]
        );
        state = {
          activeRequestsCount: Number(logsRes.rows[0]?.active_count || 0),
        };
      }

      return { policy, state };
    } catch (err) {
      throw new DatabaseUnavailableError('Failed to fetch client policy from storage', err);
    }
  }

  /**
   * Deletes a client's custom policy and resets state.
   */
  async deletePolicy(clientKey: string): Promise<boolean> {
    try {
      const res = await this.pool.query(
        'DELETE FROM client_policies WHERE client_key = $1 RETURNING client_key;',
        [clientKey]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      throw new DatabaseUnavailableError('Failed to delete client policy from storage', err);
    }
  }
}
