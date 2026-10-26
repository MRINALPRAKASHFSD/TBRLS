# TBRLS Documentation Index

Welcome to the technical documentation for the **Token Bucket Rate Limiter Service (TBRLS)**. This index guides you through the architecture, design decisions, API specifications, and operational guides.

---

## Documentation Directory

| Document | Description | Status |
| :--- | :--- | :--- |
| [Project Overview](file:///Users/mrinalprakash/Desktop/TBRLS/docs/project-overview.md) | High-level goals, problem statement, key requirements, and scope | Complete |
| [Implementation Plan](file:///Users/mrinalprakash/Desktop/TBRLS/docs/implementation-plan.md) | Phased delivery plan, task breakdown, and live verification status | Active / Tracking |
| [System Architecture](file:///Users/mrinalprakash/Desktop/TBRLS/docs/architecture.md) | Component architecture, data flows, and state management | Complete |
| [Security Policy](file:///Users/mrinalprakash/Desktop/TBRLS/docs/security-policy.md) | Security baseline, safe disclosure protocol, and hardening guidelines | Complete |
| [Threat Model](file:///Users/mrinalprakash/Desktop/TBRLS/docs/threat-model.md) | STRIDE threat model, vulnerability vectors, and mitigations | Complete |
| [API Specification](file:///Users/mrinalprakash/Desktop/TBRLS/docs/api.md) | Endpoint contracts, rate limit headers, and validation schemas | Complete |
| [Data Model](file:///Users/mrinalprakash/Desktop/TBRLS/docs/data-model.md) | PostgreSQL schema, tables, indexes, constraints, and migrations | Complete |
| [Algorithms](file:///Users/mrinalprakash/Desktop/TBRLS/docs/algorithms.md) | Token Bucket vs Exact Sliding Window Log mechanics and formulas | Complete |
| [Testing & Load Testing](file:///Users/mrinalprakash/Desktop/TBRLS/docs/testing-and-load-testing.md) | Vitest unit/integration suites and k6 load test results (>=500 RPS) | Updated with Runs |
| [Deployment Guide](file:///Users/mrinalprakash/Desktop/TBRLS/docs/deployment.md) | Docker Compose and production container deployment | Complete |
| [Operations Runbook](file:///Users/mrinalprakash/Desktop/TBRLS/docs/operations-runbook.md) | Monitoring, alerting, health checks, troubleshooting, and failover | Complete |

---

## Architectural Decision Records (ADRs)

Located in [`docs/decisions/`](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/):
- [ADR-0001: Architecture, Stack, and State Management](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/ADR-0001-architecture-and-stack.md)
- [ADR-0002: Concurrency Control and Atomic Rate Checks](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/ADR-0002-atomic-concurrency-control.md)
- [ADR-0003: Token Bucket vs. Sliding Window Algorithms](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/ADR-0003-token-bucket-and-sliding-window.md)
- [ADR-0004: Safe Logging & Secret Redaction Strategy](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/ADR-0004-safe-logging-and-secret-redaction.md)
- [ADR-0005: Fail-Closed Posture on Database Outages](file:///Users/mrinalprakash/Desktop/TBRLS/docs/decisions/ADR-0005-fail-closed-error-posture.md)
