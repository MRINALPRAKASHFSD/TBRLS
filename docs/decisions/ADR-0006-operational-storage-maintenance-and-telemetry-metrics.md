# ADR-0006: Operational Storage Maintenance, Telemetry Metrics, and In-Memory Dashboard

## Status
Accepted

## Context
As TBRLS scales in production across multiple instances under high concurrency:
1. **Quota Edge Cases**: Requests with a `cost` greater than a client's bucket capacity or sliding window limit were ambiguously denied or treated as standard rate exhaustion, producing confusing `Retry-After` headers that suggested the request might eventually succeed. For sliding-window denials where `cost > 1`, setting `Retry-After` to only the oldest request was insufficient when multiple requests needed to expire before the new request could fit.
2. **Sliding-Window Unbounded Growth**: The `sliding_window_requests` table records timestamps for each request. Active clients prune their own expired timestamps during rate evaluations, but inactive clients who stop making requests leave orphaned timestamp records indefinitely.
3. **Multi-Instance Quota Consistency**: When multiple TBRLS service instances run behind an L4/L7 load balancer, rate limiting decisions must be strictly synchronized without process-local state drift.
4. **Live Operational Telemetry & Dashboard**: Operators need visibility into allow/deny traffic rates per client without exposing credentials or introducing high-overhead external observability agents.

## Decision

### 1. Impossible Cost Handling
- Requests with `cost > capacity` (Token Bucket) or `cost > windowLimit` (Sliding Window) are immediately rejected with **HTTP 400 Bad Request** before altering database state.
- No `Retry-After` header is emitted, preventing clients from waiting fruitlessly.
- For sliding-window denials where $1 < \text{cost} \le \text{windowLimit}$, the service computes $m = N + \text{cost} - \text{limit}$ (where $N$ is current request count), locating the $m$-th oldest request timestamp to set `Retry-After` to when sufficient requests have expired.

### 2. Bounded Storage Cleanup CLI
- We implement `npm run cleanup:sliding-window` (`src/scripts/cleanup.ts`) which executes bounded chunked deletes (`LIMIT 5000`) across all active and inactive clients using each client's configured `window_duration_seconds` (or default 60s).
- We also implement `npm run cleanup:metrics` to prune metric records older than a configurable retention period (default 24 hours).
- Scheduled via cron or Kubernetes CronJobs.

### 3. Distributed State Model
- Rate limiter state is centralized in PostgreSQL with row-level locks (`FOR UPDATE`) and atomic functions (`fn_check_rate_limit`). Fastify application instances remain completely stateless.
- In-process multi-instance integration tests (`tests/integration/multi-instance.test.ts`) verify that two Fastify instances with independent database connection pools enforce quotas identically to single-instance deployments without double-spending. True multi-process deployments across separate containers share the same PostgreSQL locking model.

### 4. Atomic Telemetry & In-Memory Dashboard
- Telemetry metrics (`rate_limit_metrics`) track per-minute `allow_count` and `deny_count` per client. Updates are executed inside `fn_check_rate_limit` within the same transaction using `ON CONFLICT DO UPDATE`, incurring sub-millisecond overhead.
- A live administrative UI is served at `GET /admin/dashboard`. The UI requires `ADMIN_API_KEY`, but strictly stores it **only in volatile JavaScript closure memory**. Credentials are never written to `localStorage`, `sessionStorage`, cookies, or query strings.
- Paginated REST endpoints (`GET /v1/admin/metrics` and `GET /v1/admin/metrics/summary`) allow programmatic inspection.

## Consequences

### Positive
- Guaranteed quota integrity across distributed instances without cache synchronization or split-brain risk.
- Impossible cost requests fail fast with clear client errors.
- Database storage remains bounded and maintainable via deterministic background cleanup.
- Zero secret leakage risks from the administrative UI.

### Negative
- PostgreSQL bears the write overhead of atomic metric incrementation. However, benchmarks show sustained >500 RPS throughput with <1.2ms p(95) latency.
