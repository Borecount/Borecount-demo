import { expect, test, type Page } from '@playwright/test';

const journal = (page: Page) => page.getByRole('region', { name: 'Request journal' });
const sections = (page: Page) => page.getByRole('navigation', { name: 'Workspace sections' });
const modes = (page: Page) => page.getByRole('group', { name: 'Integration mode' });

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('100.00 USD');
}
async function library(page: Page) {
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/demo/library/execute',
  );
  await modes(page).getByRole('button', { name: 'Library', exact: true }).click();
  await refreshed;
  await expect(modes(page).getByRole('button', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}
async function run(page: Page) {
  await page.getByRole('button', { name: 'Run library call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run library call', exact: true })).toBeEnabled();
}

test('one switch covers all sections and preserves cross-mode posting identity', async ({
  page,
}) => {
  await ready(page);
  const ledgerId = await page.getByLabel('Ledger', { exact: true }).inputValue();
  await sections(page).getByRole('button', { name: 'Transactions', exact: true }).click();
  const reference = await page.getByLabel('Transfer reference').inputValue();
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByText('✓ Debits and credits balance', { exact: true })).toBeVisible();
  await library(page);
  const restCalls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/v1/')) restCalls.push(request.url());
  });
  await expect(page.getByLabel('Ledger', { exact: true })).toHaveValue(ledgerId);
  await expect(page.getByLabel('Transfer reference')).toHaveValue(reference);
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(journal(page)).toContainText('"created": false');
  await expect(journal(page)).toContainText('"transactionId"');
  await expect(journal(page).getByTestId('library-preview')).toContainText('2500n');
  await expect(journal(page).getByTestId('library-preview')).toContainText(
    'createApplicationServices',
  );
  await expect(journal(page).getByTestId('curl-preview')).toHaveCount(0);
  await journal(page).getByRole('button', { name: 'Copy TypeScript' }).click();
  await expect(journal(page).getByRole('button', { name: 'Copied' })).toBeVisible();

  for (const name of [
    'Accounts',
    'Transactions',
    'Holds',
    'Credits',
    'Reconciliation',
    'Reports',
  ]) {
    await sections(page).getByRole('button', { name, exact: true }).click();
    const readers = page.locator('.read-panel');
    for (const reader of await readers.all()) {
      const load = reader.getByRole('button', { name: /^Load / });
      if (await load.count()) {
        await load.click();
        await expect(reader.locator('.result-summary')).toBeVisible();
      }
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await sections(page).getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(page.getByTestId('account-wallet:alice')).toContainText('75.00 USD');
  await expect(page.getByTestId('account-wallet:bob')).toContainText('25.00 USD');
  expect(restCalls).toEqual([]);
  await expect(page.getByRole('group', { name: 'Integration mode' })).toHaveCount(1);
  await modes(page).getByRole('button', { name: 'REST API', exact: true }).click();
  await expect(page.getByLabel('Ledger', { exact: true })).toHaveValue(ledgerId);
  await expect(page.getByTestId('account-wallet:bob')).toContainText('25.00 USD');
});

for (const scenario of [
  'Wallet',
  'Marketplace',
  'Authorization & capture',
  'Prepaid credits',
  'Finance',
]) {
  test(`Library executes the complete ${scenario} guide`, async ({ page }) => {
    await ready(page);
    await library(page);
    await page
      .locator('.scenario-card')
      .filter({ has: page.getByRole('heading', { name: scenario, exact: true }) })
      .click();
    const next = page.getByRole('button', { name: 'Next step →', exact: true });
    for (;;) {
      await run(page);
      if (scenario === 'Wallet' && (await next.isDisabled())) {
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(journal(page)).toContainText('Library error');
      } else {
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(journal(page)).toContainText('Returned value');
      }
      if (await next.isDisabled()) break;
      await next.click();
    }
  });
}

test('Library arguments and CSV import use camelCase and preserve arbitrary provider fields', async ({
  page,
}) => {
  await ready(page);
  await library(page);
  await sections(page).getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByRole('button', { name: 'Wallet transfer', exact: true }).click();
  const editor = page.getByLabel('Library arguments', { exact: true });
  const input = JSON.parse(await editor.inputValue());
  input.entries[0].signedAmountMinor = '1250';
  input.entries[1].signedAmountMinor = '-1250';
  input.metadata = { provider_field: { amount_minor: 'unchanged', created_at: 'opaque' } };
  await editor.fill(JSON.stringify(input));
  await run(page);
  await expect(journal(page)).toContainText('"signedAmountMinor": "1250"');
  await expect(journal(page)).toContainText('"provider_field"');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await sections(page).getByRole('button', { name: 'Reconciliation', exact: true }).click();
  await page.getByRole('button', { name: 'Upload external records', exact: true }).click();
  await page.getByLabel('Import statement CSV').setInputFiles({
    name: 'provider.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'id,amount_minor,currency,reference,date\nprovider-1,1250,USD,external-order,2026-11-10T00:00:00Z\n',
    ),
  });
  await expect(editor).toHaveValue(/occurredAt/);
  await run(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(journal(page)).toContainText('"recordCount": 1');
});

test('adjustment drafts and Library journal entries replay through REST with actor context', async ({
  page,
}, testInfo) => {
  await ready(page);
  await library(page);
  await sections(page).getByRole('button', { name: 'Reconciliation', exact: true }).click();
  await page.getByRole('button', { name: 'Credit adjustment', exact: true }).click();
  const args = JSON.parse(await page.getByLabel('Library arguments', { exact: true }).inputValue());
  await modes(page).getByRole('button', { name: 'REST API', exact: true }).click();
  const draft = JSON.parse(await page.getByLabel('Request JSON').inputValue());
  expect(draft.actor_id).toBeTruthy();
  expect(draft.reference).toBe(args.reference);
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send request', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await library(page);
  await run(page);
  await expect(journal(page)).toContainText('"created": false');
  await modes(page).getByRole('button', { name: 'REST API', exact: true }).click();
  await journal(page).getByRole('button', { name: 'Repeat exact request', exact: true }).click();
  await expect(journal(page)).toContainText('"created": false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await library(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('region', { name: 'Integration mode', exact: true })
    .scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('library-mode.png') });
});

test('invalid Library arguments produce a journal error and copying the example stays handled', async ({
  page,
}) => {
  const unhandled: string[] = [];
  page.on('pageerror', (error) => unhandled.push(error.message));
  await ready(page);
  await library(page);
  await sections(page).getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByRole('button', { name: 'Wallet transfer', exact: true }).click();
  const editor = page.getByLabel('Library arguments', { exact: true });
  const input = JSON.parse(await editor.inputValue());
  input.entries[0].signedAmountMinor = 'invalid';
  await editor.fill(JSON.stringify(input));
  await run(page);
  await expect(journal(page)).toContainText('Library error');
  await journal(page).getByRole('button', { name: 'Copy TypeScript', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(unhandled).toEqual([]);
});
