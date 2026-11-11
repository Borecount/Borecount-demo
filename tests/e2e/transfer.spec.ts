import { expect, test } from '@playwright/test';
import { requestToCurl, money, toMinor, redact } from '../../apps/web/src/api';
import { parseStatementCsv } from '../../apps/web/src/csv';
import { entriesAreBalanced, toEntryDisplay } from '../../apps/web/src/ledger-display';

test('money, entries, CSV and credential redaction preserve integration invariants', () => {
  expect(toEntryDisplay('25')).toEqual({ direction: 'DEBIT', magnitudeMinor: '25' });
  expect(toEntryDisplay('-25')).toEqual({ direction: 'CREDIT', magnitudeMinor: '25' });
  expect(toEntryDisplay('0')).toBeNull();
  expect(entriesAreBalanced([{ signed_amount_minor: '25' }, { signed_amount_minor: '-25' }])).toBe(true);
  expect(entriesAreBalanced([{ signed_amount_minor: '25' }])).toBe(false);
  expect(money('900719925474099301', 'TOK', 4)).toBe('90071992547409.9301 TOK');
  expect(toMinor('90071992547409.9301', 4)).toBe('900719925474099301');
  expect(() => toMinor('1.2', 0)).toThrow();
  expect(() => toMinor('0', 2)).toThrow();
  const csv = '\uFEFFid,amount_minor,currency,reference,date,description\r\n1,1250,USD,order-1,2026-01-01T00:00:00Z,"Hello, ""Alice"""\r\n';
  expect(parseStatementCsv(csv)[0]).toMatchObject({ id: '1', amount_minor: '1250', description: 'Hello, "Alice"' });
  expect(() => parseStatementCsv('id,id\n1,2')).toThrow();
  expect(() => parseStatementCsv(csv.replace('1250', '-1'))).toThrow();
  expect(redact({ access_token: 'secret', nested: { api_key: 'secret', reference: 'order' } })).toEqual({ access_token: '[redacted]', nested: { api_key: '[redacted]', reference: 'order' } });
  expect(requestToCurl({ method: 'POST', path: '/v1/accounts', body: { name: "Alice's wallet" } }, 'http://localhost')).toContain(`--data '{"name":"Alice'"'"'s wallet"}'`);
  expect(requestToCurl({ method: 'GET', path: '/v1/accounts' }, 'http://localhost')).toContain('$ACCESS_TOKEN');
});

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('100.00 USD');
}
async function tab(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button', { name, exact: false }).click();
}
async function preset(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
}

