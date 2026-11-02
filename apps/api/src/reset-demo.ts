import { createApplicationServices, createDbClient } from '@borecount/postgres-adapter';
import { DemoService } from './demo/demo-service';
import { isMainModule } from './utils/is-main-module';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const assertDedicatedDemoDatabase = (): void => {
  if (process.env.DEMO_ALLOW_RESET !== 'true') {
    throw new Error('DEMO_ALLOW_RESET=true is required');
  }
  const databaseUrl = new URL(requireEnv('DATABASE_URL'));
  const databaseName = databaseUrl.pathname.replace(/^\/+/, '');
  if (databaseName !== 'luxledger_demo_hosted') {
    throw new Error('Hosted reset is restricted to the luxledger_demo_hosted database');
  }
};

export const run = async (): Promise<void> => {
  assertDedicatedDemoDatabase();
  const dbClient = createDbClient();
  const demo = new DemoService(dbClient, createApplicationServices(dbClient), {
    adminApiKey: requireEnv('BOOTSTRAP_ADMIN_API_KEY'),
    adminKeyName: process.env.BOOTSTRAP_ADMIN_KEY_NAME ?? 'Hosted demo admin',
    tenantName: process.env.BOOTSTRAP_TENANT_NAME ?? 'Demo tenant',
    resetEnabled: false,
  });

  try {
    const state = await demo.reset();
    console.log(
      JSON.stringify({
        reset: true,
        ledgerId: state.ledger_id,
        accounts: state.accounts.map((account) => account.address),
      }),
    );
  } finally {
    try {
      await dbClient.sql.end({ timeout: 5 });
    } catch (error) {
      console.error('Failed to close DB connection:', error);
      process.exitCode = 1;
    }
  }
};

if (isMainModule(import.meta.url)) {
  await run();
}
