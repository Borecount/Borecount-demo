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

export const run = async (): Promise<void> => {
  const dbClient = createDbClient();
  const demo = new DemoService(dbClient, createApplicationServices(dbClient), {
    adminApiKey: requireEnv('BOOTSTRAP_ADMIN_API_KEY'),
    adminKeyName: process.env.BOOTSTRAP_ADMIN_KEY_NAME ?? 'Initial admin key',
    tenantName: process.env.BOOTSTRAP_TENANT_NAME ?? 'Demo tenant',
    resetEnabled: false,
  });

  try {
    const state = await demo.seed();
    console.log(
      JSON.stringify({
        seeded: true,
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
