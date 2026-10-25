import type { FastifyPluginAsync } from 'fastify';
import type { RateLimiterService } from '../limiter/rate-limiter-service.js';

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const proxyRoutes: FastifyPluginAsync<{ limiterService: RateLimiterService }> = async (
  fastify,
  opts
) => {
  const limiter = opts.limiterService;

  // GET or POST /proxy - Direct reverse proxy shield for any website URL
  fastify.all('/proxy', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, string | number | undefined>;

    const targetUrl = (query.target || query.url || body.target || body.url) as string | undefined;
    const clientKey = ((query.clientKey || body.clientKey || request.ip || 'website-visitor') as string).trim();
    const cost = Number(query.cost || body.cost || 1);
    const jsonMode = query.json === 'true' || String(body.json) === 'true' || Boolean(request.headers['accept']?.includes('application/json'));

    if (!targetUrl || !isValidHttpUrl(targetUrl)) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'A valid http:// or https:// target website URL is required (?target=https://your-website.com)',
      });
    }

    const safeCost = Number.isFinite(cost) && cost >= 1 ? Math.floor(cost) : 1;

    // 1. Evaluate rate limit in TBRLS
    let checkResult;
    try {
      checkResult = await limiter.check(clientKey, safeCost);
    } catch (err: any) {
      request.log.error({ event: 'proxy_limiter_error', error: err.message });
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Rate limiter storage unavailable',
      });
    }

    // Set standardized RateLimit headers
    reply.header('RateLimit-Limit', checkResult.limit);
    reply.header('RateLimit-Remaining', checkResult.remaining);
    reply.header('RateLimit-Reset', checkResult.reset);

    // 2. If DENIED -> Block the request with 429
    if (checkResult.decision === 'DENY') {
      const retryAfter = checkResult.retryAfter ?? 1;
      reply.header('Retry-After', retryAfter);
      return reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        decision: 'DENY',
        message: `Rate limit exceeded for ${clientKey}. Please wait ${retryAfter} seconds.`,
        limit: checkResult.limit,
        remaining: checkResult.remaining,
        retryAfter,
      });
    }

    // 3. If ALLOWED -> Forward request to target website
    const startTime = Date.now();
    try {
      const upstream = await fetch(targetUrl, {
        method: request.method === 'POST' ? 'POST' : 'GET',
        headers: {
          'User-Agent': 'TBRLS-Website-Shield/1.0',
          'Accept': 'application/json, text/plain, */*',
        },
      });

      const responseTimeMs = Date.now() - startTime;
      const contentType = upstream.headers.get('content-type') || 'text/plain';
      const textBody = await upstream.text();

      // In JSON simulation mode (used by the dashboard), return structured telemetry
      if (query.format === 'simulation' || body.format === 'simulation') {
        let parsedJson = null;
        try {
          parsedJson = JSON.parse(textBody);
        } catch {
          // not json, keep null
        }

        return reply.status(200).send({
          decision: 'ALLOW',
          policyType: checkResult.policyType,
          limit: checkResult.limit,
          remaining: checkResult.remaining,
          reset: checkResult.reset,
          retryAfter: null,
          targetStatus: upstream.status,
          responseTimeMs,
          contentType,
          preview: parsedJson || textBody.substring(0, 500),
        });
      }

      // Direct proxy mode: transparently return upstream response
      reply.header('Content-Type', contentType);
      reply.header('X-RateLimit-Decision', 'ALLOW');
      return reply.status(upstream.status).send(textBody);
    } catch (fetchErr: any) {
      return reply.status(502).send({
        statusCode: 502,
        error: 'Bad Gateway',
        message: `Failed to connect to target website "${targetUrl}": ${fetchErr.message}`,
      });
    }
  });
};
