import type { FastifyServerOptions } from 'fastify';
import { config } from '../config.js';

export function getLoggerConfig(): FastifyServerOptions['logger'] {
  if (config.nodeEnv === 'test') {
    return false;
  }

  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers["x-admin-key"]',
        'req.headers.authorization',
        'req.body.clientKey',
        'body.clientKey',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          remoteAddress: req.ip,
          // Explicitly omit headers containing tokens
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
