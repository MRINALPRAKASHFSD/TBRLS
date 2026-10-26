# ADR-0004: Safe Logging & Credential/Client Key Redaction Strategy

## Status
Accepted

## Context
Rate limiters sit at the edge of infrastructure and process sensitive client identifiers (API keys, user tokens, IP addresses, internal microservice names) and admin credentials.
If logs accidentally output client keys or admin authentication secrets, logs become a high-severity data leakage vector (CWE-532: Insertion of Sensitive Information into Log File).

## Decision
1. **Zero Secret Logging**:
   - `ADMIN_API_KEY` and any inbound admin authentication headers (`x-admin-key`, `Authorization`) are strictly redacted at the Fastify logger level.
2. **Client Key Redaction**:
   - In standard HTTP request logs, the request body and URL parameters containing `clientKey` are redacted by Pino's redaction serializer (`body.clientKey`, `headers['x-admin-key']`, `headers.authorization`).
   - In application log messages where tracking is needed, client keys are replaced by a truncated masked string (`clie****`) and a SHA-256 hash preview (`keyHash: ab12cd34...`). The full plaintext client key is **never** printed to stdout or stderr.
3. **Safe Error Handling**:
   - Error responses returned to clients (e.g. 400 Bad Request, 401 Unauthorized, 500 Internal Server Error) return standardized error objects that omit raw stack traces, internal SQL queries, and sensitive system internals in production.

## Consequences
### Positive
- Prevents compliance violations (GDPR, PCI-DSS, SOC 2) related to credential and token leakage in log collectors (Datadog, CloudWatch, ELK).
- Traceability is preserved using secure cryptographic hash identifiers.
