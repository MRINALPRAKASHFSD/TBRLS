import { describe, expect, it } from 'vitest';
import { hashClientKey, maskClientKey, timingSafeMatch } from '../../src/utils/hash.js';

describe('Security & Utility Functions (Unit Tests)', () => {
  it('masks client keys correctly to prevent log exposure', () => {
    expect(maskClientKey('client-user-94821')).toBe('clie****821');
    expect(maskClientKey('abcdefgh')).toBe('ab****');
    expect(maskClientKey('abc')).toBe('****');
    expect(maskClientKey('')).toBe('****');
  });

  it('generates consistent deterministic SHA-256 digests for key tracing', () => {
    const hash1 = hashClientKey('my-secret-key-1');
    const hash2 = hashClientKey('my-secret-key-1');
    const hash3 = hashClientKey('my-secret-key-2');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(16);
  });

  it('performs timing-safe matching against admin credentials', () => {
    const secret = 'super-secret-admin-token';
    expect(timingSafeMatch(secret, secret)).toBe(true);
    expect(timingSafeMatch('wrong-token', secret)).toBe(false);
    expect(timingSafeMatch('', secret)).toBe(false);
    expect(timingSafeMatch(secret, secret + 'suffix')).toBe(false);
  });
});
