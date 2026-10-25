# Implementation Plan & Progress Tracking

This document details the multi-stage delivery plan for the **Token Bucket Rate Limiter Service (TBRLS)**. Each task is explicitly classified with its implementation and verification status.

---

## Stage 1: Environment Inspection & Project Scaffolding
- [x] Inspect existing workspace files and preserve user context (Status: **Completed**)
- [x] Verify toolchain: Node.js 24 LTS, npm 11+, PostgreSQL 16 (Status: **Verified**)
- [x] Verify k6 tool availability (Status: **Verified**, installed v2.3.0)
- [x] Create project skeleton (`package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `Dockerfile`, `docker-compose.yml`) (Status: **Completed**)
- [x] Create persistent agent guidelines (`AGENTS.md`) (Status: **Completed**)

---

## Stage 2: Architecture, Decisions & Documentation
- [x] Write Architectural Decision Records (ADRs 0001 - 0005) (Status: **Completed**)
- [x] Write `docs/index.md` & `docs/project-overview.md` (Status: **Completed**)
- [x] Write `docs/architecture.md`, `docs/security-policy.md`, and `docs/threat-model.md` (Status: **Completed**)
- [x] Write `docs/api.md`, `docs/data-model.md`, and `docs/algorithms.md` (Status: **Completed**)
- [x] Write `docs/testing-and-load-testing.md`, `docs/deployment.md`, and `docs/operations-runbook.md` (Status: **Completed**)

---

## Stage 3: Core Implementation
- [x] Database Connection Pool & Automated Migrations (`src/db/`) (Status: **Verified**)
  - PostgreSQL schema for `client_policies`, `token_bucket_states`, and `sliding_window_requests`
  - Atomic rate limiter PL/pgSQL function (`fn_check_rate_limit`)
  - Automated migration runner with schema verification
- [x] Rate Limiting Algorithm Logic (`src/limiter/`) (Status: **Verified**)
  - Pure calculation functions for Token Bucket refill, burst, and reset
  - Pure calculation functions for Sliding Window expiration, remaining, and retryAfter
  - Service orchestrator calling atomic PostgreSQL routines
- [x] Fastify Application & Route Handlers (`src/`) (Status: **Verified**)
  - `POST /v1/check` endpoint with `RateLimit-*` and `Retry-After` headers
  - `PUT/GET/DELETE /v1/admin/policies/:clientKey` admin routes
  - Health & readiness endpoints (`GET /healthz`, `GET /readyz`)
  - Input validation with TypeBox schemas
  - Logging plugin with client key masking & secret redaction
  - Fail-closed error handling for database failures

---

## Stage 4: Verification & Benchmarking
- [x] Unit Test Suite (Status: **Verified**)
  - Token bucket refill math & boundary tests (6 tests passed)
  - Sliding window exactness & expiration math (4 tests passed)
  - Security utilities & input validation parsing (3 tests passed)
- [x] Integration Test Suite (Status: **Verified**)
  - Database persistence across simulated restarts (1 test passed)
  - Admin policy updates & policy switching (4 tests passed)
  - High-concurrency race condition testing with zero double-spending (2 tests passed)
  - Fail-closed database error response verification (1 test passed)
- [x] k6 Load Testing (Status: **Verified**)
  - k6 script executed targeting 550 requests/second
  - Measured 550.008 RPS with 0.00% failure rate and 1.11ms p95 latency

---

## Stage 5: Documentation Verification & Delivery
- [x] Update all documentation to reflect verified test outputs and real numbers (Status: **Completed**)
- [x] Final review against user instructions and constraints (Status: **Completed**)

---

## Phase 2: Security Hardening and Verification
- [x] 2.1 Service-to-Service Check Authentication (`CHECK_API_KEY`) (Status: **Completed & Verified**)
  - Implement `checkAuthHook` validating `X-Check-Key` or `Authorization: Bearer` with `crypto.timingSafeEqual`
  - Separate `CHECK_API_KEY` from `ADMIN_API_KEY`
  - Document that `clientKey` identifies the quota owner and must originate from an authenticated upstream service
  - Add redacting serializer for `x-check-key` and `x-api-key` in logger
- [x] 2.2 Production Configuration Safety & Insecure Default Elimination (Status: **Completed & Verified**)
  - Refuse startup in production (`NODE_ENV=production`) when `ADMIN_API_KEY` or `CHECK_API_KEY` is missing, empty, or a known placeholder
  - Update `.env.example` with clearly labeled local placeholders only
  - Add unit tests validating production configuration error triggers
- [x] 2.3 Robust k6 Load Testing Script Verification (Status: **Completed & Verified**)
  - Read `CHECK_API_KEY` from environment in `load-tests/k6-rate-limit.js` and inject header
  - Verify that responses contain valid JSON with `decision` strictly equal to `ALLOW` or `DENY`
  - Refuse to count responses as passed merely on HTTP status 200 and headers
- [x] 2.4 Sliding-Window Field Alignment & State Window Filtering (Status: **Completed & Verified**)
  - Align all documentation and request schemas/examples to use `windowLimit`
  - Update `RateLimiterService.getPolicy` to filter sliding window request logs within `NOW() - (window_duration * interval '1 second')`
- [x] 2.5 Sliding-Window `RateLimit-Reset` Semantic Consistency (Status: **Completed & Verified**)
  - Align `RateLimit-Reset` for sliding window so that denied decisions match `Retry-After`
  - Update atomic database function and pure calculator
  - Document sliding-window reset semantics across `docs/algorithms.md` and `docs/api.md`
- [x] 2.6 Security Policy Vulnerability Reporting Realignment (Status: **Completed & Verified**)
  - Remove unsupported vulnerability-reporting instructions from `docs/security-policy.md`
  - Mark private reporting contact as "to be configured" pending dedicated security channel
- [x] 2.7 Verification & Documentation Sync (Status: **Completed & Verified**)
  - Update unit and integration tests across all modified modules (8 test files, 47 tests passed)
  - Execute build, test suite, and live k6 load test (549.95 RPS, 0.00% failure, 100% checks passed), documenting actual observed metrics

---

## Phase 3: Operational Readiness and Stretch Goals
- [x] 3.1 Close Quota Edge Cases (Status: **Completed & Verified**)
  - Reject requested `cost > capacity` or `cost > windowLimit` with documented HTTP 400 Bad Request before changing state (no Retry-After implying eventual success)
  - For sliding-window denials with `cost > 1`, compute required expirations $m = N + \text{cost} - L$ and set `Retry-After` to the expiry of the $m$-th oldest request
  - Pure TypeScript algorithms (`token-bucket.ts`, `sliding-window.ts`) and PostgreSQL stored function (`fn_check_rate_limit` in migration 004) aligned
  - Unit and database integration tests written and passing in `token-bucket.test.ts`, `sliding-window.test.ts`, and `api.test.ts`
- [x] 3.2 Maintainable Sliding-Window Storage (Status: **Completed & Verified**)
  - Implemented bounded, repeatable batch cleanup command (`src/scripts/cleanup.ts`) removing expired request records for all active and inactive clients
  - Determines expiration dynamically using each client's configured window duration (`COALESCE(cp.window_duration_seconds, $1)`)
  - Added npm scripts (`cleanup:sliding-window`, `cleanup:metrics`, `cleanup:all`) and documented crontab and Kubernetes CronJob specifications in `docs/operations-runbook.md`
- [x] 3.3 Multi-Instance Concurrency Verification (Status: **Completed & Verified**)
  - Added in-process multi-instance integration test (`tests/integration/multi-instance.test.ts`) with two independent Fastify instances and separate database connection pools in a single Node.js process connected to `TEST_DATABASE_URL`
  - Verified 50 concurrent checks across both instances simultaneously resulted in exactly 10 ALLOW, 40 DENY, and 0 double-spending
  - Documented shared PostgreSQL state architecture across `docs/architecture.md` and ADR-0006
- [x] 3.4 Live In-Memory Admin Dashboard & Per-Client Metrics (Status: **Completed & Verified**)
  - Created migration `004_quota_edge_cases_and_metrics.sql` for `rate_limit_metrics` table
  - Stored per-client, per-minute ALLOW/DENY counts atomically inside `fn_check_rate_limit` via `ON CONFLICT DO UPDATE`
  - Implemented paginated, admin-authenticated metrics API (`GET /v1/admin/metrics`, `GET /v1/admin/metrics/summary`)
  - Created single-page live admin dashboard (`GET /admin/dashboard`, redirecting from `/admin`) holding admin credentials strictly in volatile JavaScript closure memory (no localStorage, sessionStorage, cookies, or URL query parameters)
  - Added retention cleanup (`pruneMetrics`) and disclosed performance trade-offs in docs
- [x] 3.5 Verification Tightening & Load Benchmarking (Status: **Completed & Verified**)
  - Removed hard-coded fallback credential from k6 script; verified immediate failure if `CHECK_API_KEY` is missing
  - Added unit tests for missing k6 credentials and invalid response validation in `tests/unit/load-test-validation.test.ts`
  - Executed full Vitest suite (9 test files, 61 tests passed)
  - Executed k6 load test under sustained 550 RPS target (achieved 549.96 RPS, 0.00% errors, 1.15ms p95 latency, 100% checks passed)
  - Verified atomic metric recording matched 11,000 requests exactly
  - Updated all documentation, schemas, and created ADR-0006

---

## Phase 4: Review Findings & Log Privacy Hardening
- [x] 4.1 Prevent Client Keys & Secrets from Appearing in Request Logs (Status: **Completed & Verified**)
  - Updated `src/plugins/logger.ts` to log Fastify route templates (`req.routeOptions.url`, e.g. `/v1/admin/policies/:clientKey`) instead of raw URL paths containing keys
  - Replaced query parameter blocklist with a strict allowlist (`page`, `limit`), completely omitting sensitive credentials (`x-admin-key`, `access_token`, `password`, `clientKey`, etc.) and all arbitrary unapproved query parameters and their values
  - Sanitized unmatched request paths: when Fastify has no route template, `sanitizeRequestUrl` logs a generic safe placeholder (`<unmatched>`) rather than raw path segments, preventing sensitive tokens in 404 paths from leaking into request logs
  - Configured custom 404 handler in `src/app.ts` so Fastify default not-found handler does not log raw URLs containing keys on unrouted paths
  - Maintained header redaction for `x-admin-key`, `x-check-key`, `x-api-key`, and `authorization`
  - Added unit test suite `tests/unit/logger.test.ts` (11 tests passed) validating:
    - Route template preference over raw URL paths containing client keys
    - Safe query allowlist preserving `page` and `limit` while omitting `x-admin-key`, `access_token`, `password`, `clientKey`, and arbitrary parameters
    - Generic `<unmatched>` placeholder for unmatched paths
    - Absence of sensitive path tokens, sensitive query tokens, and header credentials in captured Fastify log streams
    - Matched route template logging and header redaction function as expected
- [x] 4.2 Multi-Instance Test Configuration Alignment (Status: **Completed & Verified**)
  - Updated `tests/integration/multi-instance.test.ts` so both application instances use `TEST_DATABASE_URL` directly from `tests/helpers/test-db.ts`
  - Eliminated string manipulation/replacement of development database URLs
- [x] 4.3 Concurrency Test Accuracy in Documentation (Status: **Completed & Verified**)
  - Accurately characterized the multi-instance test as an in-process integration test with two Fastify instances and two separate PostgreSQL connection pools
  - Updated `README.md`, `docs/architecture.md`, `docs/testing-and-load-testing.md`, `ADR-0006`, and `docs/implementation-plan.md` to avoid claiming cross-process multi-container testing
- [x] 4.4 Resilient Integration Test Teardown & Database Verification (Status: **Completed & Verified**)
  - Added safe teardown guards (`if (app) await app.close()`, `if (pool) await pool.end()`) across `tests/integration/api.test.ts`, `tests/integration/concurrency.test.ts`, and `tests/integration/multi-instance.test.ts`
  - Guarded `closeTestPool` in `tests/helpers/test-db.ts` against already ended or ending pools
  - Verified that an unreachable database surfaces the root database connection error without secondary teardown `TypeError` exceptions masking the failure
  - Verified reproducible test execution with all 10 test files and 72 tests passing against the configured `TEST_DATABASE_URL`


