import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { createDbClient, createApplicationServices } from '@borecount/postgres-adapter';
import { toLibraryCall } from '../../shared/library.ts';
const options = { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)) };
const [{ createServerCore, registerApplication, canonicalOpenApi }, { registerSandbox }, { HostProtection }, { parseRateLimitConfig }] = await Promise.all([
  tsImport('../../apps/api/src/api/server.ts', options),
  tsImport('../../apps/api/src/demo/sandbox.ts', options),
  tsImport('../../apps/api/src/api/resource-protection/host-protection.ts', options),
  tsImport('../../apps/api/src/api/rate-limit/policy.ts', options),
]);

/** Uses real auth, session provisioning, adapter routes and PostgreSQL; never resets the database. */
export async function testHostProtection(databaseUrl) {
  const target = new URL(databaseUrl);
  if (target.pathname !== '/luxledger_demo_test') throw new Error('Host test requires the dedicated test database');
  let now = 0;
  const config = { ...parseRateLimitConfig({}), write: { maxRequests: 1, windowSeconds: 2 }, session: { maxRequests: 2, windowSeconds: 2 }, bulkItems: 1 };
  const protection = new HostProtection(config, undefined, () => now);
  const db = createDbClient({ databaseUrl });
  const services = createApplicationServices(db);
  const jwtAuth = { signingKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY', previousSigningKeys: [], issuer: 'host-test', accessTokenTtlSeconds: 900, clockSkewSeconds: 0 };
  const server = createServerCore({ limits: config, logger: false, readinessCheck: async () => { await db.sql`select 1`; } });
  registerApplication(server, { services, jwtAuth, protection, authorizeAdjustment: false });
  registerSandbox(server, db, services, jwtAuth, { protection, specification: canonicalOpenApi });
  const origin = { host: 'demo.test', origin: 'http://demo.test' };
  const start = () => server.inject({ method: 'POST', url: '/demo/session', headers: origin });
  const expect = (response, status) => { assert.equal(response.statusCode, status, response.body); return response.json(); };
  const limited = response => {
    expect(response, 429);
    assert.equal(Number(response.headers['retry-after']), response.json().retry_after_seconds);
  };
  const snapshot = async tenantId => {
    const [count] = await db.sql`select count(*)::int as n from transactions where tenant_id = ${tenantId}`;
    const balances = await db.sql`select id, balance_minor::text, reserved_delta_minor::text from accounts where tenant_id = ${tenantId} order by id`;
    return { count: count.n, balances: [...balances] };
  };
  try {
    const firstResponse = await start();
    const first = expect(firstResponse, 201);
    const cookie = firstResponse.headers['set-cookie'].split(';')[0];
    const second = expect(await start(), 201);
    const [beforeSessions] = await db.sql`select count(*)::int as n from tenants`;
    limited(await start());
    const [afterSessions] = await db.sql`select count(*)::int as n from tenants`;
    assert.equal(afterSessions.n, beforeSessions.n, 'Rejected provisioning performs no work');
    const accounts = await db.sql`select a.id, a.code, a.ledger_id from accounts a join ledgers l on l.id = a.ledger_id where a.tenant_id = ${first.tenant_id} and l.name = 'USD product ledger'`;
    const accountId = code => accounts.find(a => a.code === code).id;
    const ledgerId = accounts[0].ledger_id;
    const transaction = {
      ledger_id: ledgerId, reference: 'host-limits-identical-retry', currency: 'USD',
      entries: [
        { account_id: accountId('DEMO_PRIMARY'), signed_amount_minor: '100', currency: 'USD' },
        { account_id: accountId('DEMO_SECONDARY'), signed_amount_minor: '-100', currency: 'USD' },
      ],
    };
    const rest = (method, path, payload, session = first, extra = {}) => server.inject({ method, url: path,
      headers: { ...origin, authorization: `Bearer ${session.access_token}`, ...extra }, ...(payload ? { payload } : {}) });
    const library = payload => server.inject({ method: 'POST', url: '/demo/library/execute', headers: { ...origin, cookie }, payload });
    const initial = await snapshot(first.tenant_id);
    const posted = expect(await rest('POST', '/v1/transactions', transaction), 201);
    const afterPost = await snapshot(first.tenant_id);
    assert.equal(afterPost.count, initial.count + 1);
    const call = toLibraryCall({ method: 'POST', path: '/v1/transactions', body: transaction });
    limited(await library(call));
    assert.deepEqual(await snapshot(first.tenant_id), afterPost, 'Throttled retry cannot mutate balances/history');
    now += 2000;
    const retry = expect(await library(call), 200);
    assert.equal(retry.value.created, false);
    assert.equal(retry.value.transactionId, posted.transaction_id);
    assert.deepEqual(await snapshot(first.tenant_id), afterPost, 'Recovered cross-mode retry remains identical');
    now += 2000;
    const conflicting = { ...transaction, entries: transaction.entries.map(e => ({ ...e, signed_amount_minor: e.signed_amount_minor.replace('100', '101') })) };
    expect(await rest('POST', '/v1/transactions', conflicting), 400);
    assert.deepEqual(await snapshot(first.tenant_id), afterPost);
    now += 2000;
    const insufficient = { ...transaction, reference: 'host-limits-rollback', entries: transaction.entries.map(e => ({ ...e, signed_amount_minor: e.signed_amount_minor.replace('100', '999999999') })) };
    expect(await library(toLibraryCall({ method: 'POST', path: '/v1/transactions', body: insufficient })), 409);
    assert.deepEqual(await snapshot(first.tenant_id), afterPost, 'Failed posting rolls back completely');
    const bulk = { transactions: [transaction, transaction] };
    expect(await rest('POST', '/v1/transactions/bulk', bulk), 400);
    expect(await library(toLibraryCall({ method: 'POST', path: '/v1/transactions/bulk', body: bulk })), 400);
    assert.deepEqual(await snapshot(first.tenant_id), afterPost);
    // Foreign IDs and headers do not select the resource owner's bucket or grant access.
    expect(await rest('GET', `/v1/ledgers/${ledgerId}`, undefined, second, { 'x-tenant-id': first.tenant_id }), 404);
    expect(await rest('POST', '/v1/ledgers', { name: 'Neighbor remains available' }, second), 201);
    now += 2000;
    const burst = await Promise.all(Array.from({ length: 6 }, (_, index) => {
      const body = { ...transaction, reference: `host-burst-${index}` };
      return index % 2 ? library(toLibraryCall({ method: 'POST', path: '/v1/transactions', body })) : rest('POST', '/v1/transactions', body);
    }));
    assert.equal(burst.filter(response => response.statusCode < 300).length, 1);
    burst.filter(response => response.statusCode >= 300).forEach(limited);
    assert.equal((await snapshot(first.tenant_id)).count, afterPost.count + 1);
    now += 2000;
    expect(await start(), 201);
    await db.sql`update api_keys set revoked_at = now() where id = ${first.actor_id}`;
    expect(await rest('GET', '/v1/ledgers'), 401);
    expect(await library({ operation: 'ledgers.list', input: {} }), 401);
    console.log('Host protection integration passed: limits, window recovery, session quota, retries, rollback, isolation, concurrent mixed modes and revocation');
  } finally {
    await server.close();
    await db.sql.end({ timeout: 5 });
  }
}
