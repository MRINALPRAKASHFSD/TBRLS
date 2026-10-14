export type PolicyType = 'TOKEN_BUCKET' | 'SLIDING_WINDOW';

export type Decision = 'ALLOW' | 'DENY';

export interface TokenBucketPolicyParams {
  capacity: number;
  refillRate: number;
}

export interface SlidingWindowPolicyParams {
  limit: number;
  windowDurationSeconds: number;
}

export interface ClientPolicy {
  clientKey: string;
  policyType: PolicyType;
  capacity?: number | null;
  refillRate?: number | null;
  windowLimit?: number | null;
  windowDurationSeconds?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RateCheckParams {
  clientKey: string;
  cost?: number;
}

export interface RateCheckResult {
  decision: Decision;
  policyType: PolicyType;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number | null;
}

export class InvalidCostError extends Error {
  constructor(
    message: string,
    public readonly limit: number,
    public readonly cost: number,
    public readonly policyType: PolicyType
  ) {
    super(message);
    this.name = 'InvalidCostError';
  }
}

