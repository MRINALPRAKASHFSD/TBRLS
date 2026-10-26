# Security Policy & Posture

## 1. Security Overview
TBRLS is designed with defense-in-depth principles appropriate for infrastructure edge components. Rate limiters are critical security controls: their availability and integrity directly dictate whether downstream services survive malicious traffic surges.

---

## 2. Security Controls & Implementation Status

| Control Category | Implementation Mechanism | Status |
| :--- | :--- | :--- |
| **SQL Injection Prevention** | 100% parameterized queries using PostgreSQL `$1`, `$2` placeholders. Zero dynamic query concatenation. | Complete & Enforced |
| **Administrative Access Control** | Constant-time comparison (`crypto.timingSafeEqual`) of `ADMIN_API_KEY` via `X-Admin-Key` or `Authorization: Bearer`. | Complete & Enforced |
| **Credential & Secret Redaction** | Pino log redaction paths on headers and request bodies. Masking of client keys (`clie****`) and SHA-256 key hashing. Plaintext keys and admin secrets are never logged. | Complete & Enforced |
| **Fail-Closed Availability Posture** | Fast failure returning HTTP 503 if PostgreSQL is disconnected or unready. Never fails open. | Complete & Enforced |
| **Input Sanitization & Schema Validation** | Fastify TypeBox compilation with strict bounds (`clientKey` max 128 chars, alphanumeric/symbols pattern, `cost` integer >= 1). | Complete & Enforced |
| **Denial of Service (DoS) Hardening** | Fastify body size limits (default 1MB, bounded to 16KB for check payloads) and connection timeouts. | Complete & Enforced |
| **Container Security** | Multi-stage Docker build, non-root user execution (`USER node`), read-only container root readiness. | Complete & Enforced |

---

## 3. Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it through the repository's official GitHub Issues / Security Advisories workflow or reach out to the project maintainers via the repository management dashboard.

Please include:
- A descriptive summary of the vulnerability.
- Proof of Concept (PoC) steps to reproduce.
- Potential impact and severity assessment.

All verified reports will be reviewed promptly. Please do not submit public vulnerability disclosures before a patch is coordinated.
