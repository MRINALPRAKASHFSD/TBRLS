# Rate Limiting Algorithms & Mathematical Foundations

TBRLS implements two complementary rate limiting algorithms: **Token Bucket** and **Exact Sliding Window Log**.

---

## 1. Algorithm A: Token Bucket

### 1.1 Core Concept
Imagine a bucket with capacity $C$ that holds tokens.
- Tokens are deposited at a constant rate $R$ tokens per second.
- The bucket cannot exceed its capacity $C$ (overflow tokens are discarded).
- When a client makes a request costing $k$ tokens:
  - If the bucket holds at least $k$ tokens, $k$ tokens are removed and the request is **ALLOWED**.
  - If the bucket holds fewer than $k$ tokens, no tokens are removed and the request is **DENIED**.

### 1.2 Mathematical Formulation & Continuous Refill
Rather than running background worker timers to increment tokens every second, tokens are computed lazily and continuously upon each incoming request based on elapsed time $\Delta t$.

Let:
- $t_{\text{now}}$: current epoch timestamp (in seconds or fractional seconds)
- $t_{\text{last}}$: timestamp of previous check
- $\Delta t = t_{\text{now}} - t_{\text{last}}$: elapsed seconds
- $T_{\text{last}}$: tokens remaining at $t_{\text{last}}$
- $R$: refill rate (tokens/second)
- $C$: bucket burst capacity

The replenished token count $T_{\text{refilled}}$ is:
$$T_{\text{refilled}} = \min(C, T_{\text{last}} + (\Delta t \times R))$$

For a request with cost $k$:
- If $T_{\text{refilled}} \ge k$:
  - $\text{Decision} = \text{ALLOW}$
  - $T_{\text{new}} = T_{\text{refilled}} - k$
  - $\text{Remaining} = \lfloor T_{\text{new}} \rfloor$
  - $\text{Reset} = \lceil \frac{C - T_{\text{new}}}{R} \rceil$
  - $\text{RetryAfter} = \text{null}$
- If $T_{\text{refilled}} < k$:
  - $\text{Decision} = \text{DENY}$
  - $T_{\text{new}} = T_{\text{refilled}}$ (tokens are preserved)
  - $\text{Remaining} = \lfloor T_{\text{new}} \rfloor$
  - $\text{Deficit} = k - T_{\text{refilled}}$
  - $\text{RetryAfter} = \lceil \frac{\text{Deficit}}{R} \rceil$
  - $\text{Reset} = \lceil \frac{C - T_{\text{new}}}{R} \rceil$

---

## 2. Algorithm B: Exact Sliding Window Log

### 2.1 Core Concept & Exactness
Unlike a fixed window (which suffers from boundary doubling where a client makes 100% of quota in the last second of window 1 and another 100% in the first second of window 2), the Sliding Window evaluates the rolling window $[\text{now} - W, \text{now}]$.

TBRLS implements the **Exact Sliding Window Log** approach:
1. Every allowed request logs its exact timestamp into `sliding_window_requests`.
2. When evaluating a request at $t_{\text{now}}$ with window duration $W$ and limit $L$:
   - All entries for this client with $t_{\text{entry}} < (t_{\text{now}} - W)$ are deleted.
   - Count $N$ of remaining entries in the window is obtained.
   - If $N + k \le L$:
     - Decision = `ALLOW`
     - Record $t_{\text{now}}$ in log
     - $\text{Remaining} = L - (N + k)$
     - $\text{Reset} = W$
   - If $N + k > L$:
     - Decision = `DENY`
     - $\text{Remaining} = 0$
     - Find the earliest active timestamp $t_{\text{oldest}}$ in the window.
     - $\text{RetryAfter} = \lceil (t_{\text{oldest}} + W) - t_{\text{now}} \rceil$

### 2.2 Exact vs. Approximate Comparison

| Attribute | Approximate (Sliding Counter) | Exact (Sliding Window Log - TBRLS) |
| :--- | :--- | :--- |
| **Accuracy** | Approximate (~95-99% accuracy; introduces boundary estimation errors) | **100% Exact** (Zero boundary errors) |
| **Storage** | 2 counter rows per client | 1 row per active request within current window |
| **Pruning** | Simple overwrite of prior window bucket | Atomic prune on each evaluation |
| **Best Suited For** | Coarse, millions-of-requests-per-second scenarios | Strict rate limiting, financial APIs, API credit quotas |

---

## 3. Boundary & Edge Case Handling

1. **Fractional Refill Precision**:
   - Stored as `NUMERIC(14, 4)` in PostgreSQL, enabling accurate sub-second refills (e.g. 0.005 tokens over 5 milliseconds).
2. **First-Time Client Initialization**:
   - A brand new client starts with a full bucket ($T = C$) and immediate `ALLOW`.
3. **Cost Exceeds Bucket Capacity**:
   - If a client requests `cost > capacity` (e.g., cost 50 on a bucket of capacity 20), the check is immediately and safely `DENY`ed with `RetryAfter = null` (or maximum wait).
4. **Zero Refill Time / Microbursts**:
   - Consecutive calls arriving with $\Delta t = 0$ correctly deduct tokens without artificially adding zero-time refills.
