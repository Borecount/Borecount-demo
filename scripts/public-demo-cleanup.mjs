// Scheduled cleanup: one bounded run, no HTTP listener, no owner/production credential.
import postgres from 'postgres';
import { safeDatabaseFailure } from './safe-db-error.mjs';
let target;
try {
  target = new URL(process.env.DATABASE_URL);
  if (target.pathname !== '/luxledger_demo_hosted' || target.username !== 'borecount_demo_cleanup' || target.hostname.includes('-pooler')) throw new Error();
  if (!['localhost', '127.0.0.1'].includes(target.hostname) && target.searchParams.get('sslmode') !== 'verify-full') throw new Error();
} catch {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_failed', code: 'CONFIGURATION_INVALID', category: 'configuration' }));
  process.exit(1);
}
const sql = postgres(target.href, { max: 1, connect_timeout: 5 });
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_timeout', code: 'DEADLINE_EXCEEDED', category: 'timeout' }));
  process.exit(1);
}, 45_000);
deadline.unref();
try {
  const [result] = await sql`select demo_ops.cleanup_due() as reset`;
  const [state] = await sql`select demo_ops.public_status() as status`;
  if (!state?.status) throw Object.assign(new Error(), { code: 'MISSING_MARKER' });
  if (Date.parse(state.status.next_reset_at) < Date.now() - 900_000) throw Object.assign(new Error(), { code: 'CLEANUP_OVERDUE' });
  console.log(JSON.stringify({ event: result.reset ? 'sandbox_database_reset' : 'sandbox_cleanup_checked', at: new Date().toISOString() }));
} catch (error) {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_failed', ...safeDatabaseFailure(error), at: new Date().toISOString() }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
  clearTimeout(deadline);
}
