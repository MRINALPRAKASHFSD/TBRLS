import fastify, { FastifyError, FastifyInstance, FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { pool as defaultPool } from './db/pool.js';
import { RateLimiterService } from './limiter/rate-limiter-service.js';
import { getLoggerConfig } from './plugins/logger.js';
import { adminRoutes } from './routes/admin.js';
import { checkRoutes } from './routes/check.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { healthRoutes } from './routes/health.js';
import { proxyRoutes } from './routes/proxy.js';

export interface BuildAppOptions extends FastifyServerOptions {
  poolOverride?: Pool;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const { poolOverride, ...fastifyOpts } = opts;
  const dbPool = poolOverride || defaultPool;
  const limiterService = new RateLimiterService(dbPool);

  const app = fastify({
    logger: fastifyOpts.logger ?? getLoggerConfig(),
    ...fastifyOpts,
  });

  // Standardized error handler for clean, safe error responses
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Fastify schema validation error
    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: error.message,
      });
    }

    // Default unhandled error response
    request.log.error({
      event: 'unhandled_application_error',
      message: error.message,
    });

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      statusCode,
      error: error.name || 'Internal Server Error',
      message: statusCode >= 500 ? 'An internal server error occurred' : error.message,
    });
  });

  // Root route redirects to the visual dashboard
  app.get('/', async (_request, reply) => {
    return reply.redirect('/admin/dashboard');
  });

  // Custom not-found handler to prevent Fastify from logging raw URLs containing client keys
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route not found',
    });
  });

  // Register route modules
  app.register(healthRoutes);
  app.register(checkRoutes, { limiterService });
  app.register(adminRoutes, { limiterService });
  app.register(dashboardRoutes, { limiterService });
  app.register(proxyRoutes, { limiterService });

  return app;
}
