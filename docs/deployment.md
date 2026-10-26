# Deployment Guide

TBRLS can be deployed either via Docker Compose for local development and self-contained server environments, or as a standalone container / Node.js service connecting to a managed PostgreSQL cluster.

---

## 1. Prerequisites
- **Node.js**: v24.x LTS (for standalone execution)
- **PostgreSQL**: v16+
- **Docker & Docker Compose**: v2+ (for containerized deployment)

---

## 2. Docker Compose Deployment (Recommended for Local / VMs)

The included `docker-compose.yml` orchestrates both PostgreSQL 16 Alpine and the TBRLS service container.

```bash
# 1. Clone repository and navigate to workspace
cd /path/to/TBRLS

# 2. Configure environment
cp .env.example .env
# Edit .env and change ADMIN_API_KEY and DATABASE_URL if necessary

# 3. Build and launch services
docker compose up --build -d

# 4. Verify running containers
docker compose ps

# 5. Check logs
docker compose logs -f rate-limiter
```

---

## 3. Standalone Node.js Deployment

```bash
# 1. Install production dependencies
npm ci --omit=dev

# 2. Build TypeScript distribution
npm run build

# 3. Run database migrations
DATABASE_URL="postgres://user:password@host:5432/dbname" npm run migrate

# 4. Start production service
NODE_ENV=production DATABASE_URL="postgres://user:password@host:5432/dbname" npm start
```

---

## 4. Environment Variables Reference

| Variable | Description | Default | Required in Production |
| :--- | :--- | :--- | :--- |
| `PORT` | HTTP port to bind | `3000` | No |
| `HOST` | Interface IP to bind | `0.0.0.0` | No |
| `NODE_ENV` | Runtime mode | `development` | Yes (`production`) |
| `LOG_LEVEL` | Pino log level (`debug`, `info`, `warn`, `error`) | `info` | No |
| `ADMIN_API_KEY` | Secret credential for admin endpoints | - | **Yes** |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://localhost:5432/tbrls_dev` | **Yes** |
| `DATABASE_POOL_MIN` | Minimum pool connections | `2` | No |
| `DATABASE_POOL_MAX` | Maximum pool connections | `20` | No |
| `DATABASE_CONNECTION_TIMEOUT_MS` | DB connect timeout in ms | `5000` | No |
| `DEFAULT_POLICY_TYPE` | Default algorithm (`TOKEN_BUCKET` or `SLIDING_WINDOW`) | `TOKEN_BUCKET` | No |
| `DEFAULT_BUCKET_CAPACITY` | Default burst capacity | `10` | No |
| `DEFAULT_BUCKET_REFILL_RATE` | Default refill tokens/sec | `2.0` | No |
| `DEFAULT_WINDOW_LIMIT` | Default sliding window requests limit | `60` | No |
| `DEFAULT_WINDOW_DURATION_SECONDS` | Default sliding window length | `60` | No |
