# Token Bucket Rate Limiter Service (TBRLS)

A beginner-friendly, production-ready, distributed rate limiter service built with **TypeScript**, **Node.js 24 LTS**, **Fastify**, and **PostgreSQL**.

---

## Highlights

- **Dual Algorithm Support**: Per-client **Token Bucket** (with burst capacity & continuous fractional refills) and **Exact Sliding Window Log** (zero boundary approximation errors).
- **ACID Durability & Restart Survivability**: Built on PostgreSQL 16+ using the official `pg` driver with 100% parameterized SQL. State is preserved across container restarts.
- **Strict Concurrency Safety**: Row-level locking (`SELECT ... FOR UPDATE`) and atomic stored procedures prevent race conditions and double-spending across concurrent requests.
- **IETF Standard Rate Limit Headers**: Emits `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on check decisions.
- **Fail-Closed Availability Posture**: Fails closed (HTTP 503) during database outages to protect downstream systems from cascading traffic overloads.
- **Privacy & Security**: Zero client key or admin secret leakage in logs. Fastify/Pino log redaction, route template logging (omitting client keys in path and query parameters), and cryptographic SHA-256 trace identifiers. Separate service-to-service credential (`CHECK_API_KEY`) and administrative credential (`ADMIN_API_KEY`). Refuses to start in production with placeholder secrets.
- **High Performance**: Designed and benchmarked with k6 to sustain 500+ requests per second with sub-5ms latency.

---

## Architecture Diagram

```
[ Gateways / Upstream Services ]
             |
             | HTTP POST /v1/check (Header: X-Check-Key)
             | Payload: { "clientKey": "api-client-1", "cost": 1 }
             v
+-------------------------------------------------------+
|                Fastify Rate Limiter Service           |
|                                                       |
|  - Schema Validation (TypeBox)                        |
|  - Redaction Logger (Masked clientKey, no secrets)    |
|  - Check Auth Hook (Constant-time CHECK_API_KEY)      |
|  - Admin Auth Hook (Constant-time ADMIN_API_KEY)      |
+---------------------------+---------------------------+
                            |
                            | Parameterized SQL ($1, $2)
                            v
+-------------------------------------------------------+
|                 PostgreSQL 16 Storage                 |
|                                                       |
|  - client_policies (Per-client config)                |
|  - token_bucket_states (Token balances & timestamps)  |
|  - sliding_window_requests (Timestamp logs & indexes) |
|  - fn_check_rate_limit (Atomic PL/pgSQL function)     |
+-------------------------------------------------------+
```

---

## Quickstart

### Option A: Using Docker Compose (Full Stack)

```bash
# 1. Clone repository & enter workspace
cd /path/to/TBRLS

# 2. Start PostgreSQL and TBRLS service
docker compose up --build -d

# 3. Verify health
curl -i http://localhost:3000/readyz
```

### Option B: Local Development (Native Node.js & PostgreSQL)

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env

# 3. Run database migrations
npm run migrate

# 4. Start development server
npm run dev
```

---

## API Usage Examples

### 1. Perform a Rate Check (`POST /v1/check`)

Evaluates request admission control. Requires the `CHECK_API_KEY` credential in the request header. Note that `clientKey` identifies the quota subject (e.g. user ID, IP address, tenant) and must come from an authenticated upstream caller.

```bash
curl -X POST http://localhost:3000/v1/check \
  -H "Content-Type: application/json" \
  -H "X-Check-Key: tbrls-check-dev-secret-key-change-me" \
  -d '{"clientKey": "client-user-123", "cost": 1}'
```

#### Allowed Response (HTTP 200)
```json
{
  "decision": "ALLOW",
  "policyType": "TOKEN_BUCKET",
  "limit": 10,
  "remaining": 9,
  "reset": 1,
  "retryAfter": null
}
```

#### Denied Response (HTTP 200 with Retry-After header)
```json
{
  "decision": "DENY",
  "policyType": "TOKEN_BUCKET",
  "limit": 10,
  "remaining": 0,
  "reset": 5,
  "retryAfter": 5
}
```

Response Headers:
```http
HTTP/1.1 200 OK
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 5
Retry-After: 5
```

---

### 2. Configure a Client Policy (Admin Endpoint)

