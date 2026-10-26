# System Architecture

## 1. Architectural Topology

TBRLS is structured as a decoupled, stateless HTTP rate limiter service that delegates concurrency and state durability to an ACID-compliant PostgreSQL database cluster.

```
                          +-------------------------+
                          |   HTTP Clients / Gateways|
                          +------------+------------+
                                       |
                                       | HTTP JSON (POST /v1/check)
                                       v
                     +-----------------------------------+
                     |      Fastify Application Server   |
                     |  - Input Validation (TypeBox)     |
                     |  - Redaction & Masking Logger     |
                     |  - Admin Auth Hook (X-Admin-Key)  |
                     +-----------------+-----------------+
                                       |
                                       | Parameterized SQL / Function Calls
                                       v
                     +-----------------------------------+
                     |       PostgreSQL 16 Database      |
                     |  - client_policies (config)       |
                     |  - token_bucket_states (buckets)  |
                     |  - sliding_window_requests (logs) |
                     |  - fn_check_rate_limit (atomic)   |
                     +-----------------------------------+
```

---

## 2. Key Component Responsibilities

### 2.1 Fastify HTTP Layer (`src/app.ts` & `src/server.ts`)
- **JSON Serialization & Parsing**: Fastify uses optimized JSON serialization based on pre-compiled TypeBox schemas.
- **Header Enrichment**: Automatically sets standard RFC rate limit headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`) on all check responses.
- **Graceful Lifecycle Management**: Handles `SIGTERM` and `SIGINT` signals, closing the HTTP listener and draining the PostgreSQL connection pool without terminating in-flight requests.

### 2.2 Security & Authentication (`src/plugins/auth.ts` & `src/plugins/logger.ts`)
- **Admin Auth Hook**: Compares `x-admin-key` or `Authorization: Bearer <key>` using timing-safe buffer comparisons against `process.env.ADMIN_API_KEY`.
- **Zero-Secret Logging**: Fastify/Pino serializes HTTP logs with automatic key redaction. Client keys are never output in raw form; only truncated masked keys (`clie****`) and cryptographic SHA-256 hashes are logged.

### 2.3 Storage Layer (`src/db/`)
- **Connection Pool**: Bounded `pg.Pool` with connection timeouts and health probes.
- **Automated Migration Runner**: Executes transactional migrations sequentially on application startup, creating tables, indexes, and stored functions.

### 2.4 Rate Limiting Logic (`src/limiter/`)
- Supports dual algorithms:
  1. **Token Bucket**: Dynamically calculates refilled tokens as a function of elapsed time since last check.
  2. **Exact Sliding Window Log**: Maintains rolling timestamps, prunes expired entries, and counts current requests within the window.

---

## 3. Request Lifecycle for `/v1/check`

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant App as Fastify Server
    participant DB as PostgreSQL 16

    Client->>App: POST /v1/check { "clientKey": "api_usr_123", "cost": 1 }
    App->>App: Validate body schema (TypeBox)
    App->>DB: SELECT * FROM fn_check_rate_limit($1, $2, ...)
    Note over DB: Lock row for clientKey (FOR UPDATE)<br/>Refill tokens or prune sliding logs<br/>Check remaining quota & update state
    DB-->>App: Return (decision, limit, remaining, reset, retry_after)
    App->>App: Format RateLimit-* & Retry-After headers
    App-->>Client: HTTP 200 OK { "decision": "ALLOW" | "DENY", ... }
```

---

## 4. Concurrency Isolation Model

- Contention is partitioned strictly per `clientKey`.
- When 1,000 requests arrive simultaneously across 100 distinct client keys, the database locks 100 independent rows. Requests for different clients execute in parallel across database connections.
- Concurrent requests for the *same* client key serialize at the database row lock, completely eliminating race conditions and quota double-spending.
