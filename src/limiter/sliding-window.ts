import { InvalidCostError, type RateCheckResult } from './types.js';

export interface SlidingWindowCalculationState {
  timestampsMs: number[];
  limit: number;
  windowDurationSeconds: number;
}

/**
 * Pure calculation function for Exact Sliding Window Log evaluations.
 * Prunes expired timestamps older than (now - windowDuration) and evaluates request quota.
 */
export function calculateSlidingWindowCheck(
  state: SlidingWindowCalculationState,
  cost: number,
  nowMs: number = Date.now()
): {
  allowed: boolean;
  activeTimestampsMs: number[];
  result: RateCheckResult;
} {
  const { timestampsMs, limit, windowDurationSeconds } = state;

  if (cost > limit) {
    throw new InvalidCostError(
      `Requested cost ${cost} exceeds client sliding window limit ${limit}`,
      limit,
      cost,
      'SLIDING_WINDOW'
    );
  }

  const windowDurationMs = windowDurationSeconds * 1000;
  const cutoffMs = nowMs - windowDurationMs;

  // Prune any timestamps that fall outside the active rolling window
  const activeTimestamps = timestampsMs.filter((t) => t >= cutoffMs);
  const currentCount = activeTimestamps.length;

  if (currentCount + cost <= limit) {
    // Request permitted - append timestamp(s) for the new request(s)
    const updatedTimestamps = [...activeTimestamps];
    for (let i = 0; i < cost; i++) {
      updatedTimestamps.push(nowMs);
    }

    const remaining = Math.max(0, limit - (currentCount + cost));

    return {
      allowed: true,
      activeTimestampsMs: updatedTimestamps,
      result: {
        decision: 'ALLOW',
        policyType: 'SLIDING_WINDOW',
        limit,
        remaining,
        reset: windowDurationSeconds,
        retryAfter: null,
      },
    };
  } else {
    // Request denied
    // Calculate how many existing requests must roll out before the new request can fit:
    // (currentCount - m) + cost <= limit  =>  m >= currentCount + cost - limit
    const neededExpirations = currentCount + cost - limit;
    let retryAfter = windowDurationSeconds;

    if (activeTimestamps.length >= neededExpirations && neededExpirations > 0) {
      const sorted = [...activeTimestamps].sort((a, b) => a - b);
      const requiredOldestMs = sorted[neededExpirations - 1];
      const msUntilExpiry = (requiredOldestMs + windowDurationMs) - nowMs;
      retryAfter = Math.max(1, Math.ceil(msUntilExpiry / 1000));
    }

    return {
      allowed: false,
      activeTimestampsMs: activeTimestamps,
      result: {
        decision: 'DENY',
        policyType: 'SLIDING_WINDOW',
        limit,
        remaining: 0,
        reset: retryAfter,
        retryAfter,
      },
    };
  }
}
