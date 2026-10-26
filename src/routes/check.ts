import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import { DatabaseUnavailableError, RateLimiterService } from '../limiter/rate-limiter-service.js';
import { hashClientKey, maskClientKey } from '../utils/hash.js';

const CheckBodySchema = Type.Object(
  {
    clientKey: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: '^[a-zA-Z0-9_.:-]+$',
      description: 'Client identifier to evaluate rate limits against',
    }),
    cost: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 10000,
        default: 1,
        description: 'Quota cost of the request (default: 1)',
      })
    ),
  },
  { additionalProperties: false }
);

export const checkRoutes: FastifyPluginAsync<{ limiterService: RateLimiterService }> = async (
  fastify,
  opts
) => {
  const limiter = opts.limiterService;

  fastify.post(
    '/v1/check',
    {
      schema: {
        body: CheckBodySchema,
        response: {
          200: Type.Object({
            decision: Type.Union([Type.Literal('ALLOW'), Type.Literal('DENY')]),
            policyType: Type.Union([Type.Literal('TOKEN_BUCKET'), Type.Literal('SLIDING_WINDOW')]),
            limit: Type.Number(),
            remaining: Type.Number(),
            reset: Type.Number(),
            retryAfter: Type.Union([Type.Number(), Type.Null()]),
          }),
          503: Type.Object({
            statusCode: Type.Literal(503),
            error: Type.String(),
            message: Type.String(),
          }),
          500: Type.Object({
            statusCode: Type.Literal(500),
            error: Type.String(),
            message: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { clientKey, cost = 1 } = request.body as { clientKey: string; cost?: number };

      try {
        const result = await limiter.check(clientKey, cost);

        // Populate standardized IETF rate limit headers
        reply.header('RateLimit-Limit', result.limit.toString());
        reply.header('RateLimit-Remaining', result.remaining.toString());
        reply.header('RateLimit-Reset', result.reset.toString());

        if (result.decision === 'DENY') {
          const retrySec = result.retryAfter ?? Math.max(1, result.reset);
          reply.header('Retry-After', retrySec.toString());
        }

        // Trace event without leaking the plaintext clientKey
        request.log.debug({
          event: 'rate_check_decision',
          decision: result.decision,
          maskedKey: maskClientKey(clientKey),
          keyHash: hashClientKey(clientKey),
          cost,
          remaining: result.remaining,
        });

        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) {
          request.log.error({
            event: 'rate_limiter_storage_error',
            maskedKey: maskClientKey(clientKey),
            keyHash: hashClientKey(clientKey),
            error: (err as Error).message,
          });

          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Rate limiter storage service unavailable',
          });
        }

        request.log.error({
          event: 'unexpected_rate_check_error',
          error: (err as Error).message,
        });

        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected internal error occurred',
        });
      }
    }
  );
};
