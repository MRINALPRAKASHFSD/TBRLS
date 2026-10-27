import { describe, expect, it } from 'vitest';
import { calculateTokenBucketCheck } from '../../src/limiter/token-bucket.js';
import { InvalidCostError } from '../../src/limiter/types.js';

describe('Token Bucket Algorithm Math (Unit Tests)', () => {
  const baseState = {
    currentTokens: 10,
    lastRefillTimestampMs: 1000000,
    capacity: 10,
    refillRatePerSecond: 2, // 2 tokens/sec
  };

  it('allows request when bucket is full and deducts cost', () => {
    const res = calculateTokenBucketCheck(baseState, 1, 1000000);
    expect(res.allowed).toBe(true);
    expect(res.newTokens).toBe(9);
    expect(res.result.decision).toBe('ALLOW');
    expect(res.result.limit).toBe(10);
    expect(res.result.remaining).toBe(9);
    expect(res.result.reset).toBe(1); // 1 token missing / 2 per sec = 0.5 -> ceil = 1
    expect(res.result.retryAfter).toBeNull();
  });

  it('correctly handles fractional refill after elapsed time', () => {
    // 500ms elapsed at 2 tokens/sec = +1.0 token
    const state = {
      ...baseState,
      currentTokens: 5,
    };
    const res = calculateTokenBucketCheck(state, 1, 1000500);
    expect(res.allowed).toBe(true);
    // 5 + 1.0 - 1 = 5.0 tokens
    expect(res.newTokens).toBe(5);
    expect(res.result.remaining).toBe(5);
  });

  it('caps replenished tokens at maximum bucket capacity', () => {
    // 100 seconds elapsed, accrued = 200 tokens, capped at capacity 10
    const state = {
      ...baseState,
      currentTokens: 5,
    };
    const res = calculateTokenBucketCheck(state, 2, 1100000);
    expect(res.allowed).toBe(true);
    // Capped at 10, minus 2 = 8
    expect(res.newTokens).toBe(8);
    expect(res.result.remaining).toBe(8);
    expect(res.result.limit).toBe(10);
  });

  it('denies request when insufficient tokens and preserves existing balance', () => {
    const state = {
      ...baseState,
      currentTokens: 0.5,
    };
    // 0ms elapsed, requesting cost 2
    const res = calculateTokenBucketCheck(state, 2, 1000000);
    expect(res.allowed).toBe(false);
    expect(res.newTokens).toBe(0.5); // tokens not deducted
    expect(res.result.decision).toBe('DENY');
    expect(res.result.remaining).toBe(0);
    // Deficit is 2 - 0.5 = 1.5 tokens / 2 per sec = 0.75s -> ceil 1s
    expect(res.result.retryAfter).toBe(1);
    expect(res.result.reset).toBe(5); // (10 - 0.5) / 2 = 4.75 -> ceil 5
  });

  it('handles zero elapsed time microbursts safely', () => {
    const step1 = calculateTokenBucketCheck(baseState, 5, 1000000);
    expect(step1.allowed).toBe(true);
    expect(step1.newTokens).toBe(5);

    const state2 = {
      ...baseState,
      currentTokens: step1.newTokens,
      lastRefillTimestampMs: step1.newLastRefillTimestampMs,
    };
    const step2 = calculateTokenBucketCheck(state2, 5, 1000000);
    expect(step2.allowed).toBe(true);
    expect(step2.newTokens).toBe(0);

    const state3 = {
      ...baseState,
      currentTokens: step2.newTokens,
      lastRefillTimestampMs: step2.newLastRefillTimestampMs,
    };
    const step3 = calculateTokenBucketCheck(state3, 1, 1000000);
    expect(step3.allowed).toBe(false);
    expect(step3.result.decision).toBe('DENY');
    expect(step3.result.remaining).toBe(0);
  });

  it('rejects requested cost larger than bucket capacity by throwing InvalidCostError', () => {
    expect(() => calculateTokenBucketCheck(baseState, 50, 1000000)).toThrow(InvalidCostError);
    expect(() => calculateTokenBucketCheck(baseState, 11, 1000000)).toThrow(
      /Requested cost 11 exceeds client bucket capacity 10/
    );
  });
});
