import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { tsImport } from 'tsx/esm/api';

const [{ registerLibrary }, { FixedWindowLimiter }, { parseRateLimitConfig }] = await Promise.all([
  tsImport('../../apps/api/src/demo/library.ts', import.meta.url),
  tsImport('../../apps/api/src/api/rate-limit/fixed-window-limiter.ts', import.meta.url),
  tsImport('../../apps/api/src/api/rate-limit/policy.ts', import.meta.url),
]);

test('parameterized library calls reuse validators instead of growing the AJV cache', async () => {
  let validatorEngine;
  const server = Fastify({
    ajv: {
      onCreate(engine) {
        validatorEngine = engine;
      },
    },
  });
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const actorId = '00000000-0000-4000-8000-000000000002';
  const services = { ledgers: { getById: async (_tenantId, id) => ({ id }) } };
  registerLibrary(server, services, async () => ({ tenant_id: tenantId, api_key_id: actorId }), {
    rateLimiter: new FixedWindowLimiter(),
    writePolicy: parseRateLimitConfig({}).write,
  });

  try {
    const execute = async (ledgerId) => {
      const response = await server.inject({
        method: 'POST',
        url: '/demo/library/execute',
        headers: { host: 'demo.test', origin: 'http://demo.test' },
        payload: { operation: 'ledgers.getById', input: { ledgerId } },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().result.id, ledgerId);
    };

    await execute('00000000-0000-4000-8000-000000000003');
    // AJV's strong cache is the regression boundary; Fastify's WeakMap alone
    // would not reveal validators retained after compiling fresh schema objects.
    const initialCacheSize = validatorEngine._cache.size;
    for (let index = 4; index < 14; index++) {
      await execute(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
      assert.equal(validatorEngine._cache.size, initialCacheSize);
    }
  } finally {
    await server.close();
  }
});
