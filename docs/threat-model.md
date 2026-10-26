# Threat Model (STRIDE Methodology)

This document analyzes potential security threats against the **Token Bucket Rate Limiter Service** using the STRIDE classification model.

---

## 1. System Assets & Boundaries
- **Assets**:
  - Rate limiting quota balances (token states and request logs).
  - Admin credentials (`ADMIN_API_KEY`).
  - Client identifiers (`clientKey`).
  - Downstream service stability (protected by the limiter).
- **Trust Boundaries**:
  - Public Internet / Ingress Gateways <--> Fastify HTTP Server.
  - Fastify HTTP Server <--> PostgreSQL Database.
  - Fastify Application <--> System Logs (stdout/stderr).

---

## 2. STRIDE Threat Analysis

### 2.1 Spoofing (Identity)
- **Threat**: An attacker attempts to forge admin requests to modify rate limits or clear penalties.
- **Mitigation**: Admin endpoints require the `X-Admin-Key` or `Authorization: Bearer <key>` header matched against `ADMIN_API_KEY` using `crypto.timingSafeEqual` to thwart timing-attack side channels.
- **Status**: Implemented & Enforced.

### 2.2 Tampering (Data Integrity)
- **Threat**: SQL injection through malicious `clientKey` strings (e.g. `' OR '1'='1`).
- **Mitigation**:
  1. Strict regex input validation rejects SQL characters.
  2. 100% of database queries use parameterized SQL `$1`, `$2` placeholders.
- **Status**: Implemented & Enforced.

### 2.3 Repudiation
- **Threat**: Disputed administrative changes to client policies.
- **Mitigation**: Administrative route mutations emit structured audit log events with timestamp and masked client identifier.
- **Status**: Implemented & Enforced.

### 2.4 Information Disclosure (Privacy)
- **Threat**: Plaintext client keys, API tokens, or admin keys exposed via access logs or error messages.
- **Mitigation**:
  1. Pino logger configured with field redaction for auth headers and request bodies.
  2. Truncated masking (`clie****`) and SHA-256 hash digests are used for diagnostic traces.
  3. Safe error responses omit internal database error details and stack traces.
- **Status**: Implemented & Enforced.

### 2.5 Denial of Service (Availability)
- **Threat A**: Quota double-spending via high-concurrency race condition attacks.
- **Mitigation**: Row-level locking (`SELECT ... FOR UPDATE`) in PostgreSQL serializes concurrent requests per client key.
- **Threat B**: Cascading failure when PostgreSQL goes down.
- **Mitigation**: Fail-closed architecture returns HTTP 503 rather than allowing unthrottled traffic to reach downstream services.
- **Status**: Implemented & Enforced.

### 2.6 Elevation of Privilege
- **Threat**: Unprivileged client invoking admin policy routes.
- **Mitigation**: Fastify pre-handler authentication hook enforces strict rejection with HTTP 401 Unauthorized before route handler execution.
- **Status**: Implemented & Enforced.
