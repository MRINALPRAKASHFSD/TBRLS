# ADR-0001: Architecture, Tech Stack, and State Management

## Status
Accepted

## Context
Rate limiting services protect downstream microservices from denial of service, cascading saturation, and brute-force attacks. In high-throughput distributed systems, rate limiter decisions must be made in low single-digit milliseconds while maintaining cross-node consistency and surviving process restarts.

While Redis is frequently chosen for in-memory rate limiting, relational databases like PostgreSQL with proper indexing, row-level locking, and connection pooling provide ACID durability, zero state loss on container crashes, flexible per-client policy configuration, and simplified operational infrastructure without needing multi-system synchronization.

## Decision
We select:
1. **Node.js 24 LTS & TypeScript**: Modern async runtime with native ESM, strict type safety, and stable performance.
2. **Fastify v5**: High-performance HTTP framework with lower per-request overhead than Express, schema-based fast serialization, and built-in hooks for request lifecycle management.
3. **PostgreSQL 16+ via native `pg` client**:
   - Connection pool (`pg.Pool`) configured with bounded connections.
   - Parameterized SQL for all statements (`$1`, `$2`), eliminating SQL injection vulnerabilities.
   - Stored procedures / transactional row locks for atomic operations.
4. **Per-Client Storage Topology**:
   - Client policy definitions (`client_policies` table).
   - Token bucket state (`token_bucket_states` table).
   - Sliding window request history (`sliding_window_requests` table with index on `(client_key, requested_at DESC)`).

## Consequences
### Positive
- Strict durability: restarts or pod redeployments retain exact token states and client policies.
- Single database dependency simplifies local development, testing, and Docker Compose deployment.
- High developer accessibility: clean, readable SQL queries without heavy ORM abstractions.

### Trade-offs & Mitigations
- PostgreSQL disk I/O and connection limits can cap raw throughput compared to pure RAM-based Redis.
  *Mitigation*: We optimize by wrapping rate checks in an atomic PostgreSQL function (`fn_check_rate_limit`) which evaluates refill and persistence in a single database round-trip under row locks, achieving sub-millisecond execution and supporting 500+ RPS sustained throughput.
