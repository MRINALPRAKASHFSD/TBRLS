import type { Pool } from 'pg';
import { config } from '../config.js';
import { type ClientPolicy, InvalidCostError, type RateCheckResult } from './types.js';

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
    } catch (err: any) {
      if (err.message && err.message.includes('COST_EXCEEDS_CAPACITY')) {
        throw new InvalidCostError(err.message, config.defaultBucketCapacity, cost, 'TOKEN_BUCKET');
      }
      if (err.message && err.message.includes('COST_EXCEEDS_LIMIT')) {
        throw new InvalidCostError(err.message, config.defaultWindowLimit, cost, 'SLIDING_WINDOW');
      }
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
      requestCount?: number;
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
        const windowDuration = policy.windowDurationSeconds ?? config.defaultWindowDurationSeconds;
        const logsRes = await this.pool.query(
          `SELECT COUNT(*) AS active_count
           FROM sliding_window_requests
           WHERE client_key = $1
             AND requested_at >= NOW() - ($2 * INTERVAL '1 second');`,
          [clientKey, windowDuration]
        );
        const count = Number(logsRes.rows[0]?.active_count || 0);
        state = {
          requestCount: count,
          activeRequestsCount: count,
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

  /**
   * Bounded, repeatable batch deletion of expired sliding-window request records for all clients,
   * including inactive clients. Dynamically evaluates expiration against each client's configured window.
   */
  async pruneExpiredSlidingWindowRequests(options: {
    batchSize?: number;
    maxBatches?: number;
    defaultWindowSeconds?: number;
  } = {}): Promise<{ totalDeleted: number; batchesExecuted: number }> {
    const batchSize = Math.max(1, options.batchSize ?? 1000);
    const maxBatches = Math.max(1, options.maxBatches ?? 50);
    const defaultWindowSeconds = options.defaultWindowSeconds ?? config.defaultWindowDurationSeconds;

    let totalDeleted = 0;
    let batchesExecuted = 0;

    const query = `
      WITH expired_batch AS (
        SELECT swr.id
        FROM sliding_window_requests swr
        LEFT JOIN client_policies cp ON cp.client_key = swr.client_key
        WHERE swr.requested_at < NOW() - (COALESCE(cp.window_duration_seconds, $1) * INTERVAL '1 second')
        LIMIT $2
      )
      DELETE FROM sliding_window_requests
      WHERE id IN (SELECT id FROM expired_batch);
    `;

    for (let i = 0; i < maxBatches; i++) {
      try {
        const res = await this.pool.query(query, [defaultWindowSeconds, batchSize]);
        const deletedInBatch = res.rowCount ?? 0;
        totalDeleted += deletedInBatch;
        batchesExecuted++;

        if (deletedInBatch < batchSize) {
          // No more expired rows left to delete
          break;
        }
      } catch (err) {
        throw new DatabaseUnavailableError('Failed to prune expired sliding window requests', err);
      }
    }

    return { totalDeleted, batchesExecuted };
  }

  /**
   * Retention cleanup for historical per-client rate limit metrics.
   */
  async pruneMetrics(retentionHours: number = 24): Promise<{ deletedCount: number }> {
    const query = `
      DELETE FROM rate_limit_metrics
      WHERE bucket_minute < NOW() - ($1 * INTERVAL '1 hour');
    `;
    try {
      const res = await this.pool.query(query, [Math.max(1, retentionHours)]);
      return { deletedCount: res.rowCount ?? 0 };
    } catch (err) {
      throw new DatabaseUnavailableError('Failed to prune rate limit metrics', err);
    }
  }

  /**
   * Retrieves paginated per-client per-minute metrics.
   */
  async getMetrics(options: {
    page?: number;
    limit?: number;
    clientKey?: string;
    from?: string;
    to?: string;
  } = {}): Promise<{
    metrics: Array<{
      clientKey: string;
      bucketMinute: string;
      allowCount: number;
      denyCount: number;
      totalRequests: number;
    }>;
    pagination: {
      page: number;
      limit: number;
      totalRecords: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: any[] = [];

    if (options.clientKey) {
      values.push(options.clientKey);
      whereClauses.push(`client_key = $${values.length}`);
    }
    if (options.from) {
      values.push(options.from);
      whereClauses.push(`bucket_minute >= $${values.length}::timestamptz`);
    }
    if (options.to) {
      values.push(options.to);
      whereClauses.push(`bucket_minute <= $${values.length}::timestamptz`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    try {
      const countRes = await this.pool.query(
        `SELECT COUNT(*) AS total FROM rate_limit_metrics ${whereSql};`,
        values
      );
      const totalRecords = Number(countRes.rows[0]?.total || 0);

      const dataValues = [...values];
      dataValues.push(limit);
      const limitParamIndex = dataValues.length;
      dataValues.push(offset);
      const offsetParamIndex = dataValues.length;

      const dataRes = await this.pool.query(
        `SELECT
          client_key,
          bucket_minute,
          allow_count,
          deny_count,
          (allow_count + deny_count) AS total_requests
        FROM rate_limit_metrics
        ${whereSql}
        ORDER BY bucket_minute DESC, client_key ASC
        LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex};`,
        dataValues
      );

      const metrics = dataRes.rows.map((r) => ({
        clientKey: r.client_key,
        bucketMinute: r.bucket_minute instanceof Date ? r.bucket_minute.toISOString() : String(r.bucket_minute),
        allowCount: Number(r.allow_count),
        denyCount: Number(r.deny_count),
        totalRequests: Number(r.total_requests),
      }));

      return {
        metrics,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit) || 1,
        },
      };
    } catch (err) {
      throw new DatabaseUnavailableError('Failed to fetch rate limit metrics', err);
    }
  }

  /**
   * Retrieves summary telemetry for the dashboard over the last hour.
   */
  async getMetricsSummary(): Promise<{
    activeClientsCount: number;
    totalRequests: number;
    totalAllowed: number;
    totalDenied: number;
    denialRatePercent: number;
  }> {
    try {
      const res = await this.pool.query(`
        SELECT
          COUNT(DISTINCT client_key) AS active_clients,
          COALESCE(SUM(allow_count), 0) AS total_allowed,
          COALESCE(SUM(deny_count), 0) AS total_denied,
          COALESCE(SUM(allow_count + deny_count), 0) AS total_requests
        FROM rate_limit_metrics
        WHERE bucket_minute >= NOW() - INTERVAL '1 hour';
      `);

      const row = res.rows[0];
      const totalAllowed = Number(row?.total_allowed || 0);
      const totalDenied = Number(row?.total_denied || 0);
      const totalRequests = Number(row?.total_requests || 0);
      const denialRatePercent = totalRequests > 0 ? (totalDenied / totalRequests) * 100 : 0;

      return {
        activeClientsCount: Number(row?.active_clients || 0),
        totalRequests,
        totalAllowed,
        totalDenied,
        denialRatePercent: Math.round(denialRatePercent * 100) / 100,
      };
    } catch (err) {
      throw new DatabaseUnavailableError('Failed to fetch metrics summary', err);
    }
  }
}
