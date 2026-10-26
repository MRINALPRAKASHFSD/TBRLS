import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { timingSafeMatch } from '../utils/hash.js';

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
