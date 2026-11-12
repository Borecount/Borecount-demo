import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const apiTsconfig = fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url));

const [
  { canonicalOpenApi, createServerCore, registerApplication },
  { registerLibrary },
  { FixedWindowLimiter },
  { issueAccessToken },
] = await Promise.all([
  tsImport('../../apps/api/src/api/server.ts', {
    parentURL: import.meta.url,
    tsconfig: apiTsconfig,
  }),
  tsImport('../../apps/api/src/demo/library.ts', import.meta.url),
  tsImport('../../apps/api/src/api/rate-limit/fixed-window-limiter.ts', import.meta.url),
  tsImport('../../apps/api/src/api/auth/jwt.ts', import.meta.url),
]);

test('REST and Library writes share a quota while Library reads do not consume it', async () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const apiKeyId = '00000000-0000-4000-8000-000000000002';
  const signingKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY';
  const jwtAuth = {
    signingKey,
    previousSigningKeys: [],
    issuer: 'test-api',
    accessTokenTtlSeconds: 900,
    clockSkewSeconds: 0,
  };
  const writePolicy = { maxRequests: 2, windowSeconds: 60 };
  const rateLimiter = new FixedWindowLimiter();
  const ledger = (name) => ({
    id:
      name === 'REST write'
        ? '00000000-0000-4000-8000-000000000003'
        : '00000000-0000-4000-8000-000000000004',
    tenantId,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const services = new Proxy(
    {
      apiKeys: {
        assertAccessTokenIsActive: async () => undefined,
        authenticate: async () => ({}),
      },
      ledgers: {
        create: async ({ name }) => ledger(name),
        list: async () => ({ data: [], nextCursor: null }),
      },
    },
    {
      get(target, property) {
        return (
          target[property] ??
          new Proxy(
            {},
            {
              get() {
                return async () => ({});
              },
            },
          )
        );
      },
    },
  );
  const server = createServerCore({ readinessCheck: async () => undefined, logger: false });

  registerApplication(server, {
    services,
    jwtAuth,
    rateLimit: {
      authToken: { maxRequests: 2, windowSeconds: 60 },
      write: writePolicy,
    },
    rateLimiter,
    authorizeAdjustment: false,
  });
  registerLibrary(
    server,
    services,
    async () => ({ tenant_id: tenantId, api_key_id: apiKeyId }),
    { rateLimiter, writePolicy },
    canonicalOpenApi,
  );

  const accessToken = issueAccessToken({ apiKeyId, tenantId, role: 'SERVICE' }, jwtAuth);
  const sameOriginHeaders = {
    host: 'demo.test',
    origin: 'http://demo.test',
    'content-type': 'application/json',
  };

  try {
    const restWrite = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: {
        ...sameOriginHeaders,
        authorization: `Bearer ${accessToken}`,
      },
      payload: { name: 'REST write' },
    });
    assert.equal(restWrite.statusCode, 201, restWrite.body);

    // The Library read uses POST for transport, but it does not consume a write slot.
    const libraryRead = await server.inject({
      method: 'POST',
      url: '/demo/library/execute',
      headers: sameOriginHeaders,
      payload: { operation: 'ledgers.list', input: {} },
    });
    assert.equal(libraryRead.statusCode, 200, libraryRead.body);

    const libraryWrite = await server.inject({
      method: 'POST',
      url: '/demo/library/execute',
      headers: sameOriginHeaders,
      payload: { operation: 'ledgers.create', input: { name: 'Library write' } },
    });
    assert.equal(libraryWrite.statusCode, 200, libraryWrite.body);

    // A third write is rejected because both preceding writes used one shared IP bucket.
    const limitedRestWrite = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: {
        ...sameOriginHeaders,
        authorization: `Bearer ${accessToken}`,
      },
      payload: { name: 'Over quota' },
    });
    assert.equal(limitedRestWrite.statusCode, 429, limitedRestWrite.body);
    assert.ok(Number(limitedRestWrite.headers['retry-after']) > 0);
    assert.equal(
      Number(limitedRestWrite.json().retry_after_seconds),
      Number(limitedRestWrite.headers['retry-after']),
    );
  } finally {
    await server.close();
  }
});
