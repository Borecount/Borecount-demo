import { cleanupConnection, validateCleanupUrl } from './public-cleanup-db.mjs';
import { createCleanupScheduler } from './public-demo-scheduler-core.mjs';
import { safeDatabaseFailure } from './safe-db-error.mjs';

try {
  const target = validateCleanupUrl(process.env.DATABASE_URL);
  const scheduler = createCleanupScheduler({ connect: () => cleanupConnection(target) });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    void scheduler.stop().catch(() => { process.exitCode = 1; });
  });
  await scheduler.start();
} catch (error) {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_failed', ...safeDatabaseFailure(error) }));
  process.exitCode = 1;
}
