import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { RepositoryError, UnauthorizedError } from '@borecount/core/errors';
const options = { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)) };
const [{ createServerCore, registerApplication, canonicalOpenApi }, { registerLibrary }, { HostProtection },
  { FixedWindowLimiter }, { parseRateLimitConfig }, { issueAccessToken }, { parseTrustedProxies }] = await Promise.all([
  tsImport('../../apps/api/src/api/server.ts', options),
  tsImport('../../apps/api/src/demo/library.ts', options),
  tsImport('../../apps/api/src/api/resource-protection/host-protection.ts', options),
  tsImport('../../apps/api/src/api/rate-limit/fixed-window-limiter.ts', options),
  tsImport('../../apps/api/src/api/rate-limit/policy.ts', options),
  tsImport('../../apps/api/src/api/auth/jwt.ts', options),
  tsImport('../../apps/api/src/api/resource-protection/trusted-proxies.ts', options),
]);
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const KEY = '00000000-0000-4000-8000-000000000003';
const LEDGER = '00000000-0000-4000-8000-000000000004';
const jwtAuth = { signingKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY', previousSigningKeys: [], issuer: 'test', accessTokenTtlSeconds: 900, clockSkewSeconds: 0 };
const token = tenantId => issueAccessToken({ tenantId, apiKeyId: KEY, role: 'SERVICE' }, jwtAuth);
const headers = tenantId => ({ host: 'demo.test', origin: 'http://demo.test', authorization: `Bearer ${token(tenantId)}`, cookie: tenantId });
const limited = response => {
  assert.equal(response.statusCode, 429, response.body);
  assert.equal(response.json().error, 'RATE_LIMIT_EXCEEDED');
  assert.equal(Number(response.headers['retry-after']), response.json().retry_after_seconds);
  assert.ok(response.json().retry_after_seconds >= 1);
};
async function host(overrides = {}, settings = {}) {
  let now = 0;
  let revoked = false;
  let writes = 0;
  let reads = 0;
  const config = { ...parseRateLimitConfig({}), ...overrides };
  const protection = new HostProtection(config, undefined, () => now);
  const services = new Proxy({
    apiKeys: {
      authenticate: async key => {
        if (key !== 'valid-key') throw new UnauthorizedError();
        return { tenantId: A, apiKeyId: KEY, role: 'SERVICE' };
      },
      assertAccessTokenIsActive: async () => { if (revoked) throw new UnauthorizedError(); },
    },
    ledgers: {
      create: async ({ name, tenantId }) => { writes++; return { id: LEDGER, tenantId, name, createdAt: new Date(), updatedAt: new Date() }; },
      list: async () => { reads++; return { data: [], nextCursor: null }; },
    },
    balances: { getTrialBalance: settings.report ?? (async ({ ledgerId }) => ({ ledgerId, accounts: [], totalDebitsMinor: 0n, totalCreditsMinor: 0n })) },
  }, { get: (target, key) => target[key] ?? {} });
  const server = createServerCore({ limits: config, logger: settings.logger ?? false, trustedProxies: settings.trustedProxies, readinessCheck: settings.readinessCheck ?? (async () => {}) });
  registerApplication(server, { services, jwtAuth: { ...jwtAuth, ...settings.authConfig }, protection, authorizeAdjustment: false });
  registerLibrary(server, services, async request => {
    if (revoked || ![A, B].includes(request.headers.cookie)) throw new UnauthorizedError();
    return { tenant_id: request.headers.cookie, api_key_id: KEY };
  }, { protection }, canonicalOpenApi);
  settings.setup?.(server);
  await server.ready();
  return {
    server, protection, services, config,
    advance: ms => { now += ms; }, revoke: () => { revoked = true; }, counts: () => ({ writes, reads }),
    rest: (tenant = A, method = 'GET', payload, extra = {}) => server.inject({ method, url: '/v1/ledgers', headers: headers(tenant), ...(payload ? { payload } : {}), ...extra }),
    library: (tenant = A, operation = 'ledgers.list', input = {}, extra = {}) => server.inject({ method: 'POST', url: '/demo/library/execute', headers: headers(tenant), payload: { operation, input }, ...extra }),
    close: () => server.close(),
  };
}

test('bounded buckets retain active quotas, reclaim expired keys, and recover exactly at the window', () => {
  const limiter = new FixedWindowLimiter(2);
  const policy = { maxRequests: 2, windowSeconds: 2 };
  assert.equal(limiter.consume('a', policy, 0).allowed, true);
  assert.equal(limiter.consume('a', policy, 0).allowed, true);
  assert.deepEqual(limiter.consume('a', policy, 1), { allowed: false, retryAfterSeconds: 2 });
  limiter.consume('b', policy, 0);
  for (let i = 0; i < 1000; i++) assert.equal(limiter.consume(`attack-${i}`, policy, 10).allowed, false);
  assert.equal(limiter.size, 2);
  assert.equal(limiter.consume('a', policy, 1999).allowed, false);
  assert.equal(limiter.consume('a', policy, 2000).allowed, true);
  assert.equal(limiter.consume('new', policy, 2000).allowed, false);
  assert.equal(limiter.consume('new', policy, 4000).allowed, true);
  assert.equal(limiter.size, 1);
  assert.equal(limiter.consume('x'.repeat(257), policy, 4000).allowed, false);
});

test('configuration rejects unsafe sizes, windows, capacities and proxy trust', () => {
  for (const env of [{ RATE_LIMIT_READ_WINDOW_SECONDS: '86401' }, { REQUEST_BULK_MAX_ITEMS: '101' }, { RATE_LIMIT_MAX_KEYS: '0' }, { REQUEST_BODY_MAX_BYTES: 'Infinity' }, { REPORT_CONCURRENCY_MAX: '1' }]) {
    assert.throws(() => parseRateLimitConfig(env));
  }
  for (const value of ['true', '*', '2', '0.0.0.0/0', '::/0', '10.0.0.1/33', '127.0.0.1/8/1']) assert.throws(() => parseTrustedProxies(value));
  assert.deepEqual(parseTrustedProxies(undefined), []);
  assert.deepEqual(parseTrustedProxies('127.0.0.1,::1/128'), ['127.0.0.1', '::1/128']);
});

test('REST and Library share tenant reads/writes; one noisy tenant does not spend another tenant budget', async t => {
  const h = await host({ read: { maxRequests: 2, windowSeconds: 2 }, write: { maxRequests: 1, windowSeconds: 2 } });
  t.after(h.close);
  assert.equal((await h.rest()).statusCode, 200);
  assert.equal((await h.library()).statusCode, 200);
  limited(await h.rest(A, 'GET', undefined, { headers: { ...headers(A), 'x-tenant-id': B } }));
  assert.equal((await h.rest(B)).statusCode, 200);
  assert.equal((await h.library(B)).statusCode, 200);
  assert.equal((await h.rest(A, 'POST', { name: 'one' })).statusCode, 201);
  limited(await h.library(A, 'ledgers.create', { name: 'two' }, { remoteAddress: '192.0.2.2' }));
  assert.equal((await h.library(B, 'ledgers.create', { name: 'neighbor' })).statusCode, 200);
  assert.deepEqual(h.counts(), { writes: 2, reads: 4 });
  h.advance(2000);
  assert.equal((await h.library()).statusCode, 200);
  assert.equal((await h.library(A, 'ledgers.create', { name: 'recovered' })).statusCode, 200);
});

test('authentication precedes tenant accounting, including rejected credentials and revoked sessions', async t => {
  const h = await host({ read: { maxRequests: 1, windowSeconds: 60 } });
  t.after(h.close);
  for (const extra of [{ headers: { 'x-tenant-id': A } }, { headers: { authorization: 'Bearer invalid', 'x-tenant-id': A } }]) {
    assert.equal((await h.rest(A, 'GET', undefined, extra)).statusCode, 401);
  }
  assert.equal((await h.library(A, 'ledgers.list', {}, { headers: { host: 'demo.test', origin: 'http://demo.test', cookie: 'invalid', 'x-tenant-id': A } })).statusCode, 401);
  assert.equal((await h.rest()).statusCode, 200);
  h.revoke();
  assert.equal((await h.rest()).statusCode, 401);
  assert.equal((await h.library()).statusCode, 401);
});

test('pre-auth abuse and token attempts are bounded, recover, and cannot select tenant buckets', async t => {
  const h = await host({ authToken: { maxRequests: 1, windowSeconds: 2 }, abuse: { maxRequests: 4, windowSeconds: 2 } });
  t.after(h.close);
  const issue = key => h.server.inject({ method: 'POST', url: '/v1/auth/token', headers: { 'x-api-key': key } });
  assert.equal((await issue('invalid')).statusCode, 401);
  limited(await issue('valid-key'));
  assert.equal((await h.rest()).statusCode, 200);
  assert.equal((await h.library()).statusCode, 200);
  limited(await h.rest());
  h.advance(2000);
  assert.equal((await issue('valid-key')).statusCode, 200);
});

test('concurrent mixed-mode writes admit exactly the tenant allowance', async t => {
  const h = await host({ write: { maxRequests: 3, windowSeconds: 2 } });
  t.after(h.close);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? h.library(A, 'ledgers.create', { name: 'parallel' }) : h.rest(A, 'POST', { name: 'parallel' })));
  assert.equal(responses.filter(r => r.statusCode < 300).length, 3);
  responses.filter(r => r.statusCode >= 300).forEach(limited);
  assert.equal(h.counts().writes, 3);
});

