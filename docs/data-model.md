# Data Model & PostgreSQL Storage Design

## 1. Relational Entity Relationship Diagram

```
+--------------------------------------------------------------+
|                       client_policies                        |
+--------------------------------------------------------------+
| client_key              VARCHAR(128)  [PK]                   |
| policy_type             VARCHAR(32)   [CHECK IN ('...')]     |
| capacity                NUMERIC(12,4) [NULL if sliding]      |
| refill_rate             NUMERIC(12,4) [NULL if sliding]      |
| window_limit            INTEGER       [NULL if token bucket] |
| window_duration_seconds INTEGER       [NULL if token bucket] |
| created_at              TIMESTAMPTZ   DEFAULT NOW()          |
| updated_at              TIMESTAMPTZ   DEFAULT NOW()          |
+--------------------------------------------------------------+
                                | 1
                                |
             +------------------+------------------+
             | 1:1                                 | 1:N
             v                                     v
+-----------------------------+   +------------------------------------+
|     token_bucket_states     |   |      sliding_window_requests       |
+-----------------------------+   +------------------------------------+
| client_key   VARCHAR(128) PK|   | id           BIGSERIAL PK          |
| tokens       NUMERIC(14,4)  |   | client_key   VARCHAR(128) FK       |
| last_refill  TIMESTAMPTZ    |   | requested_at TIMESTAMPTZ           |
| updated_at   TIMESTAMPTZ    |   +------------------------------------+
+-----------------------------+   | INDEX (client_key, requested_at)   |
                                  +------------------------------------+
```

---

## 2. Table Specifications

### 2.1 Table: `client_policies`
Stores per-client policy definitions.

```sql
CREATE TABLE IF NOT EXISTS client_policies (
    client_key VARCHAR(128) PRIMARY KEY,
    policy_type VARCHAR(32) NOT NULL CHECK (policy_type IN ('TOKEN_BUCKET', 'SLIDING_WINDOW')),
    capacity NUMERIC(12, 4) CHECK (capacity > 0),
    refill_rate NUMERIC(12, 4) CHECK (refill_rate > 0),
    window_limit INTEGER CHECK (window_limit > 0),
    window_duration_seconds INTEGER CHECK (window_duration_seconds > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.2 Table: `token_bucket_states`
Stores the instantaneous token level and last refill timestamp for clients operating under the `TOKEN_BUCKET` policy.

```sql
CREATE TABLE IF NOT EXISTS token_bucket_states (
    client_key VARCHAR(128) PRIMARY KEY REFERENCES client_policies(client_key) ON DELETE CASCADE,
    tokens NUMERIC(14, 4) NOT NULL CHECK (tokens >= 0),
    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.3 Table: `sliding_window_requests`
Stores granted request timestamps for clients operating under the `SLIDING_WINDOW` policy.

```sql
CREATE TABLE IF NOT EXISTS sliding_window_requests (
    id BIGSERIAL PRIMARY KEY,
    client_key VARCHAR(128) NOT NULL REFERENCES client_policies(client_key) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sliding_window_client_time
    ON sliding_window_requests (client_key, requested_at DESC);
```

### 2.4 Table: `rate_limit_metrics`
Stores per-client, per-minute aggregated admission decisions (`ALLOW` and `DENY`). Updated atomically within `fn_check_rate_limit`.

```sql
CREATE TABLE IF NOT EXISTS rate_limit_metrics (
    bucket_minute TIMESTAMPTZ NOT NULL,
    client_key VARCHAR(128) NOT NULL,
    allow_count BIGINT NOT NULL DEFAULT 0,
    deny_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_minute, client_key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_metrics_time
    ON rate_limit_metrics (bucket_minute DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_metrics_client_time
    ON rate_limit_metrics (client_key, bucket_minute DESC);
```

### 2.5 Global Pruning Index on `sliding_window_requests`
Added in migration 004 to accelerate global background cleanup across all clients:

```sql
CREATE INDEX IF NOT EXISTS idx_sliding_window_requested_at
    ON sliding_window_requests (requested_at);
```

### 2.6 Table: `schema_migrations`
Tracks executed database migrations to ensure idempotency.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Atomic Database Function: `fn_check_rate_limit`

To eliminate network round-trip latency, guarantee row serialization, and ensure atomic telemetry recording, the rate check is implemented in PostgreSQL PL/pgSQL:

```sql
CREATE OR REPLACE FUNCTION fn_check_rate_limit(
    p_client_key VARCHAR(128),
    p_cost INTEGER DEFAULT 1,
    p_default_policy_type VARCHAR(32) DEFAULT 'TOKEN_BUCKET',
    p_default_capacity NUMERIC DEFAULT 10,
    p_default_refill_rate NUMERIC DEFAULT 2.0,
    p_default_window_limit INTEGER DEFAULT 60,
    p_default_window_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
    out_decision VARCHAR(10),
    out_policy_type VARCHAR(32),
    out_limit NUMERIC,
    out_remaining NUMERIC,
    out_reset INTEGER,
    out_retry_after INTEGER
)
LANGUAGE plpgsql
AS $$
...
$$;
```

### Key Logic in Migration 004:
1. **Impossible Cost Guard**: Before modifying tokens or logs, verifies `p_cost <= v_capacity` (for Token Bucket) or `p_cost <= v_window_limit` (for Sliding Window). If violated, raises `COST_EXCEEDS_CAPACITY` or `COST_EXCEEDS_LIMIT` with SQLSTATE `22003`.
2. **Multi-Expiration Sliding Window Calculation**: If a sliding window request of cost $k > 1$ is denied, locates the $(N + k - L)$-th oldest active timestamp to compute when sufficient slots expire.
3. **Atomic Metric Ingestion**: Executes `INSERT ... ON CONFLICT (bucket_minute, client_key) DO UPDATE` within the rate evaluation transaction.

---

## 4. Pruning & Data Retention Strategy

1. **In-Flight Pruning**: During rate checks for an active sliding-window client, expired records for that specific `client_key` are deleted.
2. **Deterministic Background Cleanup**:
   - `npm run cleanup:sliding-window`: Executes bounded batch deletes (`LIMIT 5000`) for all expired requests across active and inactive clients, dynamically using each client's configured `window_duration_seconds`.
   - `npm run cleanup:metrics`: Deletes metric buckets older than configured retention (default 24 hours).
   - Operators can schedule these commands via cron or Kubernetes CronJobs.

