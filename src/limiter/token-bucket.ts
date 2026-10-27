import { InvalidCostError, type RateCheckResult } from './types.js';

export interface TokenBucketCalculationState {
  currentTokens: number;
  lastRefillTimestampMs: number;
  capacity: number;
  refillRatePerSecond: number;
}

/**
 * Pure calculation function for Token Bucket replenishment and quota check.
 * Handles continuous fractional refills down to millisecond granularity.
 */
export function calculateTokenBucketCheck(
  state: TokenBucketCalculationState,
  cost: number,
  nowMs: number = Date.now()
): {
  allowed: boolean;
  newTokens: number;
  newLastRefillTimestampMs: number;
  result: RateCheckResult;
} {
  const { currentTokens, lastRefillTimestampMs, capacity, refillRatePerSecond } = state;

  if (cost > capacity) {
    throw new InvalidCostError(
      `Requested cost ${cost} exceeds client bucket capacity ${capacity}`,
      capacity,
      cost,
      'TOKEN_BUCKET'
    );
  }

  // Calculate elapsed time in seconds since the last refill
  const elapsedMs = Math.max(0, nowMs - lastRefillTimestampMs);
  const elapsedSeconds = elapsedMs / 1000.0;

  // Calculate newly accrued tokens
  const accruedTokens = elapsedSeconds * refillRatePerSecond;
  const refilledTokens = Math.min(capacity, currentTokens + accruedTokens);

  if (refilledTokens >= cost) {
    // Request permitted
    const newTokens = refilledTokens - cost;
    const missingTokens = Math.max(0, capacity - newTokens);
    const resetSeconds = refillRatePerSecond > 0 ? Math.ceil(missingTokens / refillRatePerSecond) : 0;

    return {
      allowed: true,
      newTokens,
      newLastRefillTimestampMs: nowMs,
      result: {
        decision: 'ALLOW',
        policyType: 'TOKEN_BUCKET',
        limit: Math.floor(capacity),
        remaining: Math.floor(newTokens),
        reset: resetSeconds,
        retryAfter: null,
      },
    };
  } else {
    // Request denied
    const deficit = cost - refilledTokens;
    const retryAfter = refillRatePerSecond > 0 ? Math.ceil(deficit / refillRatePerSecond) : 3600;
    const missingTokens = Math.max(0, capacity - refilledTokens);
    const resetSeconds = refillRatePerSecond > 0 ? Math.ceil(missingTokens / refillRatePerSecond) : 0;

    return {
      allowed: false,
      newTokens: refilledTokens,
      newLastRefillTimestampMs: nowMs,
      result: {
        decision: 'DENY',
        policyType: 'TOKEN_BUCKET',
        limit: Math.floor(capacity),
        remaining: Math.floor(refilledTokens),
        reset: resetSeconds,
        retryAfter: Math.max(1, retryAfter),
      },
    };
  }
}
