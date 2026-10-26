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

### 4.2 Benchmark Results Log (Verified October 2026)
- **Tool Version**: k6 v2.3.0 (commit/devel, go1.27.1, darwin/arm64)
- **Runtime**: Node.js v24.13.1 LTS
- **Database**: PostgreSQL 16.15 (Homebrew)
- **Target Rate**: 550.00 iterations/second
- **Test Duration**: 20.0 seconds
- **Total Requests Executed**: 11,001 iterations
- **Actual Measured RPS**: **550.008 requests/second**
- **HTTP Failure Rate (`http_req_failed`)**: **0.00%** (0 out of 11,001 requests failed)
- **Rate Check Latency Profile**:
  - Minimum: 0.275 ms (275 µs)
  - Median: 0.541 ms (541 µs)
  - Average: 0.806 ms (806 µs)
  - **p90 Latency**: 0.840 ms (840 µs)
  - **p95 Latency**: **1.11 ms** (Threshold `< 30ms`: PASSED)
  - **p99 Latency**: **5.51 ms** (Threshold `< 60ms`: PASSED)
  - Maximum: 66.08 ms
- **Decision Outcomes**:
  - `ALLOW` decisions: 1,225 (61.2 req/s permitted)
  - `DENY` decisions: 9,776 (488.8 req/s safely throttled)
- **Checks Succeeded**: 44,004 / 44,004 (100.00%)
  - `✓ status is 200`
  - `✓ has ratelimit-limit header`
  - `✓ has ratelimit-remaining header`
  - `✓ has ratelimit-reset header`

---

## 5. Vitest Suite Results (Verified)
- **Total Test Files**: 6 passed (100%)
- **Total Tests**: 27 passed (100%)
- **Suite Breakdown**:
  - `tests/unit/token-bucket.test.ts`: 6 tests passed (fractional refills, burst capacity, deficit calculations)
  - `tests/unit/sliding-window.test.ts`: 4 tests passed (window boundaries, timestamp pruning, retry-after)
  - `tests/unit/utils.test.ts`: 3 tests passed (key masking, SHA-256 key hashing, timing-safe matching)
  - `tests/integration/api.test.ts`: 11 tests passed (health probes, headers, admin CRUD, input validation, fail-closed 503)
  - `tests/integration/concurrency.test.ts`: 2 tests passed (zero double-spending under 50 concurrent checks, atomic first-time client initialization)
  - `tests/integration/persistence.test.ts`: 1 test passed (state survived service restart)

