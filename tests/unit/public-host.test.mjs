import assert from 'node:assert/strict';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';
const { parseSandboxLimits } = await tsImport('../../apps/api/src/demo/public-host.ts', import.meta.url);

test('sandbox admission configuration rejects unbounded or malformed capacity', () => {
  assert.deepEqual(parseSandboxLimits({}), { maxTenants: 500, hourlyCreates: 60 });
  for (const name of ['SANDBOX_MAX_TENANTS', 'SANDBOX_HOURLY_CREATES']) {
    for (const value of ['0', '-1', '', 'NaN', '1.5', '10001']) {
      assert.throws(() => parseSandboxLimits({ [name]: value }), new RegExp(name));
    }
  }
  assert.deepEqual(parseSandboxLimits({ SANDBOX_MAX_TENANTS: '2', SANDBOX_HOURLY_CREATES: '1' }), { maxTenants: 2, hourlyCreates: 1 });
});
