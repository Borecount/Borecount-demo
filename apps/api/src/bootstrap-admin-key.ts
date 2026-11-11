import { createDbClient, createTenantProvisioningService } from '@borecount/postgres-adapter';
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
  const provisioning = createTenantProvisioningService(dbClient);

  try {
    const result = await provisioning.bootstrapInitialAdmin({
      tenantName: requireEnv('BOOTSTRAP_TENANT_NAME'),
      keyName: process.env.BOOTSTRAP_ADMIN_KEY_NAME ?? 'Initial admin key',
      rawApiKey: requireEnv('BOOTSTRAP_ADMIN_API_KEY'),
    });

    if (!result || !result.created) {
      console.log('Bootstrap skipped: api_keys already contains records');
      return;
    }

    console.log(
      JSON.stringify(
        {
          created: true,
          tenantId: result.tenantId,
          apiKeyId: result.key.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await dbClient.sql.end({ timeout: 5 });
  }
};

if (isMainModule(import.meta.url)) {
  await run();
}
