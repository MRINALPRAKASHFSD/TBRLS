# ADR-0002: Concurrency Control and Atomic Rate Check Strategy in PostgreSQL

## Status
Accepted

## Context
When multiple HTTP requests for the same client key arrive concurrently across different threads or worker processes, a naive check-then-act pattern (`SELECT tokens ...; if (tokens > 0) UPDATE tokens ...;`) suffers from Time-of-Check to Time-of-Use (TOCTOU) race conditions. In a high-concurrency burst, 50 simultaneous requests could all read `tokens = 1`, grant 50 requests, and double-spend the client's quota.

## Decision
We enforce strict row-level serialization in PostgreSQL:
1. **Row-Level Mutual Exclusion (`SELECT ... FOR UPDATE`)**:
   - For a given `client_key`, the state row in `client_policies` or `token_bucket_states` is locked exclusively using `FOR UPDATE`.
   - Concurrent requests for the *same client key* queue cleanly at the database row lock until the active check finishes and commits its new token count.
   - Concurrent requests for *different client keys* target different rows and execute entirely in parallel without blocking each other.
2. **First-Time Client Initialization Safety**:
   - When a client key is seen for the first time, a concurrency conflict could occur if two requests simultaneously attempt to insert the client record.
   - We utilize `INSERT INTO ... ON CONFLICT (client_key) DO NOTHING;` followed immediately by the locking `SELECT ... FOR UPDATE`. This guarantees that first-time client records are created idempotently without race exceptions.
3. **Single Database Round-Trip (`fn_check_rate_limit`)**:
   - Instead of transmitting multiple round-trips over TCP (`BEGIN -> INSERT -> SELECT FOR UPDATE -> UPDATE -> COMMIT`), the entire calculation is executed inside a single PostgreSQL PL/pgSQL function.
   - This reduces latency from ~5-10ms down to <1ms, avoiding round-trip holding of row locks.

## Consequences
### Positive
- Zero double-spending: 100% mathematical consistency guaranteed by PostgreSQL transaction isolation.
- Fast execution under high concurrency.
- Contention is strictly isolated to requests sharing the exact same `client_key`.

### Negative
- A client hitting the limiter with extreme concurrency (e.g., thousands of RPS for a single key) will serialize on their specific row. This is intentional: rate limiters exist precisely to throttle clients attempting excessive concurrent bursts.
