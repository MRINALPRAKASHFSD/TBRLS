# API Specification

The TBRLS service exposes RESTful JSON endpoints over HTTP/1.1.

---

## 1. Rate Check Endpoint

### `POST /v1/check`
Evaluates whether a request for a client key is permitted under their active rate limit policy.

#### Authentication
`POST /v1/check` is an internal service-to-service endpoint protected by `CHECK_API_KEY`. Callers must supply one of:
- Header `X-Check-Key: <CHECK_API_KEY>`
- Header `Authorization: Bearer <CHECK_API_KEY>`
- Header `X-API-Key: <CHECK_API_KEY>`

> [!IMPORTANT]
> **Client Key Provenance**: The payload field `clientKey` identifies the quota owner (e.g., end-user ID, tenant, client IP, or upstream application credential) and **MUST** be supplied by an authenticated upstream caller (e.g., reverse proxy or API gateway). It is never used as an API authentication secret for TBRLS itself.

#### Request Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Content-Type` | String | Yes | Must be `application/json` |
| `X-Check-Key` | String | Conditional | Service-to-service check credential (or `Authorization: Bearer <key>`) |

#### Request Body Schema
```json
{
  "clientKey": "client-user-94821",
  "cost": 1
}
```

| Field | Type | Required | Default | Validation / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `clientKey` | String | Yes | - | Length 1-128 chars. Allowed characters: `a-z`, `A-Z`, `0-9`, `_`, `-`, `:`, `.` |
| `cost` | Integer | No | `1` | Minimum: `1`, Maximum: `10000` |

#### Response Headers
| Header | Description |
| :--- | :--- |
| `RateLimit-Limit` | Maximum quota capacity (bucket capacity or sliding window request limit) |
| `RateLimit-Remaining` | Remaining tokens or permitted requests in active quota |
| `RateLimit-Reset` | Integer seconds until quota replenishes. For Sliding Window on `DENY`, this strictly equals `Retry-After` (time until the earliest request expires). On `ALLOW`, it indicates seconds until the active window clears. |
| `Retry-After` | Present **only** when `decision == "DENY"`. Integer seconds client must wait before retrying. |

#### Successful Decision Response (HTTP 200 OK)
Note: Valid rate checks always return HTTP 200 with an `"ALLOW"` or `"DENY"` decision in the JSON body.

##### Allowed Response Example
```json
{
  "decision": "ALLOW",
  "policyType": "TOKEN_BUCKET",
  "limit": 10,
  "remaining": 9,
  "reset": 1,
  "retryAfter": null
}
```

##### Denied Response Example
```json
{
  "decision": "DENY",
  "policyType": "TOKEN_BUCKET",
  "limit": 10,
  "remaining": 0,
  "reset": 5,
  "retryAfter": 5
}
```

#### Error Responses
- **HTTP 401 Unauthorized**: Missing or invalid `CHECK_API_KEY`.
  ```json
  {
    "statusCode": 401,
    "error": "Unauthorized",
    "message": "Invalid or missing check API key"
  }
  ```
- **HTTP 400 Bad Request**: Invalid JSON payload, malformed `clientKey`, invalid `cost`, or requested `cost` exceeding capacity/limit.
  - *Impossible Cost (Token Bucket)*:
    ```json
    {
      "statusCode": 400,
      "error": "Bad Request",
      "message": "COST_EXCEEDS_CAPACITY: Requested cost 50 exceeds client bucket capacity 10.0000"
    }
    ```
  - *Impossible Cost (Sliding Window)*:
    ```json
    {
      "statusCode": 400,
      "error": "Bad Request",
      "message": "COST_EXCEEDS_LIMIT: Requested cost 15 exceeds client sliding window limit 10"
    }
    ```
    > [!NOTE]
    > When `cost` exceeds the maximum capacity or window limit, the request can never succeed under any delay. It is rejected immediately before mutating rate limiter state, and no `Retry-After` header is returned.
    > For sliding-window denials where $1 < \text{cost} \le \text{windowLimit}$, `Retry-After` is calculated to the expiration of the $m$-th oldest request ($m = N + \text{cost} - \text{limit}$), ensuring the client waits until enough requests have expired for the whole batch to fit.
- **HTTP 503 Service Unavailable**: PostgreSQL connection lost or storage unavailable (Fail-Closed).
  ```json
  {
    "statusCode": 503,
    "error": "Service Unavailable",
    "message": "Rate limiter storage service unavailable"
  }
  ```

---

## 2. Admin Policy Management Endpoints

