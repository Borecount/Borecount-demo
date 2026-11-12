import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { generateApiKey } from '@borecount/core/application';
// Run against the dedicated integration API started by demo-api.test.mjs.
export async function testSandbox(apiUrl, databaseUrl = process.env.DATABASE_URL_TEST ?? 'postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_demo_test') {
  assert.equal(new URL(databaseUrl).pathname, '/luxledger_demo_test');
  let cookie = '', token = '';
  const journal = [];
  const call = async (method, path, body, expected) => {
    const response = await fetch(apiUrl + path, { method,
      headers: { ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' && path === '/demo/session' ? { origin: apiUrl, 'sec-fetch-site': 'same-origin' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    journal.push({ method, path, status: response.status });
    return { body: result, status: response.status };
  };
  await call('GET', '/demo/session', undefined, 401);
  const csrf = await fetch(apiUrl + '/demo/session', { method: 'POST', headers: { origin: 'https://external.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(csrf.status, 403);
  const missingOrigin = await fetch(apiUrl + '/demo/session', { method: 'POST' });
  assert.equal(missingOrigin.status, 403);
  const first = (await call('POST', '/demo/session', undefined, 201)).body;
  assert.ok(first.access_token); token = first.access_token;
  const firstCookie = cookie, firstToken = token;
  // A late session-table failure must roll back provisioning and all opening data.
  const provisioningSql = postgres(databaseUrl, { max: 1 });
  try {
    const counts = () => provisioningSql`select
      (select count(*) from tenants) as tenants,
      (select count(*) from api_keys) as keys,
      (select count(*) from assets) as assets,
      (select count(*) from ledgers) as ledgers,
      (select count(*) from accounts) as accounts,
      (select count(*) from transactions) as transactions,
      (select count(*) from demo_sessions) as sessions`;
    const before = await counts();
    await provisioningSql.unsafe(`create function reject_test_session() returns trigger language plpgsql as $$
      begin raise exception 'Injected session insert failure'; end;
    $$`);
    await provisioningSql.unsafe('create trigger reject_test_session before insert on demo_sessions for each row execute function reject_test_session()');
    await call('POST', '/demo/session', undefined, 500);
    assert.deepEqual(await counts(), before, 'Failed sandbox must leave no partial tenant or opening data');
    assert.equal(cookie, firstCookie);
    assert.equal((await call('GET', '/demo/session', undefined, 200)).body.tenant_id, first.tenant_id);
    await call('GET', '/v1/ledgers', undefined, 200);
  } finally {
    await provisioningSql.unsafe('drop trigger if exists reject_test_session on demo_sessions');
    await provisioningSql.unsafe('drop function if exists reject_test_session()');
    await provisioningSql.end({ timeout: 5 });
  }

  const ledgers = (await call('GET', '/v1/ledgers?limit=1', undefined, 200)).body;
  assert.equal(ledgers.data.length, 1); assert.ok(ledgers.next_cursor);
  const secondPage = (await call('GET', '/v1/ledgers?limit=1&cursor=' + encodeURIComponent(ledgers.next_cursor), undefined, 200)).body;
  assert.equal(secondPage.data.length, 1);
  const eurLedger = [...ledgers.data, ...secondPage.data].find(item => item.name === 'EUR product ledger');
  assert.ok(eurLedger);
  const eurAccounts = (await call('GET', `/v1/accounts?ledger_id=${eurLedger.id}`, undefined, 200)).body.data;
  assert.equal(eurAccounts.find(account => account.code === 'DEMO_PRIMARY')?.name, 'wallet:eva');
  assert.equal(eurAccounts.find(account => account.code === 'DEMO_SECONDARY')?.name, 'wallet:leo');
  assert.equal(eurAccounts.find(account => account.code === 'DEMO_PRIMARY')?.balance_minor, '-17500');
  const ledger = [...ledgers.data, ...secondPage.data].find(item => item.name === 'USD product ledger');
  assert.ok(ledger);
  const accounts = (await call('GET', `/v1/accounts?ledger_id=${ledger.id}`, undefined, 200)).body.data;
  const id = name => accounts.find(a => a.name === name).id;
  const currency = accounts[0].currency;
  const entries = (amount, from = 'wallet:alice', to = 'wallet:bob') => [
    { account_id: id(from), signed_amount_minor: amount, currency }, { account_id: id(to), signed_amount_minor: '-' + amount, currency },
  ];
  const tx = (reference, amount = '2500') => ({ ledger_id: ledger.id, reference, currency, metadata: { provider: { order: '1042' } }, entries: entries(amount) });
  const createdAccount = (await call('POST', '/v1/accounts', {
    ledger_id: ledger.id, name: 'wallet:charlie', side: 'CREDIT',
    overdraft_policy: 'DISALLOW', currency,
  }, 201)).body;
  assert.equal(createdAccount.name, 'wallet:charlie');
  const fundingTransaction = (await call('POST', '/v1/transactions', {
    ledger_id: ledger.id, reference: 'sandbox-fund-charlie', currency,
    metadata: { provider: { order: '1042' } },
    entries: [
      { account_id: id('system:funding'), signed_amount_minor: '750', currency },
      { account_id: createdAccount.id, signed_amount_minor: '-750', currency },
    ],
  }, 201)).body;
  const charlieBalance = (await call('GET',
    `/v1/accounts/${createdAccount.id}/balance-as-of?at=${encodeURIComponent(new Date().toISOString())}`,
    undefined, 200)).body;
  assert.equal(charlieBalance.account_id, createdAccount.id);
  assert.equal(charlieBalance.posted_minor, '-750');
  const fundedTransaction = (await call('GET', `/v1/transactions/${fundingTransaction.transaction_id}`, undefined, 200)).body;
  assert.deepEqual(fundedTransaction.metadata, { provider: { order: '1042' } });
  const fundingEntries = (await call('GET', `/v1/entries?where=${encodeURIComponent(JSON.stringify({ transaction_id: { eq: fundingTransaction.transaction_id } }))}`, undefined, 200)).body.data;
  assert.equal(fundingEntries.length, 2);
  assert.equal(fundingEntries.reduce((sum, item) => sum + BigInt(item.signed_amount_minor), 0n), 0n);
  const created = await call('POST', '/v1/transactions', tx('sandbox-payment'), 201);
  const retry = await call('POST', '/v1/transactions', tx('sandbox-payment'), 200);
  assert.equal(retry.body.created, false); assert.equal(retry.body.transaction_id, created.body.transaction_id);
  await call('POST', '/v1/transactions', tx('sandbox-payment', '2600'), 400);
  const hold = (await call('POST', '/v1/holds', { ledger_id: ledger.id, reference: 'sandbox-auth', currency, entries: entries('2500') }, 201)).body;
  const partial = (await call('POST', `/v1/holds/${hold.hold_id}/commit`, { reference: 'sandbox-capture', amount_minor: '1000' }, 201)).body;
  assert.equal(partial.remaining_amount_minor, '1500');
  await call('POST', `/v1/holds/${hold.hold_id}/void`, undefined, 200);
  const holdSummary = (await call('GET', `/v1/holds/${hold.hold_id}`, undefined, 200)).body;
  assert.equal(holdSummary.state, 'VOIDED');
  assert.equal(holdSummary.original_amount_minor, '2500');
  assert.equal(holdSummary.remaining_amount_minor, '0');
  const holdEntries = (await call('GET', `/v1/holds/${hold.hold_id}/entries`, undefined, 200)).body.data;
  assert.equal(holdEntries.length, 2);
  assert.equal(holdEntries.reduce((sum, item) => sum + BigInt(item.signed_amount_minor), 0n), 0n);
  const captures = (await call('GET', `/v1/holds/${hold.hold_id}/captures`, undefined, 200)).body.data;
  assert.equal(captures.length, 1);
  assert.equal(captures[0].amount_minor, '1000');
  assert.deepEqual((await call('GET', `/v1/holds/${hold.hold_id}/credit-allocations`, undefined, 200)).body.data, []);
  await call('GET', '/v1/holds/00000000-0000-4000-8000-000000000499/entries', undefined, 404);
  const holdWhere = encodeURIComponent(JSON.stringify({ ledger_id: { eq: ledger.id } }));
  const holds = (await call('GET', `/v1/holds?where=${holdWhere}`, undefined, 200)).body;
  assert.equal(holds.data[0].state, 'VOIDED');
  assert.equal(typeof holds.data[0].created_at, 'string');
  assert.equal(holds.data[0].original_amount_minor, '2500');
  assert.deepEqual(
    (await call('GET', `/v1/holds?where=${encodeURIComponent(JSON.stringify({ ledger_id: { eq: eurLedger.id } }))}`, undefined, 200)).body.data,
    [],
  );
  const invalid = tx('bulk-bad'); invalid.entries[1].signed_amount_minor = '-2499';
  await call('POST', '/v1/transactions/bulk', { transactions: [tx('bulk-rollback-first', '100'), invalid] }, 400);
  const rolledBack = (await call('GET', '/v1/transactions?where=' + encodeURIComponent(JSON.stringify({ reference: { eq: 'bulk-rollback-first' } })), undefined, 200)).body;
  assert.equal(rolledBack.data.length, 0);
  await call('POST', '/v1/transactions/bulk', { transactions: [tx('bulk-good-first', '100'), tx('bulk-good-second', '100')] }, 201);
  await call('POST', `/v1/transactions/${created.body.transaction_id}/reverse`, { reference: 'sandbox-reversal' }, 201);
  const correctionSource = (await call('POST', '/v1/transactions', tx('correction-source', '100'), 201)).body;
  const corrected = (await call('POST', `/v1/transactions/${correctionSource.transaction_id}/correct`, { reversal_reference: 'correction-reverse', corrected_reference: 'correction-new', entries: entries('200') }, 201)).body;
  assert.ok(corrected.corrected_transaction_id);
  const grantBody = { ledger_id: ledger.id, account_id: id('credits:alice'), funding_account_id: id('system:funding'), reference: 'sandbox-grant', amount_minor: '5000', expires_at: new Date(Date.now() + 3000).toISOString() };
  const grant = (await call('POST', '/v1/credit-grants', grantBody, 201)).body;
  assert.ok(grant.id);
  await call('POST', '/v1/credit-grants', grantBody, 200);
  const consumption = (await call('POST', '/v1/transactions', { ...tx('credit-consume'), entries: entries('1200', 'credits:alice', 'service:usage') }, 201)).body;
  const reserved = (await call('POST', '/v1/holds', { ledger_id: ledger.id, reference: 'credit-auth', currency, entries: entries('1000', 'credits:alice', 'service:usage') }, 201)).body;
  const holdAllocations = (await call('GET', `/v1/holds/${reserved.hold_id}/credit-allocations`, undefined, 200)).body.data;
  assert.ok(holdAllocations.length > 0);
  assert.equal(holdAllocations[0].grant_id, grant.id);
  assert.equal(holdAllocations.reduce((sum, item) => sum + BigInt(item.amount_minor), 0n), 1000n);
  await call('POST', `/v1/credit-grants/${grant.id}/refund`, { reference: 'grant-over-refund', amount_minor: '3000' }, 409);
  await call('POST', `/v1/credit-grants/${grant.id}/refund`, { reference: 'grant-refund', amount_minor: '500' }, 201);
  await call('POST', `/v1/credit-grants/${grant.id}/reversal`, { reference: 'grant-bad-reversal' }, 409);
  const lineage = (await call('GET', `/v1/transactions/${consumption.transaction_id}/credit-allocations?limit=1`, undefined, 200)).body;
  assert.equal(lineage.data[0].kind, 'CONSUMPTION');
  const future = new Date(Date.now() + 86400000).toISOString();
  await call('POST', '/v1/credit-grants/expiration/preview', { as_of: future, limit: 25 }, 200);
  await call('POST', '/v1/credit-grants/expiration/run', { as_of: future, limit: 25 }, 400);
  await new Promise(resolve => setTimeout(resolve, 3100));
  const as_of = new Date().toISOString();
  const preview = (await call('POST', '/v1/credit-grants/expiration/preview', { as_of, limit: 25 }, 200)).body;
  assert.ok(preview.items.length);
  await call('POST', '/v1/credit-grants/expiration/run', { as_of, limit: 25 }, 200);
  await call('POST', `/v1/holds/${reserved.hold_id}/void`, undefined, 200);
  const firstHoldPage = (await call('GET', `/v1/holds?where=${holdWhere}&limit=1`, undefined, 200)).body;
  assert.equal(firstHoldPage.data.length, 1);
  assert.ok(firstHoldPage.next_cursor);
  assert.doesNotMatch(firstHoldPage.next_cursor, /^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  const nextHoldPage = (await call('GET', `/v1/holds?where=${holdWhere}&limit=1&cursor=${encodeURIComponent(firstHoldPage.next_cursor)}`, undefined, 200)).body;
  assert.equal(nextHoldPage.data.length, 1);
  assert.notEqual(firstHoldPage.data[0].id, nextHoldPage.data[0].id);
  await call('POST', '/v1/credit-grants/expiration/run', { as_of, limit: 25 }, 200);
  const creditBalance = (await call('GET', `/v1/accounts/${id('credits:alice')}/credit-balance`, undefined, 200)).body;
  assert.equal(creditBalance.remaining_minor, '0');
  const historyQuery = new URLSearchParams({ from: new Date(0).toISOString(), as_of: new Date(Date.now() + 3 * 86400000).toISOString(), limit: '1' });
  let statement = (await call('GET', `/v1/accounts/${id('wallet:alice')}/statement?${historyQuery}`, undefined, 200)).body;
  let availableDelta = 0n, statementPages = 0;
  const opening = BigInt(statement.opening.available_minor), closing = BigInt(statement.closing.available_minor);
  for (;;) {
    statementPages++; for (const movement of statement.data) availableDelta += BigInt(movement.available_delta_minor);
    if (!statement.next_cursor) break;
    historyQuery.set('cursor', statement.next_cursor);
    statement = (await call('GET', `/v1/accounts/${id('wallet:alice')}/statement?${historyQuery}`, undefined, 200)).body;
  }
  assert.ok(statementPages > 1); assert.equal(opening + availableDelta, closing);
  await call('GET', `/v1/accounts/${id('credits:alice')}/credit-statement?from=1970-01-01T00:00:00.000Z&as_of=${encodeURIComponent(new Date(Date.now()+3*86400000).toISOString())}`, undefined, 200);
  const adjustment = { ledger_id: ledger.id, account_id: id('wallet:alice'), offset_account_id: id('system:funding'), reference: 'adjust-credit', amount_minor: '100', description: 'Correction', actor_id: first.actor_id, reason_code: 'PROVIDER_DIFFERENCE' };
  const adjustmentSql = postgres(databaseUrl, { max: 1 });
  try {
    assert.ok(first.actor_id);
    for (const direction of ['credit', 'debit']) {
      await call('POST', `/v1/adjustments/${direction}`, { ...adjustment, reference: `forged-${direction}`, actor_id: 'someone-else' }, 403);
      await call('POST', `/v1/adjustments/${direction}`, { ...adjustment, reference: `adjust-${direction}` }, 201);
    }
    // An ordinary SERVICE key has no sandbox exception, even in a sandbox tenant.
    for (const role of ['SERVICE', 'ADMIN']) {
      const rawKey = generateApiKey();
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const [key] = await adjustmentSql`insert into api_keys (tenant_id, name, role, key_hash)
        values (${first.tenant_id}, ${`Review ${role}`}, ${role}, ${keyHash}) returning id`;
      const auth = await fetch(apiUrl + '/v1/auth/token', { method: 'POST', headers: { 'x-api-key': rawKey } });
      assert.equal(auth.status, 200);
      token = (await auth.json()).access_token;
      for (const direction of ['credit', 'debit']) {
        await call('POST', `/v1/adjustments/${direction}`, { ...adjustment, reference: `${role}-forged-${direction}`, actor_id: 'someone-else' }, 403);
        await call('POST', `/v1/adjustments/${direction}`, { ...adjustment, reference: `${role}-${direction}`, actor_id: key.id }, role === 'ADMIN' ? 201 : 403);
      }
    }
    const [rejected] = await adjustmentSql`select count(*)::int as count from transactions
      where reference like 'forged-%' or reference like '%-forged-%' or reference in ('SERVICE-credit', 'SERVICE-debit')`;
    assert.equal(rejected.count, 0, 'Denied adjustments must not post transactions');
  } finally {
    token = firstToken;
    await adjustmentSql.end({ timeout: 5 });
  }
  const rule = (await call('POST', '/v1/reconciliation/matching-rules', { name: 'Reference amount', criteria: [{ field: 'reference', operator: 'equals' }, { field: 'amount', operator: 'equals' }, { field: 'currency', operator: 'equals' }] }, 201)).body;
  const upload = (await call('POST', '/v1/reconciliation/external-records', { source: 'sandbox-bank', records: [{ id: 'bank-opening', reference: `sandbox-${currency}-opening`, currency, amount_minor: '10000', date: new Date().toISOString() }, { id: 'bank-missing', reference: 'missing', currency, amount_minor: '99', date: new Date().toISOString() }] }, 201)).body;
  const uploadsPage = (await call('GET', `/v1/reconciliation/uploads?limit=1&where=${encodeURIComponent(JSON.stringify({ source: { eq: 'sandbox-bank' } }))}`, undefined, 200)).body;
  assert.equal(uploadsPage.data.length, 1); assert.equal(uploadsPage.data[0].upload_id, upload.upload_id);
  const run = (await call('POST', '/v1/reconciliation/runs', { ledger_id: ledger.id, upload_id: upload.upload_id, matching_rule_ids: [rule.id], strategy: 'one_to_one', dry_run: false }, 201)).body;
  assert.equal(run.matched_count, 1); assert.equal(run.unmatched_external_count, 1);
  const runFilter = encodeURIComponent(JSON.stringify({ ledger_id: { eq: ledger.id }, upload_id: { eq: upload.upload_id }, status: { eq: 'completed' } }));
  const runsPage = (await call('GET', `/v1/reconciliation/runs?limit=1&where=${runFilter}`, undefined, 200)).body;
  assert.equal(runsPage.data.length, 1); assert.equal(runsPage.data[0].id, run.id); assert.equal('results' in runsPage.data[0], false);
  await call('GET', `/v1/reconciliation/runs/${run.id}/results?where=${encodeURIComponent(JSON.stringify({ status: { eq: 'matched' } }))}`, undefined, 200);
  const resultsQuery = `/v1/reconciliation/runs/${run.id}/results?limit=1`;
  const resultPage = (await call('GET', resultsQuery, undefined, 200)).body;
  assert.equal(resultPage.data.length, 1); assert.ok(resultPage.next_cursor);
  const resultNextPage = (await call('GET', `${resultsQuery}&cursor=${encodeURIComponent(resultPage.next_cursor)}`, undefined, 200)).body;
  assert.equal(resultNextPage.data.length, 1);
  assert.ok(resultNextPage.next_cursor === null || typeof resultNextPage.next_cursor === 'string');
  const dryRun = (await call('POST', '/v1/reconciliation/runs', { ledger_id: ledger.id, upload_id: upload.upload_id, matching_rule_ids: [rule.id], strategy: 'one_to_one', dry_run: true }, 200)).body;
  const persistedDryRun = (await call('GET', `/v1/reconciliation/runs?where=${encodeURIComponent(JSON.stringify({ id: { eq: dryRun.id } }))}`, undefined, 200)).body;
  assert.equal(persistedDryRun.data.length, 0);
  await call('GET', '/v1/admin/api-keys', undefined, 403);
  await call('GET', '/v1/accounts?where=' + encodeURIComponent('{"metadata":{"eq":"x"}}'), undefined, 400);
  // A second browser has its own tenant and cannot read or mutate the first browser's resources.
  cookie = ''; token = '';
  const second = (await call('POST', '/demo/session', undefined, 201)).body;
  const secondCookie = cookie;
  token = second.access_token; assert.notEqual(second.tenant_id, first.tenant_id);
  await call('GET', `/v1/accounts/${id('wallet:alice')}`, undefined, 404);
  await call('POST', `/v1/holds/${hold.hold_id}/void`, undefined, 404);
  assert.equal((await call('GET', `/v1/holds?where=${holdWhere}`, undefined, 200)).body.data.length, 0);
  assert.equal((await call('GET', '/v1/reconciliation/uploads', undefined, 200)).body.data.length, 0);
  assert.equal((await call('GET', '/v1/reconciliation/runs', undefined, 200)).body.data.length, 0);
  cookie = firstCookie; token = firstToken;
  const reset = (await call('POST', '/demo/session', undefined, 201)).body;
  assert.notEqual(reset.tenant_id, first.tenant_id);
  await call('GET', '/v1/ledgers', undefined, 401); // old bearer has been revoked
  token = reset.access_token;
  await call('GET', '/v1/ledgers', undefined, 200);
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`update demo_sessions set expires_at = now() - interval '1 second' where tenant_id = ${reset.tenant_id}`;
    await call('GET', '/demo/session', undefined, 401);
    await call('GET', '/v1/ledgers', undefined, 401);
    cookie = secondCookie; token = second.access_token;
    await call('GET', '/v1/ledgers', undefined, 200);
  } finally { await sql.end({ timeout: 5 }); }
  const docs = await fetch(apiUrl + '/docs?demo=1');
  assert.ok((await docs.text()).includes('/docs/swagger-ui-bundle.js'));
  assert.equal((await fetch(apiUrl + '/docs/swagger-ui-bundle.js')).status, 200);
  assert.ok((await (await fetch(apiUrl + '/demo/contract')).json()).paths['/v1/credit-grants']);
  console.log(`Sandbox API passed: ${journal.length} real requests, isolation, retries, rollback, holds, credits, statements and reconciliation`);
}
if (process.argv[1]?.endsWith('/sandbox-api.test.mjs')) await testSandbox('http://127.0.0.1:3100');
