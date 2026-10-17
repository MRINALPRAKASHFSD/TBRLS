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
- The table `sliding_window_requests` stores granted timestamps and auto-prunes on check for active clients.
- For inactive clients who stop sending requests, records must be pruned using the background maintenance CLI:
  ```bash
  # Prune expired requests across all clients in safe batches (5000 per batch)
  npm run cleanup:sliding-window

  # Or run full maintenance including metric retention pruning
  npm run cleanup:all
  ```
- If high traffic creates PostgreSQL dead tuples:
  ```sql
  -- Check table size and dead tuple count
  SELECT relname, n_dead_tup, n_live_tup FROM pg_stat_user_tables WHERE relname = 'sliding_window_requests';
  -- Run manual vacuum
  VACUUM ANALYZE sliding_window_requests;
  ```

---

## 4. Scheduled Maintenance & Cron Automation

Do not rely solely on active traffic to prune database records. Operators should configure recurring background maintenance jobs:

### Linux Crontab Configuration
```cron
# Every 10 minutes: Clean up expired sliding-window logs across all clients
*/10 * * * * cd /opt/tbrls && npm run cleanup:sliding-window >> /var/log/tbrls-cleanup.log 2>&1

# Daily at 02:00 UTC: Prune rate limit metrics older than 24 hours
0 2 * * * cd /opt/tbrls && npm run cleanup:metrics -- --retention-hours=24 >> /var/log/tbrls-metrics-cleanup.log 2>&1
```

### Kubernetes CronJob Specification
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: tbrls-storage-cleanup
spec:
  schedule: "*/10 * * * *"
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: cleanup
            image: tbrls:latest
            command: ["npm", "run", "cleanup:all"]
            envFrom:
            - configMapRef:
                name: tbrls-config
            - secretRef:
                name: tbrls-secrets
          restartPolicy: OnFailure
```

---

## 5. Live Operations Dashboard & Telemetry

- **Dashboard URL**: `http://<tbrls-host>:3000/admin/dashboard` (or `/admin`).
- **Authentication**: Enter `ADMIN_API_KEY`. The credential is kept **strictly in volatile browser memory** and sent via `X-Admin-Key` header on fetch calls.
- **Performance Trade-offs & Disclosures**:
  - Telemetry is recorded atomically inside `fn_check_rate_limit` per client per minute.
  - Benchmarks confirm sustained throughput exceeding 500 RPS with average latency < 1ms.
  - To prevent unbounded metric table growth over time, the retention cleanup cron (`npm run cleanup:metrics`) must be run at least once daily.

