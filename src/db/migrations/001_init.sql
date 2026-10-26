-- Schema migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-client policy configuration table
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

-- Token bucket state table
CREATE TABLE IF NOT EXISTS token_bucket_states (
    client_key VARCHAR(128) PRIMARY KEY REFERENCES client_policies(client_key) ON DELETE CASCADE,
    tokens NUMERIC(14, 4) NOT NULL CHECK (tokens >= 0),
    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sliding window request timestamp log table
CREATE TABLE IF NOT EXISTS sliding_window_requests (
    id BIGSERIAL PRIMARY KEY,
    client_key VARCHAR(128) NOT NULL REFERENCES client_policies(client_key) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast index for range queries and pruning on sliding window requests
CREATE INDEX IF NOT EXISTS idx_sliding_window_client_time
    ON sliding_window_requests (client_key, requested_at DESC);
