// Scheduled cleanup: one bounded run, no HTTP listener, no owner/production credential.
import { cleanupConnection, validateCleanupUrl } from './public-cleanup-db.mjs';
import { resetDeadline } from './public-demo-scheduler-core.mjs';
import { safeDatabaseFailure } from './safe-db-error.mjs';
let db;
try { db = cleanupConnection(validateCleanupUrl(process.env.DATABASE_URL)); }
catch {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_failed', code: 'CONFIGURATION_INVALID', category: 'configuration' }));
  process.exit(1);
}
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_timeout', code: 'DEADLINE_EXCEEDED', category: 'timeout' }));
  process.exit(1);
}, 45_000);
deadline.unref();
try {
  resetDeadline(await db.status());
  const reset = await db.cleanup();
  if (resetDeadline(await db.status()) < Date.now() - 900_000) throw Object.assign(new Error(), { code: 'CLEANUP_OVERDUE' });
  console.log(JSON.stringify({ event: reset ? 'sandbox_database_reset' : 'sandbox_cleanup_checked', at: new Date().toISOString() }));
} catch (error) {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_failed', ...safeDatabaseFailure(error), at: new Date().toISOString() }));
  process.exitCode = 1;
} finally {
  await db.close();
  clearTimeout(deadline);
}
