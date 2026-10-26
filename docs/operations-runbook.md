# Operations Runbook: Day-2 Management & Incident Response

This runbook guides Site Reliability Engineers (SREs) and operators in maintaining, monitoring, and debugging the TBRLS service in production.

---

## 1. Health Checks & Probes

| Probe Type | URL | Expected Response | Description |
| :--- | :--- | :--- | :--- |
| **Liveness** | `GET /healthz` | HTTP 200 `{"status":"ok"}` | Checks if Fastify event loop is responsive |
| **Readiness** | `GET /readyz` | HTTP 200 `{"status":"ready","database":"connected"}` | Checks active PostgreSQL connectivity |

### Kubernetes Probe Configuration
```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

---

## 2. Key Metrics & Alert Thresholds

| Metric | Source | Warning Threshold | Critical Threshold | Action |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP 503 Rate** | Ingress / Fastify | > 0.5% for 2m | > 2% for 1m | Check PostgreSQL health and pool exhaustion |
| **Check Latency (p95)** | Ingress / Fastify | > 20ms | > 50ms | Inspect database lock waits and query duration |
| **Check Latency (p99)** | Ingress / Fastify | > 50ms | > 100ms | Check for hotspot client keys serializing |
| **Pool Active Conns** | PostgreSQL | > 80% pool max | = 100% pool max | Increase `DATABASE_POOL_MAX` or scale DB read/write |

---

## 3. Incident Troubleshooting Workflows

### Incident 1: High Rate of HTTP 503 Service Unavailable
1. **Verify Readiness**:
   ```bash
   curl -i http://localhost:3000/readyz
   ```
2. **Inspect PostgreSQL Logs**:
   Look for connection limits reached (`FATAL: remaining connection slots are reserved for non-replication superuser connections`).
3. **Inspect Connection Pool Settings**:
   Ensure `DATABASE_POOL_MAX` aligns with PostgreSQL's `max_connections` divided by the number of running service instances.

### Incident 2: Single Client Key Experiencing High Latency
- When an upstream system hammers TBRLS with extreme concurrency for the *same* `clientKey` (e.g. 2,000 RPS for `client-abc`), PostgreSQL serializes those queries on that single row (`SELECT ... FOR UPDATE`).
- Identify the client key via the hashed traces (`keyHash`) in logs.
- Advise the upstream client to batch checks or cache granted permissions for several seconds.

### Incident 3: Database Disk Growth from Sliding Window Logs
- The table `sliding_window_requests` stores granted timestamps and auto-prunes on check.
- If high volume creates PostgreSQL dead tuples:
  ```sql
  -- Check table size and dead tuple count
  SELECT relname, n_dead_tup, n_live_tup FROM pg_stat_user_tables WHERE relname = 'sliding_window_requests';
  -- Run manual vacuum
  VACUUM ANALYZE sliding_window_requests;
  ```
