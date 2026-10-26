import crypto from 'node:crypto';

/**
 * Creates a deterministic SHA-256 hash of a string for safe logging and metrics.
 * Never leaks the raw sensitive client identifier or secret.
 */
export function hashClientKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
}

/**
 * Masks a client key for safe diagnostic display in logs.
 * Example: 'client-user-94821' -> 'clie****821'
 */
export function maskClientKey(key: string): string {
  if (!key || key.length <= 4) {
    return '****';
  }
  if (key.length <= 8) {
    return `${key.substring(0, 2)}****`;
  }
  return `${key.substring(0, 4)}****${key.substring(key.length - 3)}`;
}

/**
 * Performs a constant-time equality comparison between two strings
 * to prevent timing attack side-channels.
 */
export function timingSafeMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
