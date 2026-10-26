import type { FastifyPluginAsync } from 'fastify';
import { checkDatabaseHealth } from '../db/pool.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/readyz', async (_request, reply) => {
    const isHealthy = await checkDatabaseHealth();
    if (isHealthy) {
      return reply.status(200).send({
        status: 'ready',
        database: 'connected',
      });
    }

    return reply.status(503).send({
      status: 'unready',
      database: 'disconnected',
    });
  });
};
