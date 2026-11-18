import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { runPublicDemoCheck } from '../../scripts/public-demo-check.mjs';
const options = { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)) };
const { createServerCore } = await tsImport('../../apps/api/src/api/server.ts', options);
const { assertPublicReadiness } = await tsImport('../../apps/api/src/demo/public-host.ts', options);

const revision = 'a'.repeat(40);
function staticResponse(path) {
  const values = {
    '/guides/release.json': { revision, simulated: true, contract: '1.0.0', packages: '1.0.0' },
    '/openapi.yaml': 'version: 1.0.0', '/guides/': 'PUBLIC_DEMO.md',
    '/guides/docs/PUBLIC_DEMO.md': 'Operations', '/docs': 'API', '/': '<div id="root"></div>',
  };
  assert.ok(Object.hasOwn(values, path), `Unexpected probe: ${path}`);
  const value = values[path];
  return new Response(typeof value === 'string' ? value : JSON.stringify(value));
}

test('frequent liveness probes never invoke database readiness, even during a database outage', async t => {
  let reads = 0;
  const server = createServerCore({ readinessCheck: async () => { reads++; throw new Error('unavailable'); } });
  t.after(() => server.close());
  for (let i = 0; i < 100; i++) {
    const response = await server.inject('/health');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  }
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(url.pathname);
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, false);
    if (url.pathname === '/health') {
      const response = await server.inject('/health');
      return new Response(response.body, { status: response.statusCode });
    }
    if (url.pathname === '/metrics') return new Response('', { status: 404 });
    return staticResponse(url.pathname);
  };
  const result = await runPublicDemoCheck({ baseUrl: 'https://demo.test/', mode: 'liveness', fetchImpl });
  assert.equal(result.check, 'public_liveness');
  assert.equal(reads, 0);
  assert.ok(!requests.some(path => path === '/ready' || path.startsWith('/demo/') || path.startsWith('/v1/')));
});

test('explicit readiness is fresh, fails on outage/overdue cleanup and recovers without restarting', async t => {
  let state = 'healthy', reads = 0;
  const db = { sql: async () => {
    reads++;
    if (state === 'outage') throw new Error('private connection error');
    return [{ healthy: state === 'healthy' }];
  } };
  const server = createServerCore({ readinessCheck: () => assertPublicReadiness(db) });
  t.after(() => server.close());
  for (const [next, status] of [['healthy', 200], ['outage', 503], ['overdue', 503], ['healthy', 200]]) {
    state = next;
    assert.equal((await server.inject('/ready')).statusCode, status);
    assert.equal((await server.inject('/health')).statusCode, 200);
  }
  assert.equal(reads, 4);
});

test('read-only checks still inspect DB readiness and admission without creating sessions', async () => {
  for (const failingPath of [undefined, '/ready', '/demo/availability']) {
    const requests = [];
    const fetchImpl = async url => {
      const path = url.pathname;
      requests.push(path);
      if (path === failingPath) return new Response('', { status: 503 });
      if (['/health', '/ready', '/demo/availability'].includes(path)) return Response.json({ ok: true });
      if (path === '/metrics') return new Response('', { status: 404 });
      return staticResponse(path);
    };
    const run = runPublicDemoCheck({ baseUrl: 'https://demo.test/', mode: 'read-only', fetchImpl });
    if (failingPath) await assert.rejects(run, { step: failingPath === '/ready' ? 'database readiness' : 'sandbox admission availability' });
    else {
      assert.equal((await run).check, 'public_availability');
      assert.ok(requests.includes('/ready'));
      assert.ok(requests.includes('/demo/availability'));
    }
    assert.ok(!requests.includes('/demo/session'));
  }
});

test('probe failures retain a safe step without exposing transport errors', async () => {
  await assert.rejects(runPublicDemoCheck({ baseUrl: 'https://demo.test/', mode: 'liveness', fetchImpl: async () => {
    throw new Error('secret connection URL');
  } }), error => {
    assert.equal(error.step, 'health');
    assert.ok(!error.message.includes('secret'));
    return true;
  });
});

test('deployment schedules check availability once daily and keep cleanup manual-only', async () => {
  const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  const [render, monitor, cleanup] = await Promise.all([
    read('render.yaml'), read('.github/workflows/public-monitor.yml'), read('.github/workflows/public-cleanup.yml'),
  ]);
  assert.match(render, /healthCheckPath: \/health\b/);
  assert.match(render, /key: DB_CONNECT_TIMEOUT\s+value: "15"/);
  assert.equal([...monitor.matchAll(/cron:/g)].length, 1);
  assert.match(monitor, /cron: '17 8 \* \* \*'/);
  assert.match(monitor, /else\s+node scripts\/public-demo-smoke.mjs --read-only\s+fi/);
  // Exercise the actual Actions shell branch for each event; replace only the command.
  const run = monitor.split('        run: |\n')[1].replace(/^          /gm, '')
    .replaceAll('node scripts/public-demo-smoke.mjs', 'printf \"%s\\n\"');
  for (const [event, schedule, full, expected] of [
    ['schedule', '17 8 * * *', '', '--read-only'],
    ['workflow_dispatch', '', 'false', '--read-only'],
    ['workflow_dispatch', '', 'true', ''],
  ]) {
    assert.equal(execFileSync('sh', ['-c', run], {
      encoding: 'utf8', env: { ...process.env, EVENT_NAME: event, CHECK_SCHEDULE: schedule, FULL_SMOKE: full },
    }).trim(), expected);
  }
  assert.match(cleanup, /workflow_dispatch:/);
  assert.doesNotMatch(cleanup, /schedule:|cron:/);
});