test('REST and Library share report permits; global/tenant caps reject without a queue and recover after failure', { timeout: 5000 }, async t => {
  let release;
  let entered;
  let pending = new Promise(resolve => { entered = resolve; });
  let fail = false;
  const h = await host({ reportConcurrency: 2, tenantReportConcurrency: 1 }, { report: async ({ ledgerId }) => {
    entered();
    await new Promise(resolve => { release = resolve; });
    if (fail) throw new RepositoryError();
    return { ledgerId, accounts: [], totalDebitsMinor: 0n, totalCreditsMinor: 0n };
  } });
  t.after(() => { release?.(); return h.close(); });
  const restReport = () => h.server.inject({ url: `/v1/ledgers/${LEDGER}/trial-balance`, headers: headers(A) });
  const first = restReport();
  first.then(() => {});
  await pending;
  limited(await h.library(A, 'balances.getTrialBalance', { ledgerId: LEDGER }));
  // A second tenant can still acquire the remaining global permit.
  const heldByB = h.protection.acquireReport(B);
  assert.throws(() => h.protection.acquireReport('third'), /Rate limit/);
  heldByB(); heldByB();
  release();
  assert.equal((await first).statusCode, 200);
  pending = new Promise(resolve => { entered = resolve; });
  fail = true;
  const failed = h.library(A, 'balances.getTrialBalance', { ledgerId: LEDGER });
  failed.then(() => {});
  await pending;
  limited(await restReport());
  release();
  assert.equal((await failed).statusCode, 500);
  const releaseAfterFailure = h.protection.acquireReport(A);
  releaseAfterFailure();
});