```bash
# Set a custom Token Bucket policy (capacity 50, refill 10 tokens/sec)
curl -X PUT http://localhost:3000/v1/admin/policies/client-user-123 \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: tbrls-admin-dev-secret-key-change-me" \
  -d '{
    "policyType": "TOKEN_BUCKET",
    "capacity": 50,
    "refillRate": 10.0
  }'

# Set a custom Sliding Window policy (100 requests per 60 seconds)
curl -X PUT http://localhost:3000/v1/admin/policies/client-user-123 \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: tbrls-admin-dev-secret-key-change-me" \
  -d '{
    "policyType": "SLIDING_WINDOW",
    "windowLimit": 100,
    "windowDurationSeconds": 60
  }'
```

---

### 3. Live Admin Dashboard & Metrics API

TBRLS provides a real-time single-page operations dashboard and paginated telemetry metrics endpoints.

- **Web Dashboard**: Navigate to `http://localhost:3000/admin/dashboard` (or `/admin`).
  - Enter your `ADMIN_API_KEY`. The credential is kept **strictly in volatile JavaScript memory** and is never persisted in `localStorage`, `sessionStorage`, cookies, or the URL.
  - Displays real-time request counts, admission/denial counts, denial percentage, and paginated per-client activity tables.
- **Metrics Summary API**:
  ```bash
  curl -X GET "http://localhost:3000/v1/admin/metrics/summary" \
    -H "X-Admin-Key: tbrls-admin-dev-secret-key-change-me"
  ```
- **Paginated Metrics API**:
  ```bash
  curl -X GET "http://localhost:3000/v1/admin/metrics?page=1&limit=20" \
    -H "X-Admin-Key: tbrls-admin-dev-secret-key-change-me"
  ```

---

### 4. Database Maintenance & Pruning

Sliding-window timestamp logs and historical telemetry metrics can be cleaned up in bounded, safe batches:

```bash
# Clean up expired sliding-window logs across all active and inactive clients
npm run cleanup:sliding-window

# Clean up metric buckets older than 24 hours
npm run cleanup:metrics

# Run full storage maintenance
npm run cleanup:all
```

---

## Testing & Load Testing

```bash
# Run unit and integration tests (concurrency, persistence, boundary math, dual-instance pools, log sanitization)
npm test

# Run k6 load test (500+ RPS sustained)
CHECK_API_KEY=tbrls-check-dev-secret-key-change-me npm run load-test
```

### Verified Load Test Results (October 2026)
- **Target Rate**: 550.00 iterations/sec for 20s
- **Actual Measured Throughput**: **549.96 requests/sec** (11,000 requests executed)
- **HTTP Failure Rate**: **0.00%** (0 failed out of 11,000)
- **Checks Passed**: **100.00%** (66,000 out of 66,000 assertion checks)
- **Latency Distribution**:
  - `p(90)`: 877 µs
  - `p(95)`: **1.15 ms** (Threshold: <30ms)
  - `p(99)`: **11.68 ms** (Threshold: <60ms)
  - `average`: 921.9 µs

---

## Documentation Links

- [Project Overview](file:///Users/mrinalprakash/Desktop/TBRLS/docs/project-overview.md)
- [Implementation Plan & Status](file:///Users/mrinalprakash/Desktop/TBRLS/docs/implementation-plan.md)
- [System Architecture](file:///Users/mrinalprakash/Desktop/TBRLS/docs/architecture.md)
- [Security Policy](file:///Users/mrinalprakash/Desktop/TBRLS/docs/security-policy.md) & [Threat Model](file:///Users/mrinalprakash/Desktop/TBRLS/docs/threat-model.md)
- [API Specification](file:///Users/mrinalprakash/Desktop/TBRLS/docs/api.md)
- [Data Model & Schemas](file:///Users/mrinalprakash/Desktop/TBRLS/docs/data-model.md)
- [Rate Limiting Algorithms](file:///Users/mrinalprakash/Desktop/TBRLS/docs/algorithms.md)
- [Testing & Benchmarking](file:///Users/mrinalprakash/Desktop/TBRLS/docs/testing-and-load-testing.md)
- [Deployment Guide](file:///Users/mrinalprakash/Desktop/TBRLS/docs/deployment.md) & [Operations Runbook](file:///Users/mrinalprakash/Desktop/TBRLS/docs/operations-runbook.md)
- [Architecture Decisions (ADRs)](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/)

---

## License

[MIT License](LICENSE) - Copyright (c) 2026 MRINALPRAKASH


