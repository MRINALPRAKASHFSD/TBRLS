# Testing & Load Testing Strategy

This document outlines the testing architecture, test suites, and load testing benchmarks for TBRLS.

---

## 1. Test Architecture

The testing strategy spans three distinct validation tiers:
1. **Unit Tests (`tests/unit/`)**:
   - Algorithmic boundary conditions, mathematical precision of fractional refills, burst saturation, sliding window expiry, and input validation parsing without database dependencies.
2. **Integration Tests (`tests/integration/`)**:
   - End-to-end HTTP tests against Fastify with live PostgreSQL persistence (`tbrls_test` database).
   - Validates policy creation, state transitions across simulated restarts, and high-concurrency race condition testing.
3. **k6 Load Tests (`load-tests/`)**:
   - Synthetic load generation targeting >= 500 requests per second to evaluate p95/p99 latency, connection pool stability, and database row lock contention.

---

## 2. Test Execution Commands

```bash
# Run complete Vitest suite (unit + integration)
npm test

# Run Vitest in interactive watch mode
npm run test:watch

# Execute k6 load test against local or containerized service
npm run load-test
```

---

## 3. High-Concurrency Race Condition Test Plan

To verify that concurrent checks cannot double-spend quota:
1. Seed a test client with `TOKEN_BUCKET` policy:
   - `capacity = 10`
   - `refillRate = 0.0001` (negligible refill during test)
2. Spawn **50 simultaneous HTTP requests** using `Promise.all()` from Node.js with `cost = 1`.
3. Assert:
   - Exactly **10 requests** return `decision == "ALLOW"`.
   - Exactly **40 requests** return `decision == "DENY"`.
   - Client's remaining tokens in the database equal `0`.
   - Zero double-spending occurred.

---

## 4. k6 Load Testing Target & Benchmark Results

### 4.1 Target Specification
- **Target Rate**: At least 500 requests per second (RPS).
- **Duration**: 20-30 seconds sustained.
- **Payload**: Randomized client keys across a pool of 20 distinct clients.
- **Pass Criteria**:
  - `http_req_failed` < 1% (excluding intentional rate limit `DENY` decisions, which are HTTP 200).
  - p95 latency < 50ms.

### 4.2 Benchmark Results Log (Phase 3 Verified - October 2026)
- **Tool Version**: k6 v2.3.0 (commit/devel, go1.27.1, darwin/arm64)
- **Runtime**: Node.js v24.13.1 LTS
- **Database**: PostgreSQL 16.15 (Homebrew)
- **Target Rate**: 550.00 iterations/second
- **Test Duration**: 20.0 seconds
- **Authentication**: `X-Check-Key: tbrls-check-dev-secret-key-change-me`
- **Total Requests Executed**: 11,000 iterations
- **Actual Measured RPS**: **549.96 requests/second**
- **HTTP Failure Rate (`http_req_failed`)**: **0.00%** (0 out of 11,000 requests failed)
- **Rate Check Latency Profile**:
  - Minimum: 0.256 ms (256 µs)
  - Median: 0.552 ms (552 µs)
  - Average: 0.922 ms (922 µs)
  - **p90 Latency**: 0.877 ms (877 µs)
  - **p95 Latency**: **1.15 ms** (Threshold `< 30ms`: PASSED)
  - **p99 Latency**: **11.68 ms** (Threshold `< 60ms`: PASSED)
  - Maximum: 60.78 ms
- **Decision Outcomes**:
  - `ALLOW` decisions: 1,225 (61.2 req/s permitted)
  - `DENY` decisions: 9,775 (488.7 req/s safely throttled)
- **Checks Succeeded**: 66,000 / 66,000 (100.00%)
  - `✓ status is 200` (11,000 / 11,000)
  - `✓ has valid JSON body` (11,000 / 11,000)
  - `✓ decision is exactly ALLOW or DENY` (11,000 / 11,000)
  - `✓ has ratelimit-limit header` (11,000 / 11,000)
  - `✓ has ratelimit-remaining header` (11,000 / 11,000)
  - `✓ has ratelimit-reset header` (11,000 / 11,000)
- **Atomic Telemetry Accuracy**:
  - Verified via `GET /v1/admin/metrics/summary`: `totalRequests: 11000`, `totalAllowed: 1225`, `totalDenied: 9775`, `activeClientsCount: 25` (100% exact alignment).

---

## 5. Vitest Suite Results (Phase 4 Verified)
- **Total Test Files**: 10 passed (100%)
- **Total Tests**: 72 passed (100%)
- **Execution Duration**: ~1.70s
- **Suite Breakdown**:
  - `tests/unit/logger.test.ts`: 11 tests passed (route template preference over raw URL paths, safe query parameter allowlist preserving `page` and `limit` while omitting `x-admin-key`, `access_token`, `password`, and arbitrary parameters, generic `<unmatched>` route placeholder for unrouted paths, header redaction, log stream capture verification in Fastify application)
  - `tests/unit/token-bucket.test.ts`: 6 tests passed (fractional refills, burst capacity, deficit calculations, `InvalidCostError` on `cost > capacity` without state mutation)
  - `tests/unit/sliding-window.test.ts`: 6 tests passed (window boundaries, timestamp pruning, `InvalidCostError` on `cost > limit`, multi-expiration `Retry-After` calculation)
  - `tests/unit/utils.test.ts`: 3 tests passed (key masking, SHA-256 key hashing, timing-safe matching)
  - `tests/unit/config.test.ts`: 9 tests passed (isPlaceholderKey, production missing/placeholder rejection, development/test defaults)
  - `tests/unit/load-test-validation.test.ts`: 8 tests passed (missing CHECK_API_KEY rejection, response validation, HTTP status verification)
  - `tests/integration/api.test.ts`: 24 tests passed (check service auth, impossible cost 400 rejection, multi-expiration sliding window check, admin CRUD, admin paginated metrics, metrics summary, live dashboard HTML & redirect, background pruning of sliding window & metrics, fail-closed 503)
  - `tests/integration/multi-instance.test.ts`: 2 tests passed (in-process dual-instance test: two separate Fastify apps and independent connection pools in one process sharing configured `TEST_DATABASE_URL`; 50 concurrent checks with exact quota enforcement and zero double-spending)
  - `tests/integration/concurrency.test.ts`: 2 tests passed (zero double-spending under 50 concurrent checks on single instance, atomic first-time client initialization)
  - `tests/integration/persistence.test.ts`: 1 test passed (state survived service restart)

---

## 6. Integration Teardown Resilience & Test Database Verification

### Teardown Safety Hooks
All integration suites (`tests/integration/api.test.ts`, `tests/integration/concurrency.test.ts`, and `tests/integration/multi-instance.test.ts`) guard `afterAll` teardowns against uninitialized Fastify instances and database pools:
- Uses `if (app) await app.close()` and `if (pool) await pool.end()`.
- [`closeTestPool()`](file:///Users/mrinalprakash/Desktop/TBRLS/tests/helpers/test-db.ts) checks `!testPool.ending && !testPool.ended` before terminating.
- **Root Cause Preservation**: If database connectivity fails during `beforeAll` (e.g. database unreachable), Vitest reports the exact database connection error (`ECONNREFUSED`) directly without secondary `TypeError: Cannot read properties of undefined (reading 'close')` crashes masking the underlying problem.

### Active Test Run Verification
- **PostgreSQL Connectivity**: Actively verified connection to the configured `TEST_DATABASE_URL` via parameterized probe (`SELECT 1`).
- **Executed & Passed**: All 10 test files and 72 tests passed without skips or suppressed failures in ~1.67s.




