import { describe, expect, it } from 'vitest';

export interface HttpResponseMock {
  status: number;
  body: string | null;
  headers: Record<string, string>;
}

export interface ValidationResult {
  isStatus200: boolean;
  isValidJson: boolean;
  hasValidDecision: boolean;
  hasRequiredHeaders: boolean;
  isFullyValid: boolean;
  decision: string | null;
}

export function validateLoadTestResponse(res: HttpResponseMock): ValidationResult {
  const isStatus200 = res.status === 200;
  let parsedBody: Record<string, unknown> | null = null;
  let isValidJson = false;
  let hasValidDecision = false;

  try {
    if (res.body) {
      parsedBody = JSON.parse(res.body);
      isValidJson = typeof parsedBody === 'object' && parsedBody !== null;
      if (isValidJson && parsedBody) {
        hasValidDecision = parsedBody.decision === 'ALLOW' || parsedBody.decision === 'DENY';
      }
    }
  } catch {
    isValidJson = false;
    hasValidDecision = false;
  }

  const hasRequiredHeaders =
    res.headers['Ratelimit-Limit'] !== undefined ||
    res.headers['ratelimit-limit'] !== undefined;

  const isFullyValid = isStatus200 && isValidJson && hasValidDecision && hasRequiredHeaders;

  return {
    isStatus200,
    isValidJson,
    hasValidDecision,
    hasRequiredHeaders,
    isFullyValid,
    decision: hasValidDecision && parsedBody ? (parsedBody.decision as string) : null,
  };
}

describe('Load Test Response Validation Logic (Unit Tests)', () => {
  const validHeaders = {
    'Ratelimit-Limit': '10',
    'Ratelimit-Remaining': '9',
    'Ratelimit-Reset': '1',
  };

  it('approves a response with status 200, valid JSON, and decision == ALLOW', () => {
    const res: HttpResponseMock = {
      status: 200,
      body: JSON.stringify({
        decision: 'ALLOW',
        policyType: 'TOKEN_BUCKET',
        limit: 10,
        remaining: 9,
      }),
      headers: validHeaders,
    };

    const validation = validateLoadTestResponse(res);
    expect(validation.isStatus200).toBe(true);
    expect(validation.isValidJson).toBe(true);
    expect(validation.hasValidDecision).toBe(true);
    expect(validation.decision).toBe('ALLOW');
    expect(validation.isFullyValid).toBe(true);
  });

  it('approves a response with status 200, valid JSON, and decision == DENY', () => {
    const res: HttpResponseMock = {
      status: 200,
      body: JSON.stringify({
        decision: 'DENY',
        policyType: 'TOKEN_BUCKET',
        limit: 10,
        remaining: 0,
        retryAfter: 5,
      }),
      headers: validHeaders,
    };

    const validation = validateLoadTestResponse(res);
    expect(validation.isStatus200).toBe(true);
    expect(validation.isValidJson).toBe(true);
    expect(validation.hasValidDecision).toBe(true);
    expect(validation.decision).toBe('DENY');
    expect(validation.isFullyValid).toBe(true);
  });

  it('rejects a response if body is not valid JSON despite HTTP 200 and headers', () => {
    const res: HttpResponseMock = {
      status: 200,
      body: '<html><body>Internal Server Error / Gateway Timeout</body></html>',
      headers: validHeaders,
    };

    const validation = validateLoadTestResponse(res);
    expect(validation.isStatus200).toBe(true);
    expect(validation.isValidJson).toBe(false);
    expect(validation.hasValidDecision).toBe(false);
    expect(validation.isFullyValid).toBe(false);
  });

  it('rejects a response if body is null or empty', () => {
    const res: HttpResponseMock = {
      status: 200,
      body: '',
      headers: validHeaders,
    };

    const validation = validateLoadTestResponse(res);
    expect(validation.isValidJson).toBe(false);
    expect(validation.hasValidDecision).toBe(false);
    expect(validation.isFullyValid).toBe(false);
  });

  it('rejects a response if decision is missing or not ALLOW/DENY', () => {
    const resNoDecision: HttpResponseMock = {
      status: 200,
      body: JSON.stringify({ message: 'Success', status: 'OK' }),
      headers: validHeaders,
    };
    expect(validateLoadTestResponse(resNoDecision).hasValidDecision).toBe(false);
    expect(validateLoadTestResponse(resNoDecision).isFullyValid).toBe(false);

    const resInvalidDecision: HttpResponseMock = {
      status: 200,
      body: JSON.stringify({ decision: 'PERMITTED' }),
      headers: validHeaders,
    };
    expect(validateLoadTestResponse(resInvalidDecision).hasValidDecision).toBe(false);
    expect(validateLoadTestResponse(resInvalidDecision).isFullyValid).toBe(false);
  });

  it('rejects a response if HTTP status is non-200 even if body contains ALLOW', () => {
    const res: HttpResponseMock = {
      status: 500,
      body: JSON.stringify({ decision: 'ALLOW' }),
      headers: validHeaders,
    };

    const validation = validateLoadTestResponse(res);
    expect(validation.isStatus200).toBe(false);
    expect(validation.isFullyValid).toBe(false);
  });
});

export function validateLoadTestEnv(env: Record<string, string | undefined>): string {
  const key = env.CHECK_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error('CHECK_API_KEY environment variable is required to execute the k6 load test. Please provide -e CHECK_API_KEY=<key>.');
  }
  return key;
}

describe('Load Test Environment Validation (Unit Tests)', () => {
  it('throws an error if CHECK_API_KEY is undefined or empty', () => {
    expect(() => validateLoadTestEnv({})).toThrow(
      'CHECK_API_KEY environment variable is required to execute the k6 load test.'
    );

    expect(() => validateLoadTestEnv({ CHECK_API_KEY: '' })).toThrow(
      'CHECK_API_KEY environment variable is required to execute the k6 load test.'
    );

    expect(() => validateLoadTestEnv({ CHECK_API_KEY: '   ' })).toThrow(
      'CHECK_API_KEY environment variable is required to execute the k6 load test.'
    );
  });

  it('successfully returns the credential when CHECK_API_KEY is provided', () => {
    const key = validateLoadTestEnv({ CHECK_API_KEY: 'my-valid-check-key' });
    expect(key).toBe('my-valid-check-key');
  });
});

