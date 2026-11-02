import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
  },
  webServer: [
    {
      command: 'node scripts/start-test-api.mjs',
      url: 'http://127.0.0.1:3100/ready',
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: 'npm run dev:test -w @borecount/demo-web',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 20_000,
    },
  ],
});
