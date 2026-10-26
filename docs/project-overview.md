# Project Overview: Token Bucket Rate Limiter Service (TBRLS)

## 1. Problem Statement
Distributed systems and modern web APIs require reliable request admission control to prevent cascading resource saturation, stop credential stuffing, and safeguard shared backend infrastructure.
Common pitfalls with naive rate limiting implementations include:
- **In-memory data loss**: Rate limit states reset when the service container restarts.
- **Race conditions**: Concurrent requests for the same client double-spend quota due to non-atomic read-modify-write patterns.
- **Logging leakage**: Leaking sensitive client tokens or credentials in standard access logs.
- **Fail-open hazards**: Continuing to allow burst traffic during database connection loss, overwhelming downstream services.

TBRLS solves these challenges through a clean, beginner-friendly, and production-ready microservice built on Node.js 24 LTS, TypeScript, Fastify, and PostgreSQL.

---

## 2. Core Requirements & Capabilities

### 2.1 Dynamic Rate Limit Evaluation (`POST /v1/check`)
- Accepts a `clientKey` and optional token `cost`.
- Returns an immediate JSON decision (`"decision": "ALLOW"` or `"decision": "DENY"`).
- Sets standardized rate limit headers:
  - `RateLimit-Limit`: Maximum capacity or window limit.
  - `RateLimit-Remaining`: Remaining tokens or allowed requests in window.
  - `RateLimit-Reset`: Seconds until limit resets or refills.
  - `Retry-After`: Included when denied, indicating seconds before retry.

### 2.2 Dual Policy Engine
- **Token Bucket Policy**:
  - Configurable burst `capacity` and continuous `refillRate` (tokens/second).
  - Handles continuous fractional token replenishment calculated over elapsed time.
- **Sliding Window Policy**:
  - Configurable `limit` (max requests) and `windowDurationSeconds`.
  - Implements **Exact Sliding Window Log** mechanics with timestamp precision and atomic expiration.

### 2.3 Administrative Policy Management (`/v1/admin/policies`)
- Secure endpoint to create, update, retrieve, and delete per-client policies.
- Authenticated via admin secret loaded from `ADMIN_API_KEY` environment variable.

### 2.4 ACID Durability & Concurrency Safety
- Backed by PostgreSQL 16+ using the official `pg` driver with parameterized SQL.
- Atomic evaluation via row-level locking (`SELECT ... FOR UPDATE`) prevents concurrent double-spending.
- Safely initializes first-time client records without race conditions.

### 2.5 Security, Reliability & Privacy
- **Zero Log Leakage**: Client keys and admin credentials are redacted or hashed before any logging.
- **Fail-Closed**: Database connection failures immediately return HTTP 503 instead of permitting unauthorized traffic.
- **Observability**: Health endpoints (`GET /healthz`, `GET /readyz`) for liveness and readiness probing.
