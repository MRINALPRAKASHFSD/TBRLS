# ADR-0005: Fail-Closed Error Posture on Database Unavailability

## Status
Accepted

## Context
When the underlying storage layer (PostgreSQL) experiences an outage, network partition, connection pool exhaustion, or restart, the rate limiting service must decide how to respond to inbound `/v1/check` requests.
Systems traditionally choose between two postures:
1. **Fail-Open**: Allow all requests when storage fails so client traffic is not disrupted.
2. **Fail-Closed**: Reject or error requests when storage fails to protect downstream resources from being overwhelmed by unthrottled traffic.

## Decision
We enforce a **Fail-Closed** security and reliability posture:
- If PostgreSQL is disconnected, unreachable, or fails to execute the rate check within `DATABASE_CONNECTION_TIMEOUT_MS`, `/v1/check` **MUST return HTTP 503 Service Unavailable** with error payload:
  ```json
  {
    "statusCode": 503,
    "error": "Service Unavailable",
    "message": "Rate limiter storage service unavailable"
  }
  ```
- The service **MUST NOT** return HTTP 200 `ALLOW` when the database fails.
- The readiness endpoint (`GET /readyz`) verifies the database connection via `SELECT 1;` and returns HTTP 503 during outages, allowing container orchestrators (Kubernetes / Docker Compose / AWS ECS) to withdraw traffic from unhealthy instances.

## Consequences
### Positive
- Downstream services are protected from thundering herds and cascading failures during database recovery.
- Explicit status code (HTTP 503) informs upstream reverse proxies (Nginx, Envoy, Cloudflare) that the service is temporarily degraded, enabling standard upstream retry mechanisms with exponential backoff.

### Negative
- End clients cannot perform rate-checked operations while the database is down. This trade-off is accepted as rate enforcement integrity is paramount.
