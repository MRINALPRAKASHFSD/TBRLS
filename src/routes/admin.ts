import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import { DatabaseUnavailableError, RateLimiterService } from '../limiter/rate-limiter-service.js';
import { adminAuthHook } from '../plugins/auth.js';
import { hashClientKey, maskClientKey } from '../utils/hash.js';

const AdminPolicyParamsSchema = Type.Object({
  clientKey: Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[a-zA-Z0-9_.:-]+$',
  }),
});

const AdminUpsertPolicyBodySchema = Type.Object(
  {
    policyType: Type.Union([Type.Literal('TOKEN_BUCKET'), Type.Literal('SLIDING_WINDOW')]),
    capacity: Type.Optional(Type.Number({ minimum: 0.1, maximum: 1000000 })),
    refillRate: Type.Optional(Type.Number({ minimum: 0.0001, maximum: 1000000 })),
    windowLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
    windowDurationSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
  },
  { additionalProperties: false }
);

export const adminRoutes: FastifyPluginAsync<{ limiterService: RateLimiterService }> = async (
  fastify,
  opts
) => {
  const limiter = opts.limiterService;

  // Enforce admin authentication across all routes in this plugin
  fastify.addHook('preHandler', adminAuthHook);

  // PUT /v1/admin/policies/:clientKey
  fastify.put(
    '/v1/admin/policies/:clientKey',
    {
      schema: {
        params: AdminPolicyParamsSchema,
        body: AdminUpsertPolicyBodySchema,
      },
    },
    async (request, reply) => {
      const { clientKey } = request.params as { clientKey: string };
      const body = request.body as {
        policyType: 'TOKEN_BUCKET' | 'SLIDING_WINDOW';
        capacity?: number;
        refillRate?: number;
        windowLimit?: number;
        windowDurationSeconds?: number;
      };

      // Validation for policy-specific required fields
      if (body.policyType === 'TOKEN_BUCKET') {
        if (body.capacity === undefined || body.refillRate === undefined) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'TOKEN_BUCKET policies require both "capacity" and "refillRate"',
          });
        }
      } else if (body.policyType === 'SLIDING_WINDOW') {
        if (body.windowLimit === undefined || body.windowDurationSeconds === undefined) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'SLIDING_WINDOW policies require both "windowLimit" and "windowDurationSeconds"',
          });
        }
      }

      try {
        const policy = await limiter.upsertPolicy(clientKey, body);

        request.log.info({
          event: 'admin_policy_upserted',
          maskedKey: maskClientKey(clientKey),
          keyHash: hashClientKey(clientKey),
          policyType: policy.policyType,
        });

        return reply.status(200).send({
          success: true,
          message: 'Policy updated successfully',
          policy,
        });
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Rate limiter storage service unavailable',
          });
        }
        throw err;
      }
    }
  );

  // GET /v1/admin/policies/:clientKey
  fastify.get(
    '/v1/admin/policies/:clientKey',
    {
      schema: {
        params: AdminPolicyParamsSchema,
      },
    },
    async (request, reply) => {
      const { clientKey } = request.params as { clientKey: string };

      try {
        const result = await limiter.getPolicy(clientKey);
        if (!result.policy) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Client policy not found',
          });
        }

        return reply.status(200).send({
          found: true,
          policy: result.policy,
          state: result.state,
        });
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Rate limiter storage service unavailable',
          });
        }
        throw err;
      }
    }
  );

  // DELETE /v1/admin/policies/:clientKey
  fastify.delete(
    '/v1/admin/policies/:clientKey',
    {
      schema: {
        params: AdminPolicyParamsSchema,
      },
    },
    async (request, reply) => {
      const { clientKey } = request.params as { clientKey: string };

      try {
        const deleted = await limiter.deletePolicy(clientKey);
        if (!deleted) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Client policy not found',
          });
        }

        request.log.info({
          event: 'admin_policy_deleted',
          maskedKey: maskClientKey(clientKey),
          keyHash: hashClientKey(clientKey),
        });

        return reply.status(200).send({
          success: true,
          message: 'Client policy and state successfully removed',
        });
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Rate limiter storage service unavailable',
          });
        }
        throw err;
      }
    }
  );

  // GET /v1/admin/metrics
  fastify.get(
    '/v1/admin/metrics',
    {
      schema: {
        querystring: Type.Object({
          page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
          clientKey: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          from: Type.Optional(Type.String()),
          to: Type.Optional(Type.String()),
        }),
      },
    },
    async (request, reply) => {
      const query = request.query as {
        page?: number;
        limit?: number;
        clientKey?: string;
        from?: string;
        to?: string;
      };

      try {
        const data = await limiter.getMetrics(query);
        return reply.status(200).send(data);
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Rate limiter storage service unavailable',
          });
        }
        throw err;
      }
    }
  );

  // GET /v1/admin/metrics/summary
  fastify.get('/v1/admin/metrics/summary', async (_request, reply) => {
    try {
      const summary = await limiter.getMetricsSummary();
      return reply.status(200).send(summary);
    } catch (err) {
      if (err instanceof DatabaseUnavailableError) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Rate limiter storage service unavailable',
        });
      }
      throw err;
    }
  });
};