test('real transfers expose entries, exact retries and rejected mismatches', async ({ page }) => {
  await ready(page);
  const mutations: string[] = [];
  page.on('request', req => { if (req.method() === 'POST') mutations.push(new URL(req.url()).pathname); });
  await tab(page, 'Transactions');
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByText('✓ Debits and credits balance', { exact: true })).toBeVisible();
  await expect(page.getByTestId('request-body')).toContainText('"signed_amount_minor": "2500"');
  await expect(page.getByTestId('curl-preview')).toContainText('/v1/transactions');
  await expect(page.getByTestId('curl-preview')).toContainText('$ACCESS_TOKEN');
  expect(mutations).toEqual(['/v1/transactions']);
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"created": false');
  await page.getByLabel('Transfer amount').fill('26.00');
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('payload mismatch');
  await tab(page, 'Accounts');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('75.00 USD');
  await expect(page.getByTestId('account-wallet:bob')).toContainText('25.00 USD');
  await page.getByRole('button', { name: 'Copy curl', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('hold guide reserves, partially captures and releases the remainder', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /Authorization & capture.*Reserve/ }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transfer holds' }).locator('.hold-row')).toContainText('HELD');
  await page.getByRole('button', { name: 'Next step →' }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transfer holds' }).locator('.hold-row')).toContainText('remaining 15.00 USD');
  await page.getByRole('button', { name: 'Next step →' }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transfer holds' }).locator('.hold-row')).toContainText('VOIDED');
  await tab(page, 'Accounts');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('90.00 USD');
  await expect(page.getByTestId('available-balance')).toContainText('90.00 USD');
});

test('holds use one public cursor list with state filters that start without a cursor', async ({ page }) => {
  const holdListRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/v1/holds') holdListRequests.push(url.href);
  });

  await ready(page);
  await tab(page, 'Holds');
  const stateFilter = page.getByLabel('Hold state');
  await expect(stateFilter).toHaveValue('');
  await expect(stateFilter.locator('option')).toHaveText([
    'All states',
    'Active (HELD)',
    'Applied (APPLIED)',
    'Voided (VOIDED)',
  ]);
  await expect(page.getByRole('region', { name: 'Transfer holds' })).toHaveCount(1);

  await expect.poll(() => holdListRequests.length).toBeGreaterThan(0);
  await preset(page, 'Reserve payment');
  const rows = page.getByRole('region', { name: 'Transfer holds' }).locator('.hold-row');
  await expect(rows).toHaveCount(1);
  await preset(page, 'Void remaining');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('VOIDED');
  await preset(page, 'Reserve payment');
  await expect(rows).toHaveCount(2);

  const ledgerId = await page.getByLabel('Ledger').inputValue();
  const assertHoldQuery = (urlText: string, state?: string) => {
    const url = new URL(urlText);
    expect(url.pathname).toBe('/v1/holds');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(JSON.parse(url.searchParams.get('where') ?? '{}')).toEqual({
      ledger_id: { eq: ledgerId },
      ...(state === undefined ? {} : { state: { eq: state } }),
    });
  };
  assertHoldQuery(holdListRequests.at(-1)!);

  for (const [value, state, count] of [
    ['HELD', 'HELD', 1],
    ['APPLIED', 'APPLIED', 0],
    ['VOIDED', 'VOIDED', 1],
    ['', undefined, 2],
  ] as const) {
    const responsePromise = page.waitForResponse(response => {
      const request = response.request();
      return request.method() === 'GET' && new URL(response.url()).pathname === '/v1/holds';
    });
    await stateFilter.selectOption(value);
    expect((await responsePromise).status()).toBe(200);
    await expect(rows).toHaveCount(count);
    if (state !== undefined && count > 0) await expect(rows.first()).toContainText(state);
    await expect.poll(() => {
      try {
        const url = new URL(holdListRequests.at(-1)!);
        return JSON.parse(url.searchParams.get('where') ?? '{}').state?.eq ?? '';
      } catch {
        return '';
      }
    }).toBe(state ?? '');
    assertHoldQuery(holdListRequests.at(-1)!, state);
  }
});

test('credits expose grant issuance, consumption, partial refunds and lineage', async ({ page }) => {
  await ready(page); await tab(page, 'Credits');
  await preset(page, 'Issue credit grant');
  await expect(page.getByLabel('Selected grant ID')).not.toHaveValue('');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"amount_minor": "5000"');
  await preset(page, 'Consume credits');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"created": true');
  await preset(page, 'Refund unspent grant');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"amount_minor": "500"');
  await preset(page, 'Grant allocations');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('CONSUMPTION');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('REFUND');
  await page.getByRole('button', { name: 'Load credit balance', exact: true }).click();
  await expect(page.getByText('"remaining_minor": "3300"', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Regression: the last successful preview must not pin every new preview to its old time.
  await page.getByRole('button', { name: 'Preview expiration', exact: true }).click();
  const preview = JSON.parse(await page.getByLabel('Request JSON').inputValue());
  preview.as_of = '2000-01-01T00:00:00.000Z';
  await page.getByLabel('Request JSON').fill(JSON.stringify(preview));
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText(preview.as_of);
  await page.getByRole('button', { name: 'Refresh preview timestamp', exact: true }).click();
  const refreshed = JSON.parse(await page.getByLabel('Request JSON').inputValue());
  expect(Date.parse(refreshed.as_of)).toBeGreaterThan(Date.parse(preview.as_of));
  let refreshedPreviewBody: Record<string, unknown> | undefined;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/credit-grants/expiration/preview') {
      refreshedPreviewBody = request.postDataJSON() as Record<string, unknown>;
    }
  });
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  expect(refreshedPreviewBody?.as_of).toBe(refreshed.as_of);
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText(refreshed.as_of);
  await page.getByRole('button', { name: 'Run expiration', exact: true }).click();
  const run = JSON.parse(await page.getByLabel('Request JSON').inputValue());
  expect(run.as_of).toBe(refreshed.as_of);
});

