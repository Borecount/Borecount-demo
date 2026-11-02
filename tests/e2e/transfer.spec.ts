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
  await expect(page.getByRole('region', { name: 'Transfer holds' })).toContainText('HELD');
  await page.getByRole('button', { name: 'Next step →' }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transfer holds' })).toContainText('remaining 15.00 USD');
  await page.getByRole('button', { name: 'Next step →' }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transfer holds' })).toContainText('VOIDED');
  await tab(page, 'Accounts');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('90.00 USD');
  await expect(page.getByTestId('available-balance')).toContainText('90.00 USD');
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

test('finance imports CSV, creates rules and reports external differences', async ({ page }) => {
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
