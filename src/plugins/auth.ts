import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { timingSafeMatch } from '../utils/hash.js';

/**
 * Service-to-service authentication hook for rate check requests (POST /v1/check).
 * Requires CHECK_API_KEY provided via X-Check-Key, X-API-Key, or Authorization Bearer.
 */
export async function checkAuthHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const checkKeyHeader = request.headers['x-check-key'] || request.headers['x-api-key'];
  let providedKey: string | undefined;

  if (typeof checkKeyHeader === 'string' && checkKeyHeader.trim().length > 0) {
    providedKey = checkKeyHeader.trim();
  } else {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7).trim();
    }
  }

  if (!providedKey || !timingSafeMatch(providedKey, config.checkApiKey)) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Valid check credentials required via X-Check-Key, X-API-Key, or Authorization Bearer header',
    });
  }
}

/**
 * Administrative authentication hook for policy management (v1/admin/policies).
 * Requires ADMIN_API_KEY provided via X-Admin-Key or Authorization Bearer.
 */
export async function adminAuthHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const adminKeyHeader = request.headers['x-admin-key'];
  let providedKey: string | undefined;

  if (typeof adminKeyHeader === 'string' && adminKeyHeader.trim().length > 0) {
    providedKey = adminKeyHeader.trim();
  } else {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7).trim();
    }
  }

  if (!providedKey || !timingSafeMatch(providedKey, config.adminApiKey)) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Valid admin credentials required via X-Admin-Key or Authorization Bearer header',
    });
  }
}
