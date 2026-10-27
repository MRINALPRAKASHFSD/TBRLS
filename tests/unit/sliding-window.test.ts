import { describe, expect, it } from 'vitest';
import { calculateSlidingWindowCheck } from '../../src/limiter/sliding-window.js';

describe('Exact Sliding Window Algorithm (Unit Tests)', () => {
  const windowDuration = 60; // 60 seconds
  const limit = 5;

  it('allows requests within window capacity', () => {
    const now = 100000;
    const state = {
      timestampsMs: [90000, 95000],
      limit,
      windowDurationSeconds: windowDuration,
    };

    const res = calculateSlidingWindowCheck(state, 1, now);
    expect(res.allowed).toBe(true);
    expect(res.result.decision).toBe('ALLOW');
    expect(res.result.limit).toBe(5);
    expect(res.result.remaining).toBe(2); // 5 - (2 + 1) = 2
    expect(res.result.reset).toBe(windowDuration);
    expect(res.result.retryAfter).toBeNull();
    expect(res.activeTimestampsMs).toHaveLength(3);
  });

  it('prunes timestamps older than the rolling window', () => {
    const now = 100000; // window covers [40000, 100000]
    const state = {
      timestampsMs: [
        10000, // expired (> 60s old)
        25000, // expired (> 60s old)
        50000, // active
        70000, // active
        90000, // active
      ],
      limit,
      windowDurationSeconds: windowDuration,
    };

    const res = calculateSlidingWindowCheck(state, 1, now);
    expect(res.allowed).toBe(true);
    // 3 active + 1 new = 4 active, 1 remaining
    expect(res.result.remaining).toBe(1);
    expect(res.result.reset).toBe(windowDuration);
    expect(res.activeTimestampsMs).toHaveLength(4);
    expect(res.activeTimestampsMs).not.toContain(10000);
    expect(res.activeTimestampsMs).not.toContain(25000);
  });

  it('denies requests when quota is fully exhausted in the rolling window', () => {
    const now = 100000;
    const state = {
      timestampsMs: [50000, 60000, 70000, 80000, 90000], // 5 entries = at limit
      limit,
      windowDurationSeconds: windowDuration,
    };

    const res = calculateSlidingWindowCheck(state, 1, now);
    expect(res.allowed).toBe(false);
    expect(res.result.decision).toBe('DENY');
    expect(res.result.remaining).toBe(0);
    // Oldest active timestamp is 50000. It expires at 50000 + 60000 = 110000.
    // At now = 100000, 10000ms remain -> 10 seconds retryAfter.
    expect(res.result.retryAfter).toBe(10);
    // RateLimit-Reset must strictly equal Retry-After on DENY
    expect(res.result.reset).toBe(res.result.retryAfter);
  });

  it('denies multi-cost requests that exceed available remaining window capacity', () => {
    const now = 100000;
    const state = {
      timestampsMs: [70000, 80000, 90000], // 3 entries
      limit,
      windowDurationSeconds: windowDuration,
    };

    // Requesting cost 3, but only 2 slots remain (limit 5 - 3 = 2)
    // Needed expirations: 3 + 3 - 5 = 1.
    const res = calculateSlidingWindowCheck(state, 3, now);
    expect(res.allowed).toBe(false);
    expect(res.result.decision).toBe('DENY');
    expect(res.result.retryAfter).toBe(30); // 70000 + 60000 - 100000 = 30000ms = 30s
    expect(res.result.reset).toBe(res.result.retryAfter);
  });

  it('calculates Retry-After based on the m-th oldest timestamp when multiple expirations are required', () => {
    const now = 100000;
    const state = {
      timestampsMs: [50000, 60000, 70000, 80000], // 4 entries
      limit: 5,
      windowDurationSeconds: 60,
    };

    // Requesting cost 3 on a bucket of 4 entries (limit 5):
    // 4 + 3 - 5 = 2 expirations required!
    // 1st oldest (50000) expires in 10s (would leave 3 items, 3+3=6 > 5, still fails)
    // 2nd oldest (60000) expires in 20s (leaves 2 items, 2+3=5 <= 5, succeeds!)
    const res = calculateSlidingWindowCheck(state, 3, now);
    expect(res.allowed).toBe(false);
    expect(res.result.decision).toBe('DENY');
    expect(res.result.retryAfter).toBe(20); // 60000 + 60000 - 100000 = 20s
    expect(res.result.reset).toBe(20);
  });

  it('rejects requested cost larger than sliding window limit by throwing InvalidCostError', () => {
    const now = 100000;
    const state = {
      timestampsMs: [90000],
      limit: 5,
      windowDurationSeconds: 60,
    };

    expect(() => calculateSlidingWindowCheck(state, 10, now)).toThrow(
      /Requested cost 10 exceeds client sliding window limit 5/
    );
  });
});

