// Destructive setup is allowed only in an explicitly supplied isolated LOCAL test cluster.
// Creates a NEW database; refuses to adopt or reset an existing installation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { tsImport } from 'tsx/esm/api';
import { createApplicationServices, createDbClient } from '@borecount/postgres-adapter';
const target = new URL(process.env.PUBLIC_HOST_TEST_ADMIN_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.equal(target.pathname, '/postgres');
assert.notEqual(target.port || '5432', '5432', 'Never run against the default database port');
const admin = postgres(target.href, { max: 1 });
const created = [];
const upgrading = process.argv.includes("--upgrade");
let owner, runtime, cleanup, canary, server;
let legacyRoleCreated = false;
const originalDateNow = Date.now;
const passwords = Object.fromEntries(['owner', 'runtime', 'cleanup'].map(name => [name, randomBytes(32).toString('hex')]));
const url = (database, role = target.username, password = target.password) => {
  const next = new URL(target); next.pathname = `/${database}`; next.username = role; next.password = password; return next.href;
};
const options = { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)) };
async function runScheduler(databaseUrl, expectedEvents) {
  const child = spawn(process.execPath, ['scripts/public-demo-scheduler.mjs'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let exited = false;
  const shutdownLimit = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 15_000);
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  const eventWait = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Scheduler events timed out: ${expectedEvents.join(', ')}`)), 10_000);
    const check = () => {
      if (expectedEvents.every(event => output.includes(`"event":"${event}"`))) {
        clearTimeout(deadline); resolve();
      } else if (exited) {
        clearTimeout(deadline); reject(new Error(`Scheduler exited before expected events: ${output}`));
      }
    };
    child.stdout.on('data', check); child.stderr.on('data', check);
    check();
  });
  try {
    await eventWait;
    child.kill('SIGTERM');
    const result = await exit;
    assert.equal(result.code, 0, `Scheduler should stop cleanly: ${output}`);
    assert.ok(expectedEvents.every(event => output.includes(`"event":"${event}"`)));
    return output;
  } finally {
    clearTimeout(shutdownLimit);
    if (!exited) {
      child.kill('SIGKILL');
      await exit;
    }
  }
}
try {
  await admin.unsafe('CREATE DATABASE luxledger_demo_hosted'); created.push('luxledger_demo_hosted');
  if (upgrading) {
    await admin.unsafe(`CREATE ROLE legacy_demo_admin LOGIN CREATEDB CREATEROLE BYPASSRLS NOSUPERUSER PASSWORD '${passwords.owner}'`);
    legacyRoleCreated = true;
    await admin.unsafe('ALTER DATABASE luxledger_demo_hosted OWNER TO legacy_demo_admin');
  }
  await admin.unsafe('CREATE DATABASE public_host_canary'); created.push('public_host_canary');
  await admin.unsafe('REVOKE ALL ON DATABASE public_host_canary FROM PUBLIC');
  canary = postgres(url('public_host_canary'), { max: 1 });
  await canary`create table private_canary (value text)`;
  await canary`insert into private_canary values ('untouched')`;
  const [{ createServerCore, registerApplication, canonicalOpenApi }, { registerSandbox }, { HostProtection }, { assertPublicHost, assertPublicReadiness, assertSandboxCapacity }] = await Promise.all([
    tsImport('../../apps/api/src/api/server.ts', options), tsImport('../../apps/api/src/demo/sandbox.ts', options),
    tsImport('../../apps/api/src/api/resource-protection/host-protection.ts', options), tsImport('../../apps/api/src/demo/public-host.ts', options),
  ]);
  const jwtAuth = { signingKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY', previousSigningKeys: [], issuer: 'public-host-test', accessTokenTtlSeconds: 900, clockSkewSeconds: 0 };
  const legacyUrl = upgrading ? url('luxledger_demo_hosted', 'legacy_demo_admin', passwords.owner) : url('luxledger_demo_hosted');
  const cluster = postgres(legacyUrl, { max: 1 });
  const migrateUrl = url('luxledger_demo_hosted', 'borecount_demo_owner', passwords.owner);
  try {
    if (!upgrading) {
      let roles = await readFile('tests/integration/public-roles.sql', 'utf8');
      for (const [name, password] of Object.entries(passwords)) roles = roles.replaceAll(`:'${name}_password'`, `'${password}'`);
      await cluster.unsafe(roles);
    }
    const migrated = spawnSync('npm', ['run', 'db:migrate'], {
      env: { ...process.env, DATABASE_URL: upgrading ? legacyUrl : migrateUrl }, stdio: 'pipe',
    });
    assert.equal(migrated.status, 0, 'Initial schema migration must succeed');
    if (upgrading) {
      const oldDb = createDbClient({ databaseUrl: legacyUrl });
      const oldServices = createApplicationServices(oldDb);
      const oldProtection = new HostProtection();
      const oldHost = createServerCore({ logger: false, readinessCheck: async () => {} });
      registerApplication(oldHost, { services: oldServices, jwtAuth, protection: oldProtection, authorizeAdjustment: false });
      registerSandbox(oldHost, oldDb, oldServices, jwtAuth, { protection: oldProtection, specification: canonicalOpenApi });
      try {
        const legacy = await oldHost.inject({ method: 'POST', url: '/demo/session', headers: { host: 'demo.test', origin: 'https://demo.test' } });
        assert.equal(legacy.statusCode, 201, legacy.body);
      } finally { await oldHost.close(); await oldDb.sql.end({ timeout: 5 }); }
      assert.equal((await cluster`select rolsuper from pg_roles where rolname = current_user`)[0].rolsuper, false, 'Upgrade must be exercised without real superuser privileges');
      const balances = await cluster`select id, balance_minor::text from accounts order by id`;
      const history = await cluster`select id, reference from transactions order by id`;
      assert.equal(balances.length, 12); assert.equal(history.length, 2);
      await cluster.unsafe(await readFile('deploy/public/neon-upgrade.sql', 'utf8'));
      assert.deepEqual(await cluster`select id, balance_minor::text from accounts order by id`, balances);
      assert.deepEqual(await cluster`select id, reference from transactions order by id`, history);
      for (const [name, password] of Object.entries(passwords).filter(([name]) => name !== 'owner')) {
        // Test fixtures only. Live password entry is performed by the account owner.
        await cluster.unsafe(`ALTER ROLE borecount_demo_${name} LOGIN PASSWORD '${password}'`);
      }
    }
  } finally { await cluster.end({ timeout: 5 }); }
  const releaseUrl = upgrading ? legacyUrl : migrateUrl;
  const prepare = () => spawnSync(process.execPath, ['scripts/prepare-public-demo.mjs'], {
    env: { ...process.env, DATABASE_URL: releaseUrl }, stdio: 'pipe',
  });
  const prepared = prepare();
  assert.equal(prepared.status, 0, prepared.stderr.toString());
  owner = postgres(releaseUrl, { max: 1, onnotice: () => {} });
  await owner.unsafe('SET ROLE borecount_demo_owner');
  const migrationJournal = await owner`select count(*)::int as n from drizzle.__drizzle_migrations`;
  assert.ok(migrationJournal[0].n > 0, 'Public preparation must retain the existing migration journal');
  const journalBeforeReset = await owner`select id, hash, created_at from drizzle.__drizzle_migrations order by id`;
  if (upgrading) assert.equal((await owner`select rolcanlogin from pg_roles where rolname = 'borecount_demo_owner'`)[0].rolcanlogin, false, 'Managed admin SET ROLE supports a NOLOGIN owner');
  // Releasing an unchanged profile is idempotent and must not postpone the retention deadline.
  const before = await owner`select next_reset_at from demo_ops.state`;
  const repeated = prepare();
  assert.equal(repeated.status, 0, repeated.stderr.toString());
  assert.deepEqual(await owner`select next_reset_at from demo_ops.state`, before);
  runtime = createDbClient({ databaseUrl: url('luxledger_demo_hosted', 'borecount_demo_runtime', passwords.runtime) });
  cleanup = postgres(url('luxledger_demo_hosted', 'borecount_demo_cleanup', passwords.cleanup), { max: 1 });
  await assertPublicHost(runtime);
  await assert.rejects(() => runtime.sql`select demo_ops.cleanup_due()`);
  await assert.rejects(() => runtime.sql`truncate public.demo_sessions`);
  await assert.rejects(() => runtime.sql`create table public.unauthorized (id int)`);
  await assert.rejects(() => cleanup`select * from public.demo_sessions`);
  await assert.rejects(() => cleanup`truncate public.demo_sessions`);
  await assert.rejects(() => cleanup`update demo_ops.state set next_reset_at = now()`);
  for (const name of ['runtime', 'cleanup', 'owner']) {
    const denied = postgres(url('public_host_canary', `borecount_demo_${name}`, passwords[name]), { max: 1 });
    try { await assert.rejects(() => denied`select * from private_canary`); }
    finally { await denied.end({ timeout: 5 }); }
  }
  const services = createApplicationServices(runtime);
  const protection = new HostProtection();
  server = createServerCore({ logger: false, readinessCheck: () => assertPublicReadiness(runtime) });
  registerApplication(server, { services, jwtAuth, protection, authorizeAdjustment: false });
  const publicLimits = { maxTenants: upgrading ? 3 : 2, hourlyCreates: upgrading ? 3 : 2 };
  registerSandbox(server, runtime, services, jwtAuth, { protection, specification: canonicalOpenApi }, publicLimits);
  const start = () => server.inject({ method: 'POST', url: '/demo/session', headers: { host: 'demo.test', origin: 'https://demo.test' } });
  const expect = (response, status) => { assert.equal(response.statusCode, status, response.body); return response.json(); };
  const admissions = async () => [...await owner`select * from demo_ops.sandbox_admissions order by tenant_id`];
  await owner`update demo_ops.state set next_reset_at = now() + interval '10 minutes'`;
  Date.now = () => originalDateNow() + 6 * 60 * 60 * 1000;
  expect(await server.inject({ method: 'GET', url: '/ready' }), 200);
  Date.now = () => originalDateNow() - 6 * 60 * 60 * 1000;
  expect(await server.inject({ method: 'GET', url: '/ready' }), 200);
  Date.now = originalDateNow;
  await owner`update demo_ops.state set next_reset_at = now() - interval '14 minutes'`;
  expect(await server.inject({ method: 'GET', url: '/ready' }), 200);
  await owner`update demo_ops.state set next_reset_at = ${before[0].next_reset_at}`;
  const availabilityBefore = await admissions();
  for (let i = 0; i < 3; i++) expect(await server.inject({ method: 'GET', url: '/demo/availability' }), 200);
  assert.deepEqual(await admissions(), availabilityBefore, 'Availability must not consume admission quota');
  const first = expect(await start(), 201);
  const second = expect(await start(), 201);
  const rest = (path, identity = first, payload) => server.inject({ method: payload ? 'POST' : 'GET', url: path, headers: { authorization: `Bearer ${identity.access_token}` }, ...(payload ? { payload } : {}) });
  const ledger = expect(await rest('/v1/ledgers'), 200).data[0];
  expect(await rest(`/v1/ledgers/${ledger.id}`, second), 404);
  expect(await start(), 429);
  expect(await server.inject({ method: 'GET', url: '/ready' }), 200);
  expect(await server.inject({ method: 'GET', url: '/demo/availability' }), 503);
  await assert.rejects(() => runtime.runTx('hourly-cap', tx => assertSandboxCapacity(tx, { maxTenants: 4, hourlyCreates: 2 }, '00000000-0000-4000-8000-000000000134')), error => error.code === 'RATE_LIMIT_EXCEEDED');
  await owner.begin(async tx => {
    await tx`select pg_advisory_xact_lock(133132)`;
    expect(await start(), 429);
  });
  const [{ n }] = await runtime.sql`select count(*)::int as n from tenants`;
  assert.equal(n, upgrading ? 3 : 2, 'Rejected seed must not leave a tenant');
  assert.equal((await runtime.sql`select * from accounts`).length, 0, 'Raw runtime queries cannot bypass tenant RLS');
  await assert.rejects(() => runtime.sql`delete from demo_ops.sandbox_admissions`);
  // The same DB is full under public policy; private/local hosts must still provision normally.
  const privateHost = createServerCore({ logger: false, readinessCheck: async () => {} });
  const privateProtection = new HostProtection();
  registerApplication(privateHost, { services, jwtAuth, protection: privateProtection, authorizeAdjustment: false });
  registerSandbox(privateHost, runtime, services, jwtAuth, { protection: privateProtection, specification: canonicalOpenApi });
  const quotaBeforePrivate = await admissions();
  try {
    expect(await privateHost.inject({ method: 'GET', url: '/demo/availability' }), 404);
    expect(await privateHost.inject({ method: 'POST', url: '/demo/session', headers: { host: 'demo.test', origin: 'https://demo.test' } }), 201);
  } finally { await privateHost.close(); }
  assert.deepEqual(await admissions(), quotaBeforePrivate, 'Private provisioning does not consume public quota');
  const accounts = expect(await rest(`/v1/accounts?ledger_id=${ledger.id}`), 200).data;
  const body = { ledger_id: ledger.id, reference: 'public-profile-posting', currency: 'USD', entries: [
    { account_id: accounts.find(a => a.code === 'DEMO_PRIMARY').id, signed_amount_minor: '100', currency: 'USD' },
    { account_id: accounts.find(a => a.code === 'DEMO_SECONDARY').id, signed_amount_minor: '-100', currency: 'USD' },
  ] };
  const posted = expect(await rest('/v1/transactions', first, body), 201);
  assert.equal(expect(await rest('/v1/transactions', first, body), 200).transaction_id, posted.transaction_id);
  assert.equal((await cleanup`select demo_ops.cleanup_due() as reset`)[0].reset, false);
  // A non-sandbox tenant makes destructive cleanup fail closed, even with a due deadline.
  await owner`insert into tenants (id, name) values ('00000000-0000-4000-8000-000000000133', 'Do not reset')`;
  await owner`update demo_ops.state set next_reset_at = now() - interval '16 minutes'`;
  Date.now = () => originalDateNow() - 6 * 60 * 60 * 1000;
  expect(await server.inject({ method: 'GET', url: '/ready' }), 503);
  Date.now = originalDateNow;
  expect(await server.inject({ method: 'GET', url: '/demo/availability' }), 503);
  await assert.rejects(() => cleanup`select demo_ops.cleanup_due()`);
  const refusedWorker = spawnSync(process.execPath, ['scripts/public-demo-cleanup.mjs'], {
    env: { ...process.env, DATABASE_URL: url('luxledger_demo_hosted', 'borecount_demo_cleanup', passwords.cleanup) }, stdio: 'pipe',
  });
  assert.equal(refusedWorker.status, 1);
  const safeFailure = JSON.parse(refusedWorker.stderr.toString());
  assert.equal(safeFailure.code, 'P1303');
  assert.equal(safeFailure.category, 'non_sandbox_data');
  assert.deepEqual(Object.keys(safeFailure).sort(), ['at', 'category', 'code', 'event']);
  expect(await rest('/v1/ledgers'), 200);
  await owner`delete from tenants where id = '00000000-0000-4000-8000-000000000133'`;
  await owner`create table public.unreviewed_data (id int)`;
  await assert.rejects(() => cleanup`select demo_ops.cleanup_due()`);
  await owner`drop table public.unreviewed_data`;
  // Real ledger+session data is reset atomically; the rolling-hour admission budget survives it.
  const quotaBeforeReset = await admissions();
  // Hold the real cleanup advisory lock from a separate connection; the worker must fail closed.
  await owner.begin(async tx => {
    await tx`select pg_advisory_xact_lock(133132)`;
    assert.equal((await cleanup`select demo_ops.cleanup_due() as reset`)[0].reset, false);
  });
  expect(await server.inject({ method: 'GET', url: '/ready' }), 503);
  const cleanupUrl = url('luxledger_demo_hosted', 'borecount_demo_cleanup', passwords.cleanup);
  const schedulerOutput = await runScheduler(cleanupUrl, ['sandbox_database_reset', 'sandbox_cleanup_scheduled']);
  for (const password of Object.values(passwords)) assert.ok(!schedulerOutput.includes(password), 'Scheduler output must not expose credentials');
  assert.equal((await owner`select count(*)::int as n from tenants`)[0].n, 0);
  assert.equal((await owner`select count(*)::int as n from demo_sessions`)[0].n, 0);
  const [resetState] = await owner`select next_reset_at > now() as deadline_is_future from demo_ops.state`;
  assert.equal(resetState.deadline_is_future, true, 'Successful reset must persist a future cleanup deadline');
  assert.deepEqual(await owner`select id, hash, created_at from drizzle.__drizzle_migrations order by id`, journalBeforeReset,
    'Whole-demo cleanup must retain the migration journal');
  const deadlineAfterReset = (await owner`select next_reset_at from demo_ops.state`)[0].next_reset_at;
  const futureSchedulerOutput = await runScheduler(cleanupUrl, ['sandbox_cleanup_scheduled']);
  for (const password of Object.values(passwords)) assert.ok(!futureSchedulerOutput.includes(password), 'Scheduler output must not expose credentials');
  assert.ok(!futureSchedulerOutput.includes('"event":"sandbox_database_reset"'), 'Future deadline must not trigger a reset');
  assert.deepEqual((await owner`select next_reset_at from demo_ops.state`)[0].next_reset_at, deadlineAfterReset,
    'Starting scheduler with a future deadline must preserve it');
  expect(await server.inject({ method: 'GET', url: '/ready' }), 200);
  assert.deepEqual(await admissions(), quotaBeforeReset, 'Daily reset must not reset the rolling-hour quota');
  expect(await rest('/v1/ledgers'), 401);
  expect(await start(), 429);
  expect(await server.inject({ method: 'GET', url: '/demo/availability' }), 503);
  // Once the original hour expires, availability recovers without consuming anything.
  await owner`update demo_ops.sandbox_admissions set admitted_at = statement_timestamp() - interval '1 hour 1 second'`;
  const expiredQuota = await admissions();
  expect(await server.inject({ method: 'GET', url: '/demo/availability' }), 200);
  assert.deepEqual(await admissions(), expiredQuota);
  expect(await start(), 201);
  assert.deepEqual([...await canary`select value from private_canary`], [{ value: 'untouched' }]);
  console.log((upgrading ? 'Existing demo upgrade preserved balances/history. ' : '') + 'Public host passed: unprivileged migration/runtime, RLS, seed cap, posting/retry, fixed-target cleanup, token invalidation, non-sandbox refusal and inaccessible canary');
} finally {
  Date.now = originalDateNow;
  await server?.close();
  await Promise.all([owner?.end({ timeout: 5 }), runtime?.sql.end({ timeout: 5 }), cleanup?.end({ timeout: 5 }), canary?.end({ timeout: 5 })]);
  for (const database of created.reverse()) await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
  if (owner) {
    for (const name of ['runtime', 'cleanup', 'owner']) await admin.unsafe(`DROP ROLE borecount_demo_${name}`);
  }
  if (legacyRoleCreated) await admin.unsafe('DROP ROLE legacy_demo_admin');
  await admin.end({ timeout: 5 });
}