All admin endpoints require authentication via:
- Header `X-Admin-Key: <ADMIN_API_KEY>` or
- Header `Authorization: Bearer <ADMIN_API_KEY>`

### `PUT /v1/admin/policies/:clientKey`
Creates or updates a client's rate limiting policy.

#### URL Parameters
- `clientKey`: Target client identifier.

#### Request Body (Token Bucket)
```json
{
  "policyType": "TOKEN_BUCKET",
  "capacity": 20,
  "refillRate": 5.0
}
```

#### Request Body (Sliding Window)
```json
{
  "policyType": "SLIDING_WINDOW",
  "windowLimit": 100,
  "windowDurationSeconds": 60
}
```

#### Response (HTTP 200 OK)
```json
{
  "success": true,
  "message": "Policy updated successfully",
  "policy": {
    "clientKey": "client-user-94821",
    "policyType": "TOKEN_BUCKET",
    "capacity": 20,
    "refillRate": 5.0,
    "windowLimit": null,
    "windowDurationSeconds": null,
    "updatedAt": "2026-10-26T16:30:00.000Z"
  }
}
```

### `GET /v1/admin/policies/:clientKey`
Retrieves the configured policy and active state for a specific client.

#### Response (HTTP 200 OK - Token Bucket)
```json
{
  "found": true,
  "policy": {
    "clientKey": "client-user-94821",
    "policyType": "TOKEN_BUCKET",
    "capacity": 20,
    "refillRate": 5.0
  },
  "state": {
    "tokens": 18.4,
    "lastRefillAt": "2026-10-26T16:32:10.000Z"
  }
}
```

#### Response (HTTP 200 OK - Sliding Window)
Only active requests within the configured rolling window (`requested_at >= NOW() - windowDurationSeconds`) are included in `requestCount`.
```json
{
  "found": true,
  "policy": {
    "clientKey": "client-user-94821",
    "policyType": "SLIDING_WINDOW",
    "windowLimit": 100,
    "windowDurationSeconds": 60
  },
  "state": {
    "requestCount": 42,
    "oldestRequestAt": "2026-10-26T16:31:45.000Z"
  }
}
```

### `DELETE /v1/admin/policies/:clientKey`
Deletes a client's custom policy and resets their state to system defaults.

#### Response (HTTP 200 OK)
```json
{
  "success": true,
  "message": "Policy and state removed"
}
```

---

## 3. Operational Metrics & Live Dashboard Endpoints

### `GET /v1/admin/metrics`
Retrieves paginated historical rate limit activity aggregated per client per minute. Requires `ADMIN_API_KEY`.

#### Query Parameters
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `page` | Integer | No | `1` | Page number (1-indexed) |
| `limit` | Integer | No | `20` | Items per page (max 100) |
| `clientKey` | String | No | - | Filter metrics for a specific client |
| `from` | ISO Timestamp | No | - | Lower bound time range |
| `to` | ISO Timestamp | No | - | Upper bound time range |

#### Response (HTTP 200 OK)
```json
{
  "metrics": [
    {
      "clientKey": "client-user-94821",
      "bucketMinute": "2026-10-27T05:53:00.000Z",
      "allowCount": 54,
      "denyCount": 12,
      "totalRequests": 66
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalRecords": 1,
    "totalPages": 1
  }
}
```

### `GET /v1/admin/metrics/summary`
Retrieves aggregated telemetry over the last hour. Requires `ADMIN_API_KEY`.

#### Response (HTTP 200 OK)
```json
{
  "activeClientsCount": 25,
  "totalRequests": 11000,
  "totalAllowed": 1225,
  "totalDenied": 9775,
  "denialRatePercent": 88.86
}
```

### `GET /admin/dashboard`
Serves the self-contained live operational dashboard HTML.
- **In-Memory Security**: The dashboard prompts the operator for `ADMIN_API_KEY`. The secret is held **only in volatile JavaScript memory** and sent via `X-Admin-Key` header on fetch calls. It is never written to `localStorage`, `sessionStorage`, cookies, or the URL.
- `GET /admin` redirects with HTTP 302 to `/admin/dashboard`.

---

## 4. Health & Observability Endpoints

### `GET /healthz`
Liveness probe. Returns HTTP 200 if the Node.js process is active and accepting connections.
```json
{
  "status": "ok",
  "timestamp": "2026-10-26T16:35:00.000Z"
}
```

### `GET /readyz`
Readiness probe. Executes `SELECT 1;` against the PostgreSQL connection pool.
- If connected: HTTP 200 OK `{ "status": "ready", "database": "connected" }`
- If disconnected: HTTP 503 Service Unavailable `{ "status": "unready", "database": "disconnected" }`

