import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createLoggerConfig, SAFE_QUERY_PARAMS, SAFE_UNMATCHED_ROUTE, sanitizeRequestUrl } from '../../src/plugins/logger.js';

describe('Logger Redaction & URL Sanitization', () => {
  describe('sanitizeRequestUrl unit logic', () => {
    it('prefers Fastify route template over raw path parameter containing client key', () => {
      const mockReq = {
        url: '/v1/admin/policies/secret-client-key-123',
        routeOptions: {
          url: '/v1/admin/policies/:clientKey',
        },
      };

      const sanitized = sanitizeRequestUrl(mockReq);
      expect(sanitized).toBe('/v1/admin/policies/:clientKey');
      expect(sanitized).not.toContain('secret-client-key-123');
    });

    it('preserves only explicitly allowed query parameters (page, limit) and omits all others', () => {
      const mockReq = {
        url: '/v1/admin/metrics?clientKey=secret-key&x-admin-key=secret-admin&access_token=secret-token&password=secret-pass&arbitrary=dropme&page=2&limit=25',
        routeOptions: {
          url: '/v1/admin/metrics',
        },
      };

      const sanitized = sanitizeRequestUrl(mockReq);
      expect(sanitized).toBe('/v1/admin/metrics?page=2&limit=25');
      expect(sanitized).not.toContain('secret-key');
      expect(sanitized).not.toContain('secret-admin');
      expect(sanitized).not.toContain('secret-token');
      expect(sanitized).not.toContain('secret-pass');
      expect(sanitized).not.toContain('arbitrary');
      expect(sanitized).not.toContain('dropme');
    });

    it('omits query string entirely when no allowed parameters are present', () => {
      const mockReq = {
        url: '/v1/admin/metrics?clientKey=secret-client-query-789&access_token=token123&password=pass',
        routeOptions: {
          url: '/v1/admin/metrics',
        },
      };

      const sanitized = sanitizeRequestUrl(mockReq);
      expect(sanitized).toBe('/v1/admin/metrics');
      expect(sanitized).not.toContain('secret-client-query-789');
      expect(sanitized).not.toContain('token123');
      expect(sanitized).not.toContain('pass');
      expect(sanitized).not.toContain('?');
    });

    it('sanitizes case-insensitively while preserving allowed parameters', () => {
      const mockReq = {
        url: '/v1/admin/metrics?PAGE=3&LIMIT=50&PASSWORD=hidden&Access_Token=hidden2',
        routeOptions: {
          url: '/v1/admin/metrics',
        },
      };

      const sanitized = sanitizeRequestUrl(mockReq);
      expect(sanitized).toBe('/v1/admin/metrics?PAGE=3&LIMIT=50');
      expect(sanitized).not.toContain('hidden');
      expect(sanitized).not.toContain('hidden2');
      expect(sanitized).not.toContain('PASSWORD');
      expect(sanitized).not.toContain('Access_Token');
    });

    it('uses generic safe route placeholder when routeOptions is not set (unmatched path)', () => {
      const mockReq = {
        url: '/unmatched/secret-client-key-fallback?access_token=query-secret',
      };

      const sanitized = sanitizeRequestUrl(mockReq);
      expect(sanitized).toBe(SAFE_UNMATCHED_ROUTE);
      expect(sanitized).not.toContain('secret-client-key-fallback');
      expect(sanitized).not.toContain('query-secret');
    });

    it('preserves allowed query parameters on unmatched paths while omitting path segments', () => {
      const mockReq = {
        url: '/unmatched-route/with-secret-12345?page=1&limit=10&password=secret-pass',
      };

      const sanitized = sanitizeRequestUrl(mockReq);
      expect(sanitized).toBe(`${SAFE_UNMATCHED_ROUTE}?page=1&limit=10`);
      expect(sanitized).not.toContain('unmatched-route');
      expect(sanitized).not.toContain('with-secret-12345');
      expect(sanitized).not.toContain('secret-pass');
    });

    it('handles empty, null, or undefined request gracefully', () => {
      expect(sanitizeRequestUrl(null)).toBe(SAFE_UNMATCHED_ROUTE);
      expect(sanitizeRequestUrl(undefined)).toBe(SAFE_UNMATCHED_ROUTE);
      expect(sanitizeRequestUrl({})).toBe(SAFE_UNMATCHED_ROUTE);
    });
  });

  describe('Captured log stream verification in Fastify application', () => {
    it('proves sample client keys are completely absent from captured logs for path, query, and header parameters', async () => {
      let capturedLogs = '';
      const logStream = new Writable({
        write(chunk, _encoding, callback) {
          capturedLogs += chunk.toString();
          callback();
        },
      });

      const samplePathKey = 'sample-client-key-path-94821';
      const sampleQueryKey = 'sample-client-key-query-58392';
      const sampleAdminKey = 'super-secret-admin-token-777';
      const sampleCheckKey = 'super-secret-check-token-888';

      const app = Fastify({
        logger: createLoggerConfig({ stream: logStream, level: 'debug' }),
      });

      app.get('/v1/admin/policies/:clientKey', async (req, reply) => {
        return reply.status(200).send({ ok: true });
      });

      app.get('/v1/admin/metrics', async (req, reply) => {
        return reply.status(200).send({ ok: true });
      });

      // 1. Request with clientKey in URL PATH
      await app.inject({
        method: 'GET',
        url: `/v1/admin/policies/${samplePathKey}`,
        headers: {
          'X-Admin-Key': sampleAdminKey,
        },
      });

      // 2. Request with clientKey in QUERY parameter alongside safe parameters
      await app.inject({
        method: 'GET',
        url: `/v1/admin/metrics?clientKey=${sampleQueryKey}&page=1&limit=10`,
        headers: {
          'X-Check-Key': sampleCheckKey,
        },
      });

      // 3. Request with only clientKey in QUERY parameter
      await app.inject({
        method: 'GET',
        url: `/v1/admin/metrics?clientKey=${sampleQueryKey}`,
        headers: {
          authorization: `Bearer ${sampleAdminKey}`,
        },
      });

      await app.close();

      // Assert that sensitive path key is NEVER logged in raw form
      expect(capturedLogs).not.toContain(samplePathKey);

      // Assert that sensitive query key is NEVER logged in raw form
      expect(capturedLogs).not.toContain(sampleQueryKey);

      // Assert that secrets in headers are redacted
      expect(capturedLogs).not.toContain(sampleAdminKey);
      expect(capturedLogs).not.toContain(sampleCheckKey);

      // Assert that the parameterized route template is logged instead
      expect(capturedLogs).toContain('/v1/admin/policies/:clientKey');

      // Assert that safe query parameters are preserved in the log
      expect(capturedLogs).toContain('page=1&limit=10');
    });

    it('proves query values named x-admin-key, access_token, and password never appear in captured logs while safe page and limit remain', async () => {
      let capturedLogs = '';
      const logStream = new Writable({
        write(chunk, _encoding, callback) {
          capturedLogs += chunk.toString();
          callback();
        },
      });

      const sampleAdminQueryKey = 'leaked-x-admin-key-query-val-111';
      const sampleAccessToken = 'leaked-access-token-query-val-222';
      const samplePassword = 'leaked-password-query-val-333';

      const app = Fastify({
        logger: createLoggerConfig({ stream: logStream, level: 'debug' }),
      });

      app.get('/v1/admin/metrics', async (req, reply) => {
        return reply.status(200).send({ ok: true });
      });

      // Request with sensitive query parameters and safe page and limit
      await app.inject({
        method: 'GET',
        url: `/v1/admin/metrics?x-admin-key=${sampleAdminQueryKey}&access_token=${sampleAccessToken}&password=${samplePassword}&page=5&limit=25`,
      });

      // Request with only sensitive query parameters
      await app.inject({
        method: 'GET',
        url: `/v1/admin/metrics?password=${samplePassword}&access_token=${sampleAccessToken}`,
      });

      await app.close();

      // Credential values MUST NEVER appear in captured logs
      expect(capturedLogs).not.toContain(sampleAdminQueryKey);
      expect(capturedLogs).not.toContain(sampleAccessToken);
      expect(capturedLogs).not.toContain(samplePassword);

      // Disallowed query parameter names MUST NOT appear in the logged URLs
      expect(capturedLogs).not.toContain('x-admin-key=');
      expect(capturedLogs).not.toContain('access_token=');
      expect(capturedLogs).not.toContain('password=');

      // Safe page and limit values MUST remain
      expect(capturedLogs).toContain('page=5');
      expect(capturedLogs).toContain('limit=25');
      expect(capturedLogs).toContain('/v1/admin/metrics?page=5&limit=25');
    });

    it('proves a sensitive value embedded in an unmatched path never appears in captured logs', async () => {
      let capturedLogs = '';
      const logStream = new Writable({
        write(chunk, _encoding, callback) {
          capturedLogs += chunk.toString();
          callback();
        },
      });

      const sensitivePathSegment = 'sensitive-token-in-unmatched-path-98765';
      const sensitiveQueryToken = 'sensitive-token-in-query-54321';

      // Test with the actual application factory from buildApp
      const app = buildApp({
        logger: createLoggerConfig({ stream: logStream, level: 'debug' }),
      });

      await app.ready();

      // 1. Unmatched path with a sensitive token segment and a sensitive query token
      const res1 = await app.inject({
        method: 'GET',
        url: `/unmatched-prefix/${sensitivePathSegment}/action?access_token=${sensitiveQueryToken}&page=4`,
      });
      expect(res1.statusCode).toBe(404);

      // 2. Unmatched path with only sensitive segments
      const res2 = await app.inject({
        method: 'POST',
        url: `/secret-action/${sensitivePathSegment}`,
      });
      expect(res2.statusCode).toBe(404);

      await app.close();

      // Proves sensitive path segments never appear in captured logs
      expect(capturedLogs).not.toContain(sensitivePathSegment);
      expect(capturedLogs).not.toContain('unmatched-prefix');
      expect(capturedLogs).not.toContain('secret-action');

      // Proves sensitive query token never appears
      expect(capturedLogs).not.toContain(sensitiveQueryToken);
      expect(capturedLogs).not.toContain('access_token=');

      // Proves safe generic route placeholder is logged for unmatched requests
      expect(capturedLogs).toContain(`${SAFE_UNMATCHED_ROUTE}?page=4`);
      expect(capturedLogs).toContain(SAFE_UNMATCHED_ROUTE);
    });

    it('proves existing matched-route template logging and header redaction still work', async () => {
      let capturedLogs = '';
      const logStream = new Writable({
        write(chunk, _encoding, callback) {
          capturedLogs += chunk.toString();
          callback();
        },
      });

      const sampleClientKey = 'matched-client-key-path-88123';
      const sampleAdminKey = 'super-secret-admin-token-777';
      const sampleCheckKey = 'super-secret-check-token-888';

      const app = Fastify({
        logger: createLoggerConfig({ stream: logStream, level: 'debug' }),
      });

      app.get('/v1/admin/policies/:clientKey', async (req, reply) => {
        return reply.status(200).send({ ok: true });
      });

      app.post('/v1/check', async (req, reply) => {
        return reply.status(200).send({ decision: 'ALLOW' });
      });

      // 1. Matched admin route with path parameter and header secret
      await app.inject({
        method: 'GET',
        url: `/v1/admin/policies/${sampleClientKey}`,
        headers: {
          'X-Admin-Key': sampleAdminKey,
        },
      });

      // 2. Matched check route with check API key header and payload
      await app.inject({
        method: 'POST',
        url: '/v1/check',
        headers: {
          'X-Check-Key': sampleCheckKey,
        },
        payload: {
          clientKey: sampleClientKey,
          cost: 1,
        },
      });

      await app.close();

      // Plaintext secrets in headers are redacted
      expect(capturedLogs).not.toContain(sampleAdminKey);
      expect(capturedLogs).not.toContain(sampleCheckKey);

      // Raw clientKey path parameter is replaced with route template
      expect(capturedLogs).not.toContain(sampleClientKey);
      expect(capturedLogs).toContain('/v1/admin/policies/:clientKey');
      expect(capturedLogs).toContain('/v1/check');
    });
  });
});
