# TBRLS: Token Bucket Rate Limiter Service - Agent Guidelines

Welcome to the **TBRLS** repository. This document defines persistent operational rules, architectural constraints, and engineering workflows for AI agents (and human engineers) working in this codebase.

---

## 1. Project Mission & Core Stack

TBRLS is a production-grade, beginner-friendly, distributed rate limiter service designed to evaluate request admission control under high concurrency.

- **Runtime**: Node.js 24 LTS (ESM module format)
- **Language**: TypeScript (`ES2024`, `NodeNext` resolution)
- **Web Framework**: Fastify v5
- **Database**: PostgreSQL 16+ using the official `pg` driver with parameterized SQL
- **Validation**: `@sinclair/typebox` for JSON schema compilation
- **Testing**: Vitest for unit & integration tests, k6 for load testing
- **Deployment**: Docker Compose & multi-stage Alpine Dockerfile

---

## 2. Inviolable Architectural & Security Rules

1. **Zero Unparameterized SQL**:
   - Every single database query MUST use parameterized placeholders (`$1`, `$2`, etc.) via the `pg` pool. String concatenation or template literal interpolation into SQL is strictly forbidden.
2. **Absolute Log Privacy (No Secret Leakage)**:
   - Client keys (`clientKey`) and admin credentials (`ADMIN_API_KEY`, Bearer tokens, `X-Admin-Key`) **MUST NEVER** appear in application logs or standard error outputs in plain text.
   - For tracing, log only masked keys (e.g., `clie****`) or cryptographic SHA-256 hashes (`keyHash: a1b2...`).
3. **Fail-Closed on Storage Failure**:
   - If PostgreSQL is down, unreachable, or throws an unhandled pool error, `/v1/check` **MUST return HTTP 503 Service Unavailable** rather than allowing traffic through. We fail closed to protect downstream microservices from catastrophic cascading surges.
4. **Strict Concurrency Safety**:
   - All rate limit evaluation transactions must maintain ACID atomicity via row-level locking (`SELECT ... FOR UPDATE`) or atomic PostgreSQL stored procedures. Concurrent requests for the same client key must serialize to prevent double-spending quota.
5. **Accurate Documentation Standard**:
   - Never document a feature as "Verified" unless tests or execution checks have actually run in the current environment.
   - Never invent fictional security contact emails or unverified certifications.

---

## 3. Directory Layout

```
TBRLS/
├── AGENTS.md                  # Persistent AI agent instructions (this file)
├── README.md                  # Project overview and quickstart
├── Dockerfile                 # Multi-stage production container
├── docker-compose.yml         # Containerized Postgres + App topology
├── docs/                      # Comprehensive technical documentation
│   ├── index.md               # Documentation map & index
│   ├── project-overview.md    # Problem statement, requirements, & scope
│   ├── implementation-plan.md # Phased delivery plan with status tracking
│   ├── architecture.md        # System architecture & component design
│   ├── security-policy.md     # Security posture & vulnerability reporting
│   ├── threat-model.md        # STRIDE threat model & mitigations
│   ├── api.md                 # OpenAPI / HTTP endpoint specification
│   ├── data-model.md          # PostgreSQL schemas, indexes, & migrations
│   ├── algorithms.md          # Token Bucket & Sliding Window mechanics
│   ├── testing-and-load-testing.md # Vitest suite & k6 benchmarks
│   ├── deployment.md          # Deployment options & container operations
│   ├── operations-runbook.md  # Day-2 runbook: monitoring, alerts, failovers
│   └── decisions/             # Architecture Decision Records (ADRs)
├── src/                       # Application source code
│   ├── config.ts              # Strongly-typed environment configuration
│   ├── server.ts              # HTTP entrypoint & graceful shutdown
│   ├── app.ts                 # Fastify app factory & plugin registration
│   ├── db/                    # PostgreSQL pool & automated migrations
│   ├── limiter/               # Token Bucket & Sliding Window logic
│   ├── routes/                # Route handlers (/v1/check, /v1/admin, /healthz)
│   ├── plugins/               # Fastify plugins (auth, redaction, logging)
│   └── utils/                 # Hashing & masking utilities
├── tests/                     # Unit, integration, and concurrency tests
└── load-tests/                # k6 load testing scripts (>=500 RPS)
```

---

## 4. Common Developer Workflows

```bash
# 1. Install dependencies
npm install

# 2. Run database migrations
npm run migrate

# 3. Start development server with live reload
npm run dev

# 4. Build TypeScript to dist
npm run build

# 5. Run unit & integration tests
npm test

# 6. Execute k6 load test (500+ requests/sec target)
npm run load-test
```

---

## 5. Decision Records & Documentation Sync

Whenever changing data models, algorithm formulas, authentication mechanisms, or failure behaviors:
1. Create or update an ADR in `docs/decisions/`.
2. Update `docs/data-model.md`, `docs/algorithms.md`, and `docs/api.md`.
3. Mark task completion status in `docs/implementation-plan.md` only after verification.
