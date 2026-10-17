-- Migration 004: Quota Edge Cases & Per-Client Real-Time Metrics
-- 1. Creates rate_limit_metrics table for per-client per-minute telemetry
-- 2. Creates index on sliding_window_requests (requested_at) for efficient batch pruning
-- 3. Updates fn_check_rate_limit:
--    a. Rejects impossible costs (cost > capacity or cost > limit) before changing state
--    b. Calculates multi-expiration Retry-After when cost > 1 for sliding-window denials
--    c. Atomically logs ALLOW and DENY counts per client per minute

CREATE TABLE IF NOT EXISTS rate_limit_metrics (
    client_key VARCHAR(128) NOT NULL,
    bucket_minute TIMESTAMPTZ NOT NULL,
    allow_count BIGINT NOT NULL DEFAULT 0,
    deny_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (client_key, bucket_minute)
);

CREATE INDEX IF NOT EXISTS idx_metrics_bucket_minute
    ON rate_limit_metrics (bucket_minute DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_client_minute
    ON rate_limit_metrics (client_key, bucket_minute DESC);

CREATE INDEX IF NOT EXISTS idx_sliding_window_requested_at
    ON sliding_window_requests (requested_at);

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
DECLARE
    v_now TIMESTAMPTZ;
    v_bucket_minute TIMESTAMPTZ;
    v_policy_type VARCHAR(32);
    v_capacity NUMERIC(12, 4);
    v_refill_rate NUMERIC(12, 4);
    v_window_limit INTEGER;
    v_window_duration_seconds INTEGER;
    
    v_current_tokens NUMERIC(14, 4);
    v_last_refill_at TIMESTAMPTZ;
    v_delta_seconds NUMERIC;
    v_refilled_tokens NUMERIC(14, 4);
    v_new_tokens NUMERIC(14, 4);

    v_window_start TIMESTAMPTZ;
    v_active_count INTEGER;
    v_needed_expirations INTEGER;
    v_target_req TIMESTAMPTZ;
BEGIN
    v_now := clock_timestamp();
    v_bucket_minute := date_trunc('minute', v_now);

    -- Step 1: Idempotently ensure client policy exists (safe for first-time clients)
    INSERT INTO client_policies (
        client_key,
        policy_type,
        capacity,
        refill_rate,
        window_limit,
        window_duration_seconds,
        created_at,
        updated_at
    )
    VALUES (
        p_client_key,
        p_default_policy_type,
        p_default_capacity,
        p_default_refill_rate,
        p_default_window_limit,
        p_default_window_seconds,
        v_now,
        v_now
    )
    ON CONFLICT (client_key) DO NOTHING;

    -- Step 2: Lock the policy row for exclusive access for this client key
    SELECT
        policy_type,
        capacity,
        refill_rate,
        window_limit,
        window_duration_seconds
    INTO
        v_policy_type,
        v_capacity,
        v_refill_rate,
        v_window_limit,
        v_window_duration_seconds
    FROM client_policies
    WHERE client_key = p_client_key
    FOR UPDATE;

    -- Step 3: Handle TOKEN_BUCKET policy evaluation
    IF v_policy_type = 'TOKEN_BUCKET' THEN
        -- Impossible cost check: cost exceeds total burst capacity
        IF p_cost > v_capacity THEN
            RAISE EXCEPTION 'COST_EXCEEDS_CAPACITY: Requested cost % exceeds client bucket capacity %', p_cost, v_capacity USING ERRCODE = '22023';
        END IF;

        -- Idempotently ensure token bucket state exists
        INSERT INTO token_bucket_states (
            client_key,
            tokens,
            last_refill_at,
            updated_at
        )
        VALUES (
            p_client_key,
            v_capacity,
            v_now,
            v_now
        )
        ON CONFLICT (client_key) DO NOTHING;

        -- Lock state row
        SELECT
            tokens,
            last_refill_at
        INTO
            v_current_tokens,
            v_last_refill_at
        FROM token_bucket_states
        WHERE client_key = p_client_key
        FOR UPDATE;

        -- Calculate elapsed seconds & refilled tokens
        v_delta_seconds := GREATEST(0.0, EXTRACT(EPOCH FROM (v_now - v_last_refill_at)));
        v_refilled_tokens := LEAST(v_capacity, v_current_tokens + (v_delta_seconds * v_refill_rate));

        IF v_refilled_tokens >= p_cost THEN
            -- Allowed: deduct cost and update state
            v_new_tokens := v_refilled_tokens - p_cost;
            UPDATE token_bucket_states
            SET tokens = v_new_tokens,
                last_refill_at = v_now,
                updated_at = v_now
            WHERE client_key = p_client_key;

            -- Atomically record ALLOW metric
            INSERT INTO rate_limit_metrics (client_key, bucket_minute, allow_count, deny_count)
            VALUES (p_client_key, v_bucket_minute, 1, 0)
            ON CONFLICT (client_key, bucket_minute)
            DO UPDATE SET allow_count = rate_limit_metrics.allow_count + 1;

            out_decision := 'ALLOW';
            out_policy_type := 'TOKEN_BUCKET';
            out_limit := v_capacity;
            out_remaining := FLOOR(v_new_tokens);
            IF v_refill_rate > 0 THEN
                out_reset := CEIL((v_capacity - v_new_tokens) / v_refill_rate);
            ELSE
                out_reset := 0;
            END IF;
            out_retry_after := NULL;
            RETURN NEXT;
            RETURN;
        ELSE
            -- Denied: retain replenished tokens but do not deduct cost
            UPDATE token_bucket_states
            SET tokens = v_refilled_tokens,
                last_refill_at = v_now,
                updated_at = v_now
            WHERE client_key = p_client_key;

            -- Atomically record DENY metric
            INSERT INTO rate_limit_metrics (client_key, bucket_minute, allow_count, deny_count)
            VALUES (p_client_key, v_bucket_minute, 0, 1)
            ON CONFLICT (client_key, bucket_minute)
            DO UPDATE SET deny_count = rate_limit_metrics.deny_count + 1;

            out_decision := 'DENY';
            out_policy_type := 'TOKEN_BUCKET';
            out_limit := v_capacity;
            out_remaining := FLOOR(v_refilled_tokens);
            IF v_refill_rate > 0 THEN
                out_retry_after := GREATEST(1, CEIL((p_cost - v_refilled_tokens) / v_refill_rate));
                out_reset := CEIL((v_capacity - v_refilled_tokens) / v_refill_rate);
            ELSE
                out_retry_after := 3600;
                out_reset := 0;
            END IF;
            RETURN NEXT;
            RETURN;
        END IF;

    -- Step 4: Handle SLIDING_WINDOW policy evaluation
    ELSIF v_policy_type = 'SLIDING_WINDOW' THEN
        -- Impossible cost check: cost exceeds entire sliding window limit
        IF p_cost > v_window_limit THEN
            RAISE EXCEPTION 'COST_EXCEEDS_LIMIT: Requested cost % exceeds client sliding window limit %', p_cost, v_window_limit USING ERRCODE = '22023';
        END IF;

        v_window_start := v_now - (v_window_duration_seconds * INTERVAL '1 second');

        -- Prune expired timestamps for this client
        DELETE FROM sliding_window_requests
        WHERE client_key = p_client_key
          AND requested_at < v_window_start;

        -- Count active entries in current sliding window
        SELECT COUNT(*)
        INTO v_active_count
        FROM sliding_window_requests
        WHERE client_key = p_client_key;

        IF v_active_count + p_cost <= v_window_limit THEN
            -- Allowed: insert timestamp(s) for the requested cost
            INSERT INTO sliding_window_requests (client_key, requested_at)
            SELECT p_client_key, v_now
            FROM generate_series(1, p_cost);

            -- Atomically record ALLOW metric
            INSERT INTO rate_limit_metrics (client_key, bucket_minute, allow_count, deny_count)
            VALUES (p_client_key, v_bucket_minute, 1, 0)
            ON CONFLICT (client_key, bucket_minute)
            DO UPDATE SET allow_count = rate_limit_metrics.allow_count + 1;

            out_decision := 'ALLOW';
            out_policy_type := 'SLIDING_WINDOW';
            out_limit := v_window_limit;
            out_remaining := GREATEST(0, v_window_limit - (v_active_count + p_cost));
            out_reset := v_window_duration_seconds;
            out_retry_after := NULL;
            RETURN NEXT;
            RETURN;
        ELSE
            -- Denied: calculate how many requests must expire:
            -- (v_active_count - m) + p_cost <= v_window_limit => m >= v_active_count + p_cost - v_window_limit
            v_needed_expirations := (v_active_count + p_cost) - v_window_limit;

            -- Find the expiry timestamp of the required (m-th) oldest request
            SELECT requested_at
            INTO v_target_req
            FROM sliding_window_requests
            WHERE client_key = p_client_key
            ORDER BY requested_at ASC
            OFFSET (v_needed_expirations - 1)
            LIMIT 1;

            -- Atomically record DENY metric
            INSERT INTO rate_limit_metrics (client_key, bucket_minute, allow_count, deny_count)
            VALUES (p_client_key, v_bucket_minute, 0, 1)
            ON CONFLICT (client_key, bucket_minute)
            DO UPDATE SET deny_count = rate_limit_metrics.deny_count + 1;

            out_decision := 'DENY';
            out_policy_type := 'SLIDING_WINDOW';
            out_limit := v_window_limit;
            out_remaining := 0;

            IF v_target_req IS NOT NULL THEN
                out_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((v_target_req + (v_window_duration_seconds * INTERVAL '1 second')) - v_now))));
            ELSE
                out_retry_after := v_window_duration_seconds;
            END IF;
            out_reset := out_retry_after;
            RETURN NEXT;
            RETURN;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unknown policy type: %', v_policy_type;
    END IF;
END;
$$;
