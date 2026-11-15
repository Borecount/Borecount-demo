import { expect, test } from '@playwright/test';

test('fresh visitor finds test-data notice, free release guides, a posting and manual pilot contact', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('note')).toContainText('Simulated test data only');
  await expect(page.getByTestId('account-wallet:alice')).toContainText('100.00 USD');
  await expect(page.getByRole('link', { name: 'discuss a manually approved pilot' })).toHaveAttribute('href', /^mailto:/);
  await expect(page.getByRole('link', { name: 'API docs ↗' })).toHaveAttribute('href', '/docs?demo=1');
  await page.getByRole('link', { name: 'Guides', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Free evaluation and self-hosting guides' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PUBLIC DEMO', exact: true })).toHaveAttribute('href', 'docs/PUBLIC_DEMO.md');
  const release = await (await page.request.get('/guides/release.json')).json();
  expect(release.packages).toBe('0.8.0');
  expect(release.revision).toMatch(/^[a-f0-9]{40}$/);
  await page.getByRole('link', { name: 'Sandbox & pilot contact' }).click();
  await expect(page.getByTestId('account-wallet:alice')).toContainText('100.00 USD');
  await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button', { name: 'Transactions', exact: false }).click();
  await page.getByRole('button', { name: 'Send transfer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Request journal' })).toContainText('"created": true');
  await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button', { name: 'Accounts', exact: false }).click();
  await expect(page.getByTestId('account-wallet:alice')).toContainText('75.00 USD');
  await expect(page.getByTestId('account-wallet:bob')).toContainText('25.00 USD');
});
