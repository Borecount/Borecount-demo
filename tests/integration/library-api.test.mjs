import assert from 'node:assert/strict';
import postgres from 'postgres';
// The parent runner loads this file under tsx so the exact browser registry is exercised.
import { toLibraryCall, toRestRequest, libraryCode } from '../../shared/library.ts';

export async function testLibrary(apiUrl, databaseUrl) {
  assert.equal(new URL(databaseUrl).pathname, '/luxledger_demo_test');

  let cookie = '';
  let token = '';

  async function send(path, body, expected = 200, extra = {}) {
    const response = await fetch(apiUrl + path, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
    return result;
  }

  async function start() {
    const response = await fetch(apiUrl + '/demo/session', {
      method: 'POST',
      headers: { cookie },
    });

    assert.equal(response.status, 201);
    cookie = response.headers.get('set-cookie').split(';')[0];

    const session = await response.json();
    token = session.access_token;
    return session;
  }

  const run = async (method, path, body, expected = 200) => {
    const operation = {
      method,
      path,
      ...(body ? { body } : {}),
    };
    return send('/demo/library/execute', toLibraryCall(operation), expected);
  };

  // Check authentication, origin, operation allowlisting, and input validation.
  await send('/demo/library/execute', { operation: 'ledgers.list', input: {} }, 401);
  const session = await start();
  await send('/demo/library/execute', { operation: 'ledgers.list', input: {} }, 403, {
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site',
  });
  await send('/demo/library/execute', { operation: 'apiKeys.list', input: {} }, 400);
  await send(
    '/demo/library/execute',
    { operation: 'ledgers.list', input: { tenantId: session.tenant_id } },
    400,
  );
  await send(
    '/demo/library/execute',
    { operation: 'ledgers.list', input: { actorId: session.actor_id } },
    400,
  );
  await send('/demo/library/execute', { operation: 'ledgers.list', input: { limit: 201 } }, 400);
  await send(
    '/demo/library/execute',
    { operation: 'ledgers.list', input: { where: { unknown: { eq: 1 } } } },
    400,
  );

  for (const where of [
    { balanceMinor: { eq: 'not-an-integer' } },
    { createdAt: { gte: 'not-a-date' } },
  ]) {
    const error = await send(
      '/demo/library/execute',
      { operation: 'accounts.list', input: { where } },
      400,
    );
    assert.equal(error.error, 'INVALID_INPUT');
  }

  const oversizedName = 'x'.repeat(1024 * 1024);
  const oversizedResponse = await send(
    '/demo/library/execute',
    { operation: 'ledgers.create', input: { name: oversizedName } },
    413,
  );
  assert.equal(oversizedResponse.error, 'PAYLOAD_TOO_LARGE');

  // List the seeded ledgers across pages, then locate the USD demo accounts.
  const firstLedgerPage = await run('GET', '/v1/ledgers?limit=1');
  assert.equal(firstLedgerPage.result.data.length, 1);
  assert.ok(firstLedgerPage.result.next_cursor);

  const secondLedgerPage = await run(
    'GET',
    '/v1/ledgers?limit=1&cursor=' + encodeURIComponent(firstLedgerPage.result.next_cursor),
  );
  const ledger = [...firstLedgerPage.result.data, ...secondLedgerPage.result.data].find((row) =>
    row.name.startsWith('USD'),
  );
  const accountPage = await run('GET', '/v1/accounts?ledger_id=' + ledger.id);
  const accounts = accountPage.result.data;
  const accountId = (code) => accounts.find((account) => account.code === 'DEMO_' + code).id;
  const entriesFor = (amount) => [
    {
      account_id: accountId('PRIMARY'),
      signed_amount_minor: amount,
      currency: 'USD',
    },
    {
      account_id: accountId('SECONDARY'),
      signed_amount_minor: '-' + amount,
      currency: 'USD',
    },
  ];
  const transaction = {
    ledger_id: ledger.id,
    reference: 'library-cross-mode',
    currency: 'USD',
    entries: entriesFor('2500'),
    metadata: {
      amountMinor: 'opaque',
      effective_at: 'untouched',
      nested: { tenantId: 'metadata' },
    },
  };

  // Post through REST, then verify Library sees the same idempotent transaction.
  const restResponse = await fetch(apiUrl + '/v1/transactions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(transaction),
  });
  assert.equal(restResponse.status, 201);
  const postedTransaction = await restResponse.json();

  const retry = await run('POST', '/v1/transactions', transaction);
  assert.equal(retry.value.created, false);
  assert.equal(retry.value.transactionId, postedTransaction.transaction_id);
  assert.equal(retry.call.input.tenantId, session.tenant_id);

  const inspectedTransaction = await run(
    'GET',
    '/v1/transactions/' + postedTransaction.transaction_id,
  );
  assert.deepEqual(inspectedTransaction.result.metadata, transaction.metadata);

  const entryFilter = encodeURIComponent(
    JSON.stringify({ transaction_id: { eq: postedTransaction.transaction_id } }),
  );
  const entryPage = await run('GET', '/v1/entries?where=' + entryFilter);
  assert.equal(entryPage.result.data.length, 2);
  assert.ok(entryPage.call.input.where.transactionId);

  // Preserve duplicate-payload, insufficient-funds, and batch-size failures.
  await run('POST', '/v1/transactions', { ...transaction, entries: entriesFor('2600') }, 400);
  await run(
    'POST',
    '/v1/transactions',
    {
      ...transaction,
      reference: 'too-much',
      entries: entriesFor('999999'),
    },
    409,
  );
  await run('POST', '/v1/transactions/bulk', { transactions: Array(101).fill(transaction) }, 400);

  // Exercise hold creation, partial capture, reads, and release.
  const hold = await run('POST', '/v1/holds', {
    ledger_id: ledger.id,
    reference: 'library-hold',
    currency: 'USD',
    entries: entriesFor('1000'),
  });
  await run('POST', `/v1/holds/${hold.result.hold_id}/commit`, {
    reference: 'library-capture',
    amount_minor: '400',
  });
  await run('GET', `/v1/holds/${hold.result.hold_id}/captures`);
  await run('GET', `/v1/holds/${hold.result.hold_id}/entries`);
  await run('GET', `/v1/holds/${hold.result.hold_id}/credit-allocations`);
  await run('POST', `/v1/holds/${hold.result.hold_id}/void`);

  // Exercise credit grant reads, allocation/refund paths, and expiration preview.
  const grant = await run('POST', '/v1/credit-grants', {
    ledger_id: ledger.id,
    account_id: accountId('CREDITS'),
    funding_account_id: accountId('FUNDING'),
    reference: 'library-grant',
    amount_minor: '5000',
  });
  await run('GET', `/v1/accounts/${accountId('CREDITS')}/credit-balance`);
  await run('GET', `/v1/accounts/${accountId('CREDITS')}/credit-lots`);
  await run('GET', `/v1/credit-grants/${grant.result.id}/allocations`);
  await run('POST', `/v1/credit-grants/${grant.result.id}/refund`, {
    reference: 'library-refund',
    amount_minor: '100',
  });
  await run('POST', '/v1/credit-grants/expiration/preview', {
    as_of: new Date().toISOString(),
    limit: 10,
  });

  // Verify adjustment actor identity is sourced from the sandbox session.
  const adjustment = await run('POST', '/v1/adjustments/credit', {
    ledger_id: ledger.id,
    account_id: accountId('PRIMARY'),
    offset_account_id: accountId('FUNDING'),
    reference: 'library-adjustment',
    amount_minor: '100',
    description: 'Support credit',
    reason_code: 'SUPPORT',
    actor_id: session.actor_id,
  });
  assert.equal(adjustment.call.input.actorId, session.actor_id);

  // Create, run, and inspect a reconciliation report and its upload records.
  const rule = await run('POST', '/v1/reconciliation/matching-rules', {
    name: 'Library exact',
    criteria: [{ field: 'reference', operator: 'equals' }],
  });
  const upload = await run('POST', '/v1/reconciliation/external-records', {
    source: 'library-bank',
    records: [
      {
        id: 'record-1',
        amount_minor: '2500',
        currency: 'USD',
        reference: transaction.reference,
        date: new Date().toISOString(),
        raw: { amountMinor: 'opaque' },
      },
    ],
  });
  const reconciliation = await run('POST', '/v1/reconciliation/runs', {
    ledger_id: ledger.id,
    upload_id: upload.result.upload_id,
    matching_rule_ids: [rule.result.id],
    strategy: 'one_to_one',
    dry_run: false,
  });
  await run('GET', `/v1/reconciliation/runs/${reconciliation.result.id}/results`);
  await run('GET', `/v1/reconciliation/uploads/${upload.result.upload_id}/records`);

  // Cover reporting methods with one fixed, bounded time range.
  const now = new Date().toISOString();
  const from = new Date(Date.now() - 86400000).toISOString();
  const primaryAccountId = accountId('PRIMARY');
  const reportPaths = [
    `/v1/accounts/${primaryAccountId}/balance-as-of?at=${now}`,
    `/v1/accounts/${primaryAccountId}/balance-history?from=${from}&to=${now}`,
    `/v1/accounts/${primaryAccountId}/statement?from=${from}&as_of=${now}`,
    `/v1/accounts/${accountId('CREDITS')}/credit-statement?from=${from}&as_of=${now}`,
    `/v1/ledgers/${ledger.id}/trial-balance`,
  ];
  for (const path of reportPaths) await run('GET', path);

  // Round-trip a REST request through the Library call and generated example.
  const sampleCall = toLibraryCall({
    method: 'POST',
    path: '/v1/transactions',
    body: transaction,
  });
  assert.deepEqual(toRestRequest(sampleCall).body, transaction);
  assert.match(libraryCode(sampleCall, session.tenant_id), /2500n/);
  assert.match(libraryCode(sampleCall, session.tenant_id), /"amountMinor": "opaque"/);

  // Replacing the sandbox revokes its former credential; expiry also blocks it.
  const previousCookie = cookie;
  const replacementSession = await start();
  await run('GET', '/v1/accounts/' + accountId('PRIMARY'), undefined, 404);

  const liveCookie = cookie;
  cookie = previousCookie;
  await run('GET', '/v1/ledgers', undefined, 401);
  cookie = liveCookie;

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      update demo_sessions
      set expires_at = now() - interval '1 second'
      where tenant_id = ${replacementSession.tenant_id}
    `;
  } finally {
    await sql.end();
  }
  await run('GET', '/v1/ledgers', undefined, 401);

  console.log(
    'Library integration passed: direct execution, all areas, cross-mode retries, filters, authority, isolation, expiry',
  );
}
