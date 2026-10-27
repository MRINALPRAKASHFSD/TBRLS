# Threat Model (STRIDE Methodology)

This document analyzes potential security threats against the **Token Bucket Rate Limiter Service** using the STRIDE classification model.

---

## 1. System Assets & Boundaries
- **Assets**:
  - Rate limiting quota balances (token states and request logs).
  - Service-to-service check credentials (`CHECK_API_KEY`).
  - Administrative management credentials (`ADMIN_API_KEY`).
  - Client identifiers (`clientKey`).
  - Downstream service stability (protected by the limiter).
- **Trust Boundaries**:
  - Ingress Gateways / Upstream Microservices <--> Fastify Rate Limiter (`POST /v1/check`).
    - *Provenance Invariant*: `POST /v1/check` is an authenticated internal API. The caller authenticates with `CHECK_API_KEY`. The payload's `clientKey` represents the target quota owner (e.g., authenticated tenant, user ID, or verified API key ID) and must be provided by the authenticated upstream service.
  - Operations / Administrators <--> Fastify Administrative API (`/v1/admin/*`).
  - Fastify HTTP Server <--> PostgreSQL Database.
  - Fastify Application <--> System Logs (stdout/stderr).

---

## 2. STRIDE Threat Analysis

### 2.1 Spoofing (Identity)
- **Threat A**: An attacker attempts to forge admin requests to modify rate limits or clear penalties.
  - *Mitigation*: Admin endpoints require `X-Admin-Key` or `Authorization: Bearer <key>` matched against `ADMIN_API_KEY` using `crypto.timingSafeEqual`.
- **Threat B**: An unauthorized client or external agent invokes `POST /v1/check` directly to exhaust database capacity or tamper with client quota balances.
  - *Mitigation*: `POST /v1/check` requires a dedicated service-to-service credential (`CHECK_API_KEY`) via `X-Check-Key`, `X-API-Key`, or `Authorization: Bearer`. `clientKey` must be supplied by an authenticated upstream gateway.
- **Status**: Implemented & Enforced.

### 2.2 Tampering (Data Integrity)
- **Threat**: SQL injection through malicious `clientKey` strings (e.g. `' OR '1'='1`).
- **Mitigation**:
  1. Strict regex input validation rejects SQL characters.
  2. 100% of database queries use parameterized SQL `$1`, `$2` placeholders.
- **Status**: Implemented & Enforced.

### 2.3 Repudiation
- **Threat**: Disputed administrative changes to client policies.
- **Mitigation**: Administrative route mutations emit structured audit log events with timestamp, policy type, and masked client identifier.
- **Status**: Implemented & Enforced.

### 2.4 Information Disclosure (Privacy)
- **Threat**: Plaintext client keys, API tokens, admin keys, or check keys exposed via access logs or error messages.
- **Mitigation**:
  1. Pino logger configured with field redaction for auth headers (`x-admin-key`, `x-check-key`, `x-api-key`, `authorization`) and request bodies (`clientKey`).
  2. Truncated masking (`clie****`) and SHA-256 hash digests are used for diagnostic traces.
  3. Safe error responses omit internal database error details and stack traces.
  4. Route template logging (`/v1/admin/policies/:clientKey`) logs parameterized path signatures rather than raw URL paths. Unmatched paths log a generic safe placeholder (`<unmatched>`), ensuring path segments cannot leak tokens or client keys.
  5. Safe query-parameter allowlist: only operational parameters (`page`, `limit`) are preserved in request logs; all credentials and arbitrary query parameters (`x-admin-key`, `access_token`, `password`, `clientKey`, etc.) and their values are completely omitted.
- **Status**: Implemented & Enforced.

### 2.5 Denial of Service (Availability)
- **Threat A**: Quota double-spending via high-concurrency race condition attacks.
  - *Mitigation*: Row-level locking (`SELECT ... FOR UPDATE`) in PostgreSQL serializes concurrent requests per client key.
- **Threat B**: Cascading failure when PostgreSQL goes down.
  - *Mitigation*: Fail-closed architecture returns HTTP 503 rather than allowing unthrottled traffic to reach downstream services.
- **Threat C**: Insecure production deployment with default placeholder keys.
  - *Mitigation*: Production startup validator refuses to start the application if `ADMIN_API_KEY` or `CHECK_API_KEY` is missing, empty, or set to a placeholder.
- **Status**: Implemented & Enforced.

### 2.6 Elevation of Privilege
- **Threat**: Credential confusion or privilege escalation between check callers and admin callers.
- **Mitigation**: Strict credential separation:
  - `CHECK_API_KEY` grants access only to `POST /v1/check` and is rejected by admin routes.
  - `ADMIN_API_KEY` grants access to `/v1/admin/*` and is rejected by check routes.
- **Status**: Implemented & Enforced.