test('request bytes and lower host bulk cap reject both surfaces before executing work', async t => {
  const h = await host({ bodyBytes: 512, bulkItems: 1 });
  t.after(h.close);
  for (const response of [await h.rest(A, 'POST', { name: 'x'.repeat(600) }), await h.library(A, 'ledgers.create', { name: 'x'.repeat(600) })]) {
    assert.equal(response.statusCode, 413, response.body);
    assert.equal(response.json().error, 'PAYLOAD_TOO_LARGE');
  }
  const transactions = [{}, {}];
  assert.equal((await h.server.inject({ method: 'POST', url: '/v1/transactions/bulk', headers: headers(A), payload: { transactions } })).statusCode, 400);
  assert.equal((await h.library(A, 'transactions.createBulk', { transactions })).statusCode, 400);
  assert.deepEqual(h.counts(), { reads: 0, writes: 0 });
});

test('forwarded IPs only affect abuse buckets for explicitly trusted peers', async t => {
  for (const trusted of [false, true]) {
    const h = await host({ abuse: { maxRequests: 1, windowSeconds: 60 } }, { trustedProxies: trusted ? ['127.0.0.1'] : [] });
    t.after(h.close);
    const read = ip => h.rest(A, 'GET', undefined, { remoteAddress: '127.0.0.1', headers: { ...headers(A), 'x-forwarded-for': ip } });
    assert.equal((await read('192.0.2.1')).statusCode, 200);
    const second = await read('192.0.2.2');
    if (trusted) assert.equal(second.statusCode, 200); else limited(second);
    limited(await h.rest(A, 'GET', undefined, { remoteAddress: '198.51.100.10', headers: { ...headers(A), 'x-forwarded-for': '192.0.2.10' } }).then(async first => {
      assert.equal(first.statusCode, 200);
      return h.rest(A, 'GET', undefined, { remoteAddress: '198.51.100.10', headers: { ...headers(A), 'x-forwarded-for': '192.0.2.11' } });
    }));
  }
});

