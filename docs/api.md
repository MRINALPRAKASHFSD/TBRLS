# API Specification

The TBRLS service exposes RESTful JSON endpoints over HTTP/1.1.

---

## 1. Rate Check Endpoint

### `POST /v1/check`
Evaluates whether a request for a client key is permitted under their active rate limit policy.

#### Request Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Content-Type` | String | Yes | Must be `application/json` |

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
| `RateLimit-Limit` | Maximum quota capacity (bucket capacity or window request limit) |
| `RateLimit-Remaining` | Remaining tokens or permitted requests remaining in active quota |
| `RateLimit-Reset` | Integer seconds until the quota is replenished or current window resets |
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
- **HTTP 400 Bad Request**: Invalid JSON payload, malformed `clientKey`, or invalid `cost`.
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "body/clientKey must match pattern ^[a-zA-Z0-9_\\-\\:\\.]{1,128}$"
  }
  ```
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
  "limit": 100,
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

#### Response (HTTP 200 OK)
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

## 3. Health & Observability Endpoints

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