test('finance imports CSV and restores saved reconciliation after reload', async ({ page }) => {
  await ready(page); await tab(page, 'Reconciliation');
  await preset(page, 'Create matching rule');
  await expect(page.getByLabel('rule ID')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Upload external records', exact: true }).click();
  await page.getByLabel('Import statement CSV').setInputFiles({ name: 'provider.csv', mimeType: 'text/csv', buffer: Buffer.from('id,amount_minor,currency,reference,date\n1,10000,USD,sandbox-USD-opening,2026-10-25T00:00:00Z\n2,999,USD,external-only,2026-10-25T00:00:00Z\n') });
  await expect(page.getByLabel('Request JSON')).toContainText('provider.csv');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByLabel('upload ID')).not.toHaveValue('');
  await preset(page, 'Dry run reconciliation');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"matched_count": 1');
  await preset(page, 'Run reconciliation');
  await expect(page.getByLabel('run ID')).not.toHaveValue('');
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"unmatched_external_count": 1');
  const uploadId = await page.getByLabel('upload ID').inputValue();
  const runId = await page.getByLabel('run ID').inputValue();

  await page.reload();
  await expect(page.getByTestId('account-wallet:alice')).toContainText('100.00 USD');
  await tab(page, 'Reconciliation');
  await expect(page.getByLabel('upload ID')).toHaveValue('');
  await expect(page.getByLabel('run ID')).toHaveValue('');
  for (const [label, id] of [['upload ID', uploadId], ['run ID', runId]] as const) {
    await page.getByRole('row').filter({ hasText: id }).getByRole('button', { name: 'Select' }).click();
    await expect(page.getByLabel(label)).toHaveValue(id);
  }

  await page.getByRole('button', { name: 'Load run report' }).click();
  const report = page.getByRole('region', { name: 'Run report', exact: true });
  await expect(report).toContainText(uploadId);
  for (const field of ['matching_rule_ids', 'matched_count', 'unmatched_external_count', 'unmatched_internal_count', 'mismatched_count', 'conflict_count']) {
    await expect(report).toContainText(field);
  }

  const resultsResponse = page.waitForResponse(response =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/v1/reconciliation/runs/${runId}/results`,
  );
  await page.getByRole('button', { name: 'Load reconciliation results' }).click();
  expect((await resultsResponse).status()).toBe(200);
  await expect(page.getByRole('cell', { name: 'unmatched_external', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('saved reconciliation pages go back, selections invalidate drafts and stale results are cancelled', async ({ page }) => {
  const uploadIds = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'];
  const runIds = ['00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202'];
  let markOldRequested!: () => void, releaseOld!: () => void, markOldFinished!: () => void;
  const oldRequested = new Promise<void>(resolve => { markOldRequested = resolve; });
  const oldBlocked = new Promise<void>(resolve => { releaseOld = resolve; });
  const oldFinished = new Promise<void>(resolve => { markOldFinished = resolve; });
  await page.route('**/v1/reconciliation/uploads?*', async route => {
    const older = new URL(route.request().url()).searchParams.has('cursor');
    await route.fulfill({ json: {
      data: [{ upload_id: uploadIds[older ? 1 : 0], source: older ? 'older-upload' : 'newer-upload', record_count: 2, created_at: '2026-11-01T00:00:00Z' }],
      next_cursor: older ? null : 'older',
    } });
  });
  await page.route('**/v1/reconciliation/runs?*', route => route.fulfill({ json: {
    data: runIds.map(id => ({ id, status: 'completed', matched_count: 1, started_at: '2026-11-01T00:00:00Z' })), next_cursor: null,
  } }));
  await page.route('**/v1/reconciliation/runs/*/results?*', async route => {
    const old = route.request().url().includes(runIds[0]);
    if (old) { markOldRequested(); await oldBlocked; }
    try {
      await route.fulfill({ json: { data: [{ id: old ? 'previous-run-result' : 'current-run-result', status: 'matched' }], next_cursor: null } });
    } catch (error) {
      if (!old) throw error; // The first request may already have been aborted.
    } finally { if (old) markOldFinished(); }
  });
  await ready(page); await tab(page, 'Reconciliation');
  const uploads = page.getByRole('region', { name: 'Saved uploads', exact: true });
  await expect(uploads).toContainText('newer-upload');
  await uploads.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(uploads).toContainText('older-upload');
  await uploads.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(uploads).toContainText('newer-upload');
  await page.getByRole('button', { name: 'Run reconciliation', exact: true }).click();
  await expect(page.getByLabel('Request JSON')).toBeVisible();
  await uploads.getByRole('button', { name: 'Next page', exact: true }).click();
  await uploads.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByLabel('Request JSON')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send request', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run reconciliation', exact: true }).click();
  await expect(page.getByLabel('Request JSON')).toContainText(uploadIds[1]);

  const runs = page.getByRole('region', { name: 'Saved runs', exact: true });
  await runs.getByRole('row').filter({ hasText: runIds[0] }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Load reconciliation results', exact: true }).click();
  await oldRequested;
  await runs.getByRole('row').filter({ hasText: runIds[1] }).getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByLabel('run ID')).toHaveValue(runIds[1]);
  await page.getByRole('button', { name: 'Load reconciliation results', exact: true }).click();
  const results = page.getByRole('region', { name: 'Reconciliation results', exact: true });
  await expect(results).toContainText('current-run-result');
  releaseOld();
  await oldFinished;
  await expect(results).not.toContainText('previous-run-result');
  await expect(results).toContainText('current-run-result');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('API docs link opens authenticated Swagger without a duplicate workspace tab', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button', { name: 'API Reference' })).toHaveCount(0);
  const [docs] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('navigation').first().getByRole('link', { name: 'API docs' }).click(),
  ]);
  await expect(docs).toHaveURL(/\/docs\?demo=1/);
  const operation = docs.locator('.opblock-get').filter({ has: docs.locator('[data-path="/v1/ledgers"]') });
  await operation.locator('.opblock-summary').click();
  await operation.getByRole('button', { name: 'Try it out' }).click();
  await operation.locator('textarea').fill('{}');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(operation.locator('.responses-inner .response-col_status').filter({ hasText: '200' }).first()).toBeVisible();
  await expect(operation).toContainText('USD product ledger');
  await docs.close();
});

test('new sandbox and EUR selection preserve independent balances; mobile fits', async ({ page }) => {
  await ready(page); await tab(page, 'Transactions');
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByText('✓ Debits and credits balance', { exact: true })).toBeVisible();
  await page.getByLabel('Ledger', { exact: true }).selectOption({ label: 'EUR product ledger' });
  await tab(page, 'Accounts');
  await expect(page.getByTestId('account-wallet:eva')).toContainText('175.00 EUR');
  await expect(page.getByTestId('account-wallet:leo')).toContainText('0.00 EUR');
  await tab(page, 'Transactions');
  await expect(page.getByLabel('From')).toHaveValue('wallet:eva');
  await expect(page.getByLabel('To')).toHaveValue('wallet:leo');
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await tab(page, 'Accounts');
  await expect(page.getByTestId('account-wallet:eva')).toContainText('150.00 EUR');
  await expect(page.getByTestId('account-wallet:leo')).toContainText('25.00 EUR');
  await page.getByRole('button', { name: 'New sandbox', exact: true }).click();
  await expect(page.getByLabel('Ledger', { exact: true })).toContainText('USD product ledger');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('100.00 USD');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Explore real ledger flows.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button', { name: 'Overview' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/borecount-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/borecount-overview.png', fullPage: true });
});
