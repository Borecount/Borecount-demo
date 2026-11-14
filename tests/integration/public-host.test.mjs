// Destructive setup is allowed only in an explicitly supplied isolated LOCAL test cluster.
// Creates a NEW database; refuses to adopt or reset an existing installation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
let owner, runtime, cleanup, canary, server;
const passwords = Object.fromEntries(['owner', 'runtime', 'cleanup'].map(name => [name, randomBytes(32).toString('hex')]));
const url = (database, role = target.username, password = target.password) => {
  const next = new URL(target); next.pathname = `/${database}`; next.username = role; next.password = password; return next.href;
};
const options = { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)) };
try {
  await admin.unsafe('CREATE DATABASE luxledger_demo_hosted'); created.push('luxledger_demo_hosted');
  await admin.unsafe('CREATE DATABASE public_host_canary'); created.push('public_host_canary');
  await admin.unsafe('REVOKE ALL ON DATABASE public_host_canary FROM PUBLIC');
  canary = postgres(url('public_host_canary'), { max: 1 });
  await canary`create table private_canary (value text)`;
  await canary`insert into private_canary values ('untouched')`;
  const cluster = postgres(url('luxledger_demo_hosted'), { max: 1 });
  try {
    let roles = await readFile('tests/integration/public-roles.sql', 'utf8');
    for (const [name, password] of Object.entries(passwords)) roles = roles.replaceAll(`:'${name}_password'`, `'${password}'`);
    await cluster.unsafe(roles);
  } finally { await cluster.end({ timeout: 5 }); }
  const migrateUrl = url('luxledger_demo_hosted', 'borecount_demo_owner', passwords.owner);
  const migrated = spawnSync('npm', ['run', 'db:migrate'], { env: { ...process.env, DATABASE_URL: migrateUrl }, stdio: 'pipe' });
  assert.equal(migrated.status, 0, 'Migrations must run using the non-superuser owner');
  owner = postgres(migrateUrl, { max: 1, onnotice: () => {} });
  const setup = (await readFile('deploy/public/prepare.sql', 'utf8')).replace(/^\\set.*$/gm, '');
  await owner.unsafe(setup);
  // Releasing an unchanged profile is idempotent and must not postpone the retention deadline.
  const before = await owner`select next_reset_at from demo_ops.state`;
  await owner.unsafe(setup);
  assert.deepEqual(await owner`select next_reset_at from demo_ops.state`, before);
  runtime = createDbClient({ databaseUrl: url('luxledger_demo_hosted', 'borecount_demo_runtime', passwords.runtime) });
  cleanup = postgres(url('luxledger_demo_hosted', 'borecount_demo_cleanup', passwords.cleanup), { max: 1 });
  const [{ createServerCore, registerApplication, canonicalOpenApi }, { registerSandbox }, { HostProtection }, { assertPublicHost, assertSandboxCapacity }] = await Promise.all([
    tsImport('../../apps/api/src/api/server.ts', options), tsImport('../../apps/api/src/demo/sandbox.ts', options),
    tsImport('../../apps/api/src/api/resource-protection/host-protection.ts', options), tsImport('../../apps/api/src/demo/public-host.ts', options),
  ]);
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
  const jwtAuth = { signingKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY', previousSigningKeys: [], issuer: 'public-host-test', accessTokenTtlSeconds: 900, clockSkewSeconds: 0 };
  const services = createApplicationServices(runtime);
  const protection = new HostProtection();
  server = createServerCore({ logger: false, readinessCheck: async () => { await runtime.sql`select 1`; } });
  registerApplication(server, { services, jwtAuth, protection, authorizeAdjustment: false });
  process.env.SANDBOX_MAX_TENANTS = '2';
  registerSandbox(server, runtime, services, jwtAuth, { protection, specification: canonicalOpenApi });
  delete process.env.SANDBOX_MAX_TENANTS;
  const start = () => server.inject({ method: 'POST', url: '/demo/session', headers: { host: 'demo.test', origin: 'https://demo.test' } });
  const expect = (response, status) => { assert.equal(response.statusCode, status, response.body); return response.json(); };
  const first = expect(await start(), 201);
  const second = expect(await start(), 201);
  const rest = (path, identity = first, payload) => server.inject({ method: payload ? 'POST' : 'GET', url: path, headers: { authorization: `Bearer ${identity.access_token}` }, ...(payload ? { payload } : {}) });
  const ledger = expect(await rest('/v1/ledgers'), 200).data[0];
  expect(await rest(`/v1/ledgers/${ledger.id}`, second), 404);
  expect(await start(), 429);
  await assert.rejects(() => runtime.runTx('hourly-cap', tx => assertSandboxCapacity(tx, { maxTenants: 3, hourlyCreates: 2 })), error => error.code === 'RATE_LIMIT_EXCEEDED');
  await owner.begin(async tx => {
    await tx`select pg_advisory_xact_lock(133132)`;
    expect(await start(), 429);
  });
  const [{ n }] = await runtime.sql`select count(*)::int as n from tenants`;
  assert.equal(n, 2, 'Rejected seed must not leave a tenant');
  assert.equal((await runtime.sql`select * from accounts`).length, 0, 'Raw runtime queries cannot bypass tenant RLS');
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
  await owner`update demo_ops.state set next_reset_at = now() - interval '1 second'`;
  await assert.rejects(() => cleanup`select demo_ops.cleanup_due()`);
  expect(await rest('/v1/ledgers'), 200);
  await owner`delete from tenants where id = '00000000-0000-4000-8000-000000000133'`;
  await owner`create table public.unreviewed_data (id int)`;
  await assert.rejects(() => cleanup`select demo_ops.cleanup_due()`);
  await owner`drop table public.unreviewed_data`;
  // Real ledger+session data is reset atomically, without disabling any financial triggers.
  const worker = spawnSync('node', ['scripts/public-demo-cleanup.mjs', '--once'], {
    env: { ...process.env, DATABASE_URL: url('luxledger_demo_hosted', 'borecount_demo_cleanup', passwords.cleanup) }, stdio: 'pipe',
  });
  assert.equal(worker.status, 0, 'Restricted cleanup worker must reset the due installation');
  assert.match(worker.stdout.toString(), /sandbox_database_reset/);
  assert.equal((await owner`select count(*)::int as n from tenants`)[0].n, 0);
  assert.equal((await owner`select count(*)::int as n from demo_sessions`)[0].n, 0);
  expect(await rest('/v1/ledgers'), 401);
  expect(await start(), 201);
  assert.deepEqual([...await canary`select value from private_canary`], [{ value: 'untouched' }]);
  console.log('Public host passed: unprivileged migration/runtime, RLS, seed cap, posting/retry, fixed-target cleanup, token invalidation, non-sandbox refusal and inaccessible canary');
} finally {
  delete process.env.SANDBOX_MAX_TENANTS;
  await server?.close();
  await Promise.all([owner?.end({ timeout: 5 }), runtime?.sql.end({ timeout: 5 }), cleanup?.end({ timeout: 5 }), canary?.end({ timeout: 5 })]);
  for (const database of created.reverse()) await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
  if (owner) {
    for (const name of ['runtime', 'cleanup', 'owner']) await admin.unsafe(`DROP ROLE borecount_demo_${name}`);
  }
  await admin.end({ timeout: 5 });
}