test('captured host logs and error responses hide canaries and correlate coded 5xx with bounded request IDs', async t => {
  const canary = 'PRIVACY_CANARY_TOKEN_SQL_DETAIL_URL';
  const previousKey = 'Z'.repeat(43);
  const logs = [];
  const h = await host({}, {
    logger: { stream: { write: line => logs.push(JSON.parse(line)) } },
    authConfig: { previousSigningKeys: [previousKey] },
    setup: server => {
      server.get('/audit/coded', async () => { throw Object.assign(new Error(canary), { code: canary, httpStatus: 500, details: { sql: canary } }); });
      server.get('/audit/cookie', async (_request, reply) => reply.header('set-cookie', `secret=${canary}`).send({ ok: true }));
    },
    readinessCheck: async () => { throw Object.assign(new Error(`postgres://user:${canary}@db/query`), { detail: canary, query: `select '${canary}'`, cause: new Error(canary) }); },
  });
  t.after(h.close);
  // Real host authentication executes before a failed adapter service call.
  h.services.ledgers.list = async () => { throw Object.assign(new Error(canary), { code: canary, detail: canary }); };
  const rest = await h.rest(A, 'GET', undefined, { url: '/v1/ledgers', headers: { ...headers(A), 'x-api-key': canary, 'x-request-id': `invalid ${canary}${'x'.repeat(100)}` } });
  assert.equal(rest.statusCode, 500);
  assert.ok(!rest.body.includes(canary));
  assert.match(rest.headers['x-request-id'], /^[A-Za-z0-9_-]{1,64}$/);
  const library = await h.library(A, 'ledgers.list', {}, { headers: { ...headers(A), 'x-api-key': canary, 'x-request-id': 'safe-request-id' } });
  assert.equal(library.statusCode, 500);
  assert.equal(library.headers['x-request-id'], 'safe-request-id');
  assert.ok(!library.body.includes(canary));
  const ready = await h.server.inject({ url: `/ready?secret=${canary}`, headers: { cookie: canary, 'x-request-id': canary + ' '.repeat(10) } });
  assert.equal(ready.statusCode, 503);
  assert.ok(!ready.body.includes(canary));
  const invalid = await h.rest(A, 'POST', { name: canary, forbidden: canary });
  assert.equal(invalid.statusCode, 400);
  assert.ok(!invalid.body.includes(canary));
  const unauth = await h.rest(A, 'GET', undefined, { headers: { authorization: `Bearer ${canary}`, cookie: canary } });
  assert.equal(unauth.statusCode, 401);
  assert.ok(!unauth.body.includes(canary));
  const coded = await h.server.inject({ url: '/audit/coded' });
  assert.equal(coded.statusCode, 500);
  assert.ok(!coded.body.includes(canary));
  await h.server.inject({ url: '/audit/cookie' });
  const missing = await h.server.inject({ url: `/missing/${canary}?secret=${canary}` });
  assert.equal(missing.statusCode, 404);
  assert.ok(!missing.body.includes(canary));
  const malformed = await h.rest(A, 'POST', undefined, { headers: { ...headers(A), 'content-type': 'application/json' }, payload: `{"name":"${canary}` });
  assert.equal(malformed.statusCode, 400);
  assert.ok(!malformed.body.includes(canary));
  const previousToken = issueAccessToken({ tenantId: A, apiKeyId: KEY, role: 'SERVICE' }, { ...jwtAuth, signingKey: previousKey });
  const previous = await h.server.inject({ url: `/v1/missing/${canary}`, headers: { authorization: `Bearer ${previousToken}` } });
  assert.equal(previous.statusCode, 404);
  assert.ok(logs.some(line => line.msg === 'JWT verified with previous signing key' && line.route === '/unmatched'));
  assert.ok(!JSON.stringify(logs).includes(previousToken));
  assert.ok(!JSON.stringify(logs).includes(token(A)));
  assert.ok(!JSON.stringify(logs).includes(canary));
  for (const response of [rest, library, ready, coded]) {
    const failure = logs.find(line => line.level === 50 && line.requestId === response.headers['x-request-id']);
    assert.ok(failure, 'Each 5xx has a safe correlated error event');
    assert.ok(failure.route);
  }
});
