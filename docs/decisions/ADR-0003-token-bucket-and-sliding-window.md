# ADR-0003: Token Bucket vs. Sliding Window Algorithms & Exactness

## Status
Accepted

## Context
Rate limiting algorithms differ in their memory characteristics, burst allowances, and boundary smoothness:
- **Token Bucket**: Allows burst capacity up to a maximum bucket size while continuously refilling tokens at a steady rate per second. Highly suited for APIs allowing bursty user interactions while maintaining an average rate.
- **Sliding Window**: Restricts a fixed maximum count of requests over a sliding time span (e.g., 60 requests in the rolling last 60 seconds).
  - *Approximate Sliding Window (Counter/Weighted)*: Uses time buckets and weighted averages between the current and previous bucket. Fast and low storage, but can introduce ~5% boundary inaccuracies.
  - *Exact Sliding Window (Log)*: Records exact timestamps of granted requests. Automatically prunes events older than `now - window_duration` and counts active timestamps. 100% exact boundary enforcement with zero approximation error.

## Decision
1. **Support Both Policy Types**:
   - Each client can be explicitly assigned either `TOKEN_BUCKET` or `SLIDING_WINDOW` via the admin policy endpoint.
2. **Exact Sliding Window Log Implementation**:
   - We implement **Exact Sliding Window Log** using the `sliding_window_requests` table with timestamp precision.
   - On each check:
     a. Expired timestamps older than `(now - window_duration)` are pruned in the same transaction.
     b. Active requests are counted.
     c. If `active_count + requested_cost <= window_limit`, the new timestamp is logged, returning `ALLOW`.
     d. If exceeded, `DENY` is returned, calculating `Retry-After` from the oldest timestamp in the active window.
3. **Explicit Documentation Contract**:
   - The API contract explicitly guarantees **Exact Sliding Window** mechanics, eliminating ambiguity for clients requiring strict audit compliance.

## Consequences
### Positive
- Predictable and mathematically exact behavior with zero boundary slippage.
- Dynamic token bucket supports fractional refills down to microsecond intervals (`delta_seconds * refill_rate`).

### Negative
- Exact sliding window requires storing individual request timestamps in `sliding_window_requests`. For high-volume sliding window clients, row accumulation must be kept bounded.
- *Mitigation*: The prune step runs atomically inside the rate check query (`DELETE FROM sliding_window_requests WHERE client_key = $1 AND requested_at < (now - window_duration)`), keeping the table small and indexed on `(client_key, requested_at DESC)`.
