import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
  console.log('Demo API integration passed: only private-session provisioning and public /v1 flows remain');
} finally {
  api.kill('SIGTERM');
  await new Promise((resolve) => api.once('exit', resolve));
}
