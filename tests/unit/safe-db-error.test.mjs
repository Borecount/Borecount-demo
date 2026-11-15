import assert from 'node:assert/strict';
import test from 'node:test';
import { safeDatabaseFailure } from '../../scripts/safe-db-error.mjs';

test('cleanup diagnostics classify failures without copying secrets, SQL, detail or arbitrary codes', () => {
  const secret = 'postgresql://user:private-password@host/db';
  for (const [code, category] of [['42501', 'permission'], ['55P03', 'lock_timeout'], ['42P01', 'missing_schema'], ['P1303', 'non_sandbox_data'], ['P1304', 'schema_drift'], ['ECONNREFUSED', 'connection']]) {
    assert.deepEqual(safeDatabaseFailure({ code, message: secret, detail: secret, query: secret }), { code, category });
  }
  assert.deepEqual(safeDatabaseFailure(new Error(secret)), { code: 'UNKNOWN', category: 'unknown' });
  assert.deepEqual(safeDatabaseFailure({ code: secret }), { code: 'UNKNOWN', category: 'unknown' });
  assert.deepEqual(safeDatabaseFailure({ cause: { code: 'P1302', message: secret } }), { code: 'P1302', category: 'missing_marker' });
});
