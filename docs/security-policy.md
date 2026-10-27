# Security Policy & Posture

## 1. Security Overview
TBRLS is designed with defense-in-depth principles appropriate for infrastructure edge components. Rate limiters are critical security controls: their availability and integrity directly dictate whether downstream services survive malicious traffic surges.

---

## 2. Security Controls & Implementation Status

| Control Category | Implementation Mechanism | Status |
| :--- | :--- | :--- |
| **SQL Injection Prevention** | 100% parameterized queries using PostgreSQL `$1`, `$2` placeholders. Zero dynamic query concatenation. | Complete & Enforced |
| **Service-to-Service Check Auth** | Mandatory `CHECK_API_KEY` validated timing-safely via `X-Check-Key`, `X-API-Key`, or `Authorization: Bearer` on `POST /v1/check`. | Complete & Enforced |
| **Administrative Access Control** | Constant-time comparison (`crypto.timingSafeEqual`) of `ADMIN_API_KEY` via `X-Admin-Key` or `Authorization: Bearer`. Kept strictly separated from check credentials. | Complete & Enforced |
| **In-Memory Dashboard Security** | Admin UI (`/admin/dashboard`) holds credentials strictly in volatile JavaScript closure memory. Zero storage in `localStorage`, `sessionStorage`, cookies, or URL parameters. | Complete & Enforced |
| **Production Secret Validation** | Service startup halts immediately in production (`NODE_ENV=production`) if either `ADMIN_API_KEY` or `CHECK_API_KEY` is missing, empty, or set to a placeholder. | Complete & Enforced |
| **Credential & Secret Redaction** | Pino log redaction on headers and bodies (`x-admin-key`, `x-check-key`, `x-api-key`, `authorization`, `clientKey`). Route template logging (`/v1/admin/policies/:clientKey`), generic safe placeholder (`<unmatched>`) for unrouted paths, strict query allowlist (preserving only `page` and `limit`, omitting `x-admin-key`, `access_token`, `password`, etc.), client key masking (`clie****`), and SHA-256 key hashing. | Complete & Enforced |
| **Fail-Closed Availability Posture** | Fast failure returning HTTP 503 if PostgreSQL is disconnected or unready. Never fails open. | Complete & Enforced |
| **Input Sanitization & Schema Validation** | Fastify TypeBox compilation with strict bounds (`clientKey` max 128 chars, alphanumeric/symbols pattern, `cost` integer >= 1). | Complete & Enforced |
| **Denial of Service (DoS) Hardening** | Fastify body size limits (default 1MB, bounded to 16KB for check payloads) and connection timeouts. | Complete & Enforced |
| **Container Security** | Multi-stage Docker build, non-root user execution (`USER node`), read-only container root readiness. | Complete & Enforced |

---

## 3. Reporting a Vulnerability

- **Private Reporting Contact**: To be configured (pending setup of a dedicated private security channel).
- **Interim Disclosure Guidance**: Because no dedicated private security reporting address or external coordination inbox is currently configured, please do not disclose potential unpatched vulnerabilities publicly. When an official private reporting contact is established, this section will be updated with the verified contact details and PGP key.
