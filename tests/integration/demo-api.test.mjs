import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateApiKey } from '@borecount/core/application';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { tsImport } from 'tsx/esm/api';
const { testLibrary } = await tsImport('./library-api.test.mjs', import.meta.url);
const { testHostProtection } = await tsImport('./host-protection.test.mjs', { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)) });
import { testSandbox } from './sandbox-api.test.mjs';

const databaseUrl = process.env.DATABASE_URL_TEST ??
  'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_demo_test';
const apiUrl = 'http://127.0.0.1:3100';
const testEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: '3100',
  NODE_ENV: 'test',
  JWT_SIGNING_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
};

const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`));
    });
  });

const waitForApi = async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${apiUrl}/ready`)).ok) return;
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Integration API did not become ready');
};

await run('node', ['scripts/prepare-test-db.mjs'], testEnvironment);
const bootstrapKey = generateApiKey();
const bootstrapEnvironment = {
  ...testEnvironment,
  BOOTSTRAP_TENANT_NAME: 'Integration admin',
  BOOTSTRAP_ADMIN_API_KEY: bootstrapKey,
};
await run('npm', ['run', 'bootstrap:admin-key'], bootstrapEnvironment);
await run('npm', ['run', 'bootstrap:admin-key'], bootstrapEnvironment);
const bootstrapSql = postgres(databaseUrl, { max: 1 });
try {
  const keys = await bootstrapSql`select k.role, k.key_hash, t.name from api_keys k join tenants t on t.id = k.tenant_id`;
  assert.equal(keys.length, 1, 'Repeated bootstrap must keep a single admin credential');
  assert.equal(keys[0].role, 'ADMIN');
  assert.equal(keys[0].name, 'Integration admin');
  assert.equal(keys[0].key_hash, createHash('sha256').update(bootstrapKey).digest('hex'));
} finally {
  await bootstrapSql.end({ timeout: 5 });
}

const api = spawn('npm', ['run', 'start'], { env: testEnvironment, stdio: 'inherit' });

try {
  await waitForApi();

  const removedCompatibilityPaths = [
    ['GET', '/demo/state'],
    ['POST', '/demo/transfers'],
    ['POST', '/demo/holds'],
    ['POST', '/demo/holds/00000000-0000-4000-8000-000000000499/void'],
    ['POST', '/demo/reconciliation'],
    ['POST', '/demo/reset'],
    ['GET', '/demo/session/holds?ledger_id=00000000-0000-4000-8000-000000000001'],
  ];
  for (const [method, path] of removedCompatibilityPaths) {
    const response = await fetch(`${apiUrl}${path}`, { method });
    assert.equal(response.status, 404, `${method} ${path} should not expose a legacy demo route`);
  }

  await testSandbox(apiUrl, databaseUrl);
  await testLibrary(apiUrl, databaseUrl);
  await testHostProtection(databaseUrl);
  console.log('Demo API integration passed: private sandboxes, canonical REST and direct library workflows');
} finally {
  api.kill('SIGTERM');
  await new Promise((resolve) => api.once('exit', resolve));
}
