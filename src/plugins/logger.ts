import type { FastifyServerOptions } from 'fastify';
import { config } from '../config.js';

export const SAFE_UNMATCHED_ROUTE = '<unmatched>';
export const SAFE_QUERY_PARAMS = new Set(['page', 'limit']);

/**
 * Sanitizes request URL for safe logging.
 * - Prefers Fastify's route template (e.g. '/v1/admin/policies/:clientKey') instead of raw path.
 * - When Fastify has no route template (unmatched path), logs a safe generic placeholder ('<unmatched>').
 * - Preserves only explicitly safe query parameters ('page', 'limit') using a strict allowlist.
 * - Omit all other query parameters and their values.
 */
export function sanitizeRequestUrl(req: any): string {
  const rawUrl: string = req?.url || '';
  const queryStringIndex = rawUrl.indexOf('?');
  const queryString = queryStringIndex !== -1 ? rawUrl.slice(queryStringIndex + 1) : '';

  // Fastify sets req.routeOptions.url when a route is matched.
  // If unmatched, do NOT log raw path segments; use a generic safe route placeholder.
  const basePath: string = req?.routeOptions?.url || SAFE_UNMATCHED_ROUTE;

  if (!queryString) {
    return basePath;
  }

  try {
    const params = new URLSearchParams(queryString);
    const safeParams = new URLSearchParams();

    for (const [key, value] of params.entries()) {
      if (SAFE_QUERY_PARAMS.has(key.toLowerCase())) {
        safeParams.append(key, value);
      }
    }

    const sanitizedQuery = safeParams.toString();
    return sanitizedQuery ? `${basePath}?${sanitizedQuery}` : basePath;
  } catch {
    return basePath;
  }
}

export function createLoggerConfig(options: { stream?: any; level?: string } = {}): FastifyServerOptions['logger'] {
  return {
    level: options.level ?? config.logLevel,
    stream: options.stream,
    redact: {
      paths: [
        'req.headers["x-admin-key"]',
        'req.headers["x-check-key"]',
        'req.headers["x-api-key"]',
        'req.headers.authorization',
        'req.body.clientKey',
        'body.clientKey',
        'req.query.clientKey',
        'query.clientKey',
        'req.params.clientKey',
        'params.clientKey',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: sanitizeRequestUrl(req),
          remoteAddress: req.ip,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  };
}

export function getLoggerConfig(): FastifyServerOptions['logger'] {
  if (config.nodeEnv === 'test') {
    return false;
  }

  return createLoggerConfig();
}
