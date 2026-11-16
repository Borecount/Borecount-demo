import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { childSpecifications } from '../../deploy/render-supervisor.mjs';

const fixtureEnv = {
  PATH: process.env.PATH,
  PUBLIC_DEMO: 'true', DATABASE_URL: 'runtime-canary',
  PUBLIC_DEMO_CLEANUP_DATABASE_URL: 'cleanup-canary',
  JWT_SIGNING_KEY: 'jwt-canary', BOOTSTRAP_ADMIN_KEY: 'admin-canary',
  ARBITRARY_SECRET: 'secret-canary',
};
const supervisorUrl = new URL('../../deploy/render-supervisor.mjs', import.meta.url).href;
const stub = `
const role = process.argv[1];
const options = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify({role, pid: process.pid, env: process.env}) + '\\n');
if (!options.ignoreSignals) {
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
} else {
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
}
setInterval(() => {}, 1000);
if (role === options.exitRole) setTimeout(() => process.exit(options.exitCode ?? 0), 250);
`;

function launch(options = {}) {
  const harness = `
import {childSpecifications, supervise} from ${JSON.stringify(supervisorUrl)};
const options = JSON.parse(process.argv[1]);
const specs = childSpecifications(options.env).map(spec => ({...spec,
  command: spec.name === options.errorRole ? '/nonexistent-render-test-command' : process.execPath,
  args: ['-e', ${JSON.stringify(stub)}, spec.name, JSON.stringify(options)]}));
process.exitCode = await supervise(specs, {shutdownMs: 150});
`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', harness, JSON.stringify({ env: fixtureEnv, ...options })], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const done = once(child, 'exit').then(([code, signal]) => ({ code, signal, errors }));
  return { child, done, records: () => output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}
async function ready(run, count) {
  const deadline = Date.now() + 3000;
  while (run.records().length < count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(run.records().length, count);
}
function assertReaped(records) {
  for (const { pid } of records) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('profiles launch only the authorized worker and require its credential', () => {
  assert.equal(childSpecifications({ PUBLIC_DEMO: 'false' }).length, 2);
  assert.equal(childSpecifications({ PUBLIC_DEMO: 'true', PUBLIC_DEMO_CLEANUP_ENABLED: 'false' }).length, 2);
  assert.throws(() => childSpecifications({ PUBLIC_DEMO: 'true' }), /credential/);
  assert.equal(childSpecifications(fixtureEnv).length, 3);
});

test('real children receive isolated credential environments', { timeout: 5000 }, async t => {
  const run = launch();
  t.after(() => run.child.kill('SIGKILL'));
  await ready(run, 3);
  run.child.kill('SIGTERM');
  assert.equal((await run.done).code, 0);
  const records = run.records();
  const api = records.find(item => item.role === 'api').env;
  const scheduler = records.find(item => item.role === 'scheduler').env;
  const nginx = records.find(item => item.role === 'nginx').env;
  assert.equal(api.DATABASE_URL, 'runtime-canary');
  assert.equal(api.PUBLIC_DEMO_CLEANUP_DATABASE_URL, undefined);
  assert.equal(scheduler.DATABASE_URL, 'cleanup-canary');
  for (const name of ['JWT_SIGNING_KEY', 'BOOTSTRAP_ADMIN_KEY', 'ARBITRARY_SECRET', 'PUBLIC_DEMO_CLEANUP_DATABASE_URL']) assert.equal(scheduler[name], undefined);
  assert.equal(JSON.stringify(scheduler).includes('runtime-canary'), false);
  for (const value of ['runtime-canary', 'cleanup-canary', 'jwt-canary', 'admin-canary', 'secret-canary']) assert.equal(JSON.stringify(nginx).includes(value), false);
  assertReaped(records);
});

for (const role of ['api', 'nginx', 'scheduler']) {
  for (const exitCode of [0, 7]) {
    test(`${role} exit ${exitCode} fails supervisor and reaps siblings`, { timeout: 5000 }, async t => {
      const run = launch({ exitRole: role, exitCode });
      t.after(() => run.child.kill('SIGKILL'));
      assert.equal((await run.done).code, 1);
      assertReaped(run.records());
    });
  }
  test(`${role} spawn error fails supervisor and reaps siblings`, { timeout: 5000 }, async t => {
    const run = launch({ errorRole: role });
    t.after(() => run.child.kill('SIGKILL'));
    assert.equal((await run.done).code, 1);
    assertReaped(run.records());
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} gracefully stops children`, { timeout: 5000 }, async t => {
    const run = launch();
    t.after(() => run.child.kill('SIGKILL'));
    await ready(run, 3);
    run.child.kill(signal);
    assert.equal((await run.done).code, 0);
    assertReaped(run.records());
  });
}

test('shutdown kills children that ignore termination after bounded grace period', { timeout: 5000 }, async t => {
  const run = launch({ ignoreSignals: true });
  t.after(() => run.child.kill('SIGKILL'));
  await ready(run, 3);
  const started = Date.now();
  run.child.kill('SIGTERM');
  assert.equal((await run.done).code, 0);
  assert.ok(Date.now() - started >= 140);
  assert.ok(Date.now() - started < 2000);
  assertReaped(run.records());
});

test('entrypoint preserves private migration and sanitizes configure before supervisor', async t => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'render-entrypoint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recordPath = join(directory, 'records.jsonl');
  const shim = `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({args: process.argv.slice(2), env: process.env}) + '\\n');
`;
  for (const name of ['node', 'npm']) await writeFile(join(directory, name), shim, { mode: 0o755 });
  for (const publicDemo of ['false', 'true']) {
    await writeFile(recordPath, '');
    const child = spawn('/bin/bash', [new URL('../../deploy/render-entrypoint.sh', import.meta.url).pathname], {
      env: { ...fixtureEnv, PUBLIC_DEMO: publicDemo, PATH: `${directory}:${process.env.PATH}`, RENDER_TRUSTED_PROXY_CIDRS: '10.0.0.0/8' },
      stdio: 'pipe',
    });
    assert.equal((await once(child, 'exit'))[0], 0);
    const records = (await readFile(recordPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.length, publicDemo === 'false' ? 3 : 2);
    if (publicDemo === 'false') {
      assert.deepEqual(records[0].args, ['run', 'db:migrate']);
      assert.equal(records[0].env.PUBLIC_DEMO_CLEANUP_DATABASE_URL, undefined);
    }
    const configure = records.at(-2);
    assert.deepEqual(configure.args, ['--import', 'tsx', 'deploy/render-configure.mjs']);
    assert.equal(configure.env.RENDER_TRUSTED_PROXY_CIDRS, '10.0.0.0/8');
    for (const name of ['DATABASE_URL', 'PUBLIC_DEMO_CLEANUP_DATABASE_URL', 'JWT_SIGNING_KEY', 'BOOTSTRAP_ADMIN_KEY', 'ARBITRARY_SECRET']) assert.equal(configure.env[name], undefined);
    assert.deepEqual(records.at(-1).args, ['deploy/render-supervisor.mjs']);
  }
});
