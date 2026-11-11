import assert from 'node:assert/strict';
import postgres from 'postgres';
// The parent runner loads this file under tsx so the exact browser registry is exercised.
import { toLibraryCall, toRestRequest, libraryCode } from '../../shared/library.ts';
export async function testLibrary(apiUrl, databaseUrl) {
  assert.equal(new URL(databaseUrl).pathname, '/luxledger_demo_test');
  let cookie = '', token = '';
  async function send(path, body, expected = 200, extra = {}) {
    const response = await fetch(apiUrl + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
    return result;
  }
  async function start() {
    const response = await fetch(apiUrl + '/demo/session', { method: 'POST', headers: { cookie } });
    assert.equal(response.status, 201);
    cookie = response.headers.get('set-cookie').split(';')[0];
    const session = await response.json(); token = session.access_token; return session;
  }
  const run = async (method, path, body, expected = 200) => send('/demo/library/execute', toLibraryCall({ method, path, ...(body ? { body } : {}) }), expected);
  await send('/demo/library/execute', { operation: 'ledgers.list', input: {} }, 401);
  const session = await start();
  await send('/demo/library/execute', { operation: 'ledgers.list', input: {} }, 403, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  await send('/demo/library/execute', { operation: 'apiKeys.list', input: {} }, 400);
  await send('/demo/library/execute', { operation: 'ledgers.list', input: { tenantId: session.tenant_id } }, 400);
  await send('/demo/library/execute', { operation: 'ledgers.list', input: { actorId: session.actor_id } }, 400);
  await send('/demo/library/execute', { operation: 'ledgers.list', input: { limit: 201 } }, 400);
  await send('/demo/library/execute', { operation: 'ledgers.list', input: { where: { unknown: { eq: 1 } } } }, 400);
  for (const where of [{ balanceMinor: { eq: 'not-an-integer' } }, { createdAt: { gte: 'not-a-date' } }]) {
    const error = await send('/demo/library/execute', { operation: 'accounts.list', input: { where } }, 400);
    assert.equal(error.error, 'INVALID_INPUT');
  }
  const oversized = await send('/demo/library/execute', { operation: 'ledgers.create', input: { name: 'x'.repeat(1024 * 1024) } }, 413);
  assert.equal(oversized.error, 'PAYLOAD_TOO_LARGE');
  const first = await run('GET', '/v1/ledgers?limit=1');
  assert.equal(first.result.data.length, 1); assert.ok(first.result.next_cursor);
  const second = await run('GET', '/v1/ledgers?limit=1&cursor=' + encodeURIComponent(first.result.next_cursor));
  const ledger = [...first.result.data, ...second.result.data].find(row => row.name.startsWith('USD'));
  const accounts = (await run('GET', '/v1/accounts?ledger_id=' + ledger.id)).result.data;
  const id = code => accounts.find(account => account.code === 'DEMO_' + code).id;
  const entries = amount => [{ account_id: id('PRIMARY'), signed_amount_minor: amount, currency: 'USD' }, { account_id: id('SECONDARY'), signed_amount_minor: '-' + amount, currency: 'USD' }];
  const tx = { ledger_id: ledger.id, reference: 'library-cross-mode', currency: 'USD', entries: entries('2500'), metadata: { amountMinor: 'opaque', effective_at: 'untouched', nested: { tenantId: 'metadata' } } };
  const rest = await fetch(apiUrl + '/v1/transactions', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(tx) });
  assert.equal(rest.status, 201); const posted = await rest.json();
  const retry = await run('POST', '/v1/transactions', tx);
  assert.equal(retry.value.created, false); assert.equal(retry.value.transactionId, posted.transaction_id);
  assert.equal(retry.call.input.tenantId, session.tenant_id);
  const inspected = (await run('GET', '/v1/transactions/' + posted.transaction_id)).result;
  assert.deepEqual(inspected.metadata, tx.metadata);
  const entryPage = await run('GET', '/v1/entries?where=' + encodeURIComponent(JSON.stringify({ transaction_id: { eq: posted.transaction_id } })));
  assert.equal(entryPage.result.data.length, 2);
  assert.ok(entryPage.call.input.where.transactionId);
  await run('POST', '/v1/transactions', { ...tx, entries: entries('2600') }, 400);
  await run('POST', '/v1/transactions', { ...tx, reference: 'too-much', entries: entries('999999') }, 409);
  await run('POST', '/v1/transactions/bulk', { transactions: Array(101).fill(tx) }, 400);
  const hold = await run('POST', '/v1/holds', { ledger_id: ledger.id, reference: 'library-hold', currency: 'USD', entries: entries('1000') });
  await run('POST', `/v1/holds/${hold.result.hold_id}/commit`, { reference: 'library-capture', amount_minor: '400' });
  await run('GET', `/v1/holds/${hold.result.hold_id}/captures`);
  await run('GET', `/v1/holds/${hold.result.hold_id}/entries`);
  await run('GET', `/v1/holds/${hold.result.hold_id}/credit-allocations`);
  await run('POST', `/v1/holds/${hold.result.hold_id}/void`);
  const grant = await run('POST', '/v1/credit-grants', { ledger_id: ledger.id, account_id: id('CREDITS'), funding_account_id: id('FUNDING'), reference: 'library-grant', amount_minor: '5000' });
  await run('GET', `/v1/accounts/${id('CREDITS')}/credit-balance`);
  await run('GET', `/v1/accounts/${id('CREDITS')}/credit-lots`);
  await run('GET', `/v1/credit-grants/${grant.result.id}/allocations`);
  await run('POST', `/v1/credit-grants/${grant.result.id}/refund`, { reference: 'library-refund', amount_minor: '100' });
  await run('POST', '/v1/credit-grants/expiration/preview', { as_of: new Date().toISOString(), limit: 10 });
  const adjusted = await run('POST', '/v1/adjustments/credit', { ledger_id: ledger.id, account_id: id('PRIMARY'), offset_account_id: id('FUNDING'), reference: 'library-adjustment', amount_minor: '100', description: 'Support credit', reason_code: 'SUPPORT', actor_id: session.actor_id });
  assert.equal(adjusted.call.input.actorId, session.actor_id);
  const rule = await run('POST', '/v1/reconciliation/matching-rules', { name: 'Library exact', criteria: [{ field: 'reference', operator: 'equals' }] });
  const upload = await run('POST', '/v1/reconciliation/external-records', { source: 'library-bank', records: [{ id: 'record-1', amount_minor: '2500', currency: 'USD', reference: tx.reference, date: new Date().toISOString(), raw: { amountMinor: 'opaque' } }] });
  const recon = await run('POST', '/v1/reconciliation/runs', { ledger_id: ledger.id, upload_id: upload.result.upload_id, matching_rule_ids: [rule.result.id], strategy: 'one_to_one', dry_run: false });
  await run('GET', `/v1/reconciliation/runs/${recon.result.id}/results`);
  await run('GET', `/v1/reconciliation/uploads/${upload.result.upload_id}/records`);
  const now = new Date().toISOString(), from = new Date(Date.now() - 86400000).toISOString();
  for (const path of [`/v1/accounts/${id('PRIMARY')}/balance-as-of?at=${now}`, `/v1/accounts/${id('PRIMARY')}/balance-history?from=${from}&to=${now}`, `/v1/accounts/${id('PRIMARY')}/statement?from=${from}&as_of=${now}`, `/v1/accounts/${id('CREDITS')}/credit-statement?from=${from}&as_of=${now}`, `/v1/ledgers/${ledger.id}/trial-balance`]) await run('GET', path);
  const sample = toLibraryCall({ method: 'POST', path: '/v1/transactions', body: tx });
  assert.deepEqual(toRestRequest(sample).body, tx);
  assert.match(libraryCode(sample, session.tenant_id), /2500n/);
  assert.match(libraryCode(sample, session.tenant_id), /"amountMinor": "opaque"/);
  const previousCookie = cookie;
  const replacement = await start();
  await run('GET', '/v1/accounts/' + id('PRIMARY'), undefined, 404);
  const liveCookie = cookie; cookie = previousCookie;
  await run('GET', '/v1/ledgers', undefined, 401);
  cookie = liveCookie;
  const sql = postgres(databaseUrl, { max: 1 });
  try { await sql`update demo_sessions set expires_at = now() - interval '1 second' where tenant_id = ${replacement.tenant_id}`; } finally { await sql.end(); }
  await run('GET', '/v1/ledgers', undefined, 401);
  console.log('Library integration passed: direct execution, all areas, cross-mode retries, filters, authority, isolation, expiry');
}
