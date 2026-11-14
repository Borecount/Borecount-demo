// Render Cron Job: one bounded run, no HTTP listener, no owner/production credential.
import postgres from 'postgres';
let target;
try {
  target = new URL(process.env.DATABASE_URL);
  if (target.pathname !== '/luxledger_demo_hosted' || target.username !== 'borecount_demo_cleanup' || target.hostname.includes('-pooler')) throw new Error();
  if (!['localhost', '127.0.0.1'].includes(target.hostname) && target.searchParams.get('sslmode') !== 'verify-full') throw new Error();
} catch {
  process.stderr.write('Cleanup requires the dedicated demo role and direct verified-TLS connection\n');
  process.exit(1);
}
const sql = postgres(target.href, { max: 1, connect_timeout: 5 });
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_timeout' }));
  process.exit(1);
}, 45_000);
deadline.unref();
try {
  const [result] = await sql`select demo_ops.cleanup_due() as reset`;
  const [state] = await sql`select demo_ops.public_status() as status`;
  if (!state?.status || Date.parse(state.status.next_reset_at) < Date.now() - 900_000) throw new Error();
  console.log(JSON.stringify({ event: result.reset ? 'sandbox_database_reset' : 'sandbox_cleanup_checked', at: new Date().toISOString() }));
} catch {
  console.error(JSON.stringify({ event: 'sandbox_cleanup_failed', at: new Date().toISOString() }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
  clearTimeout(deadline);
}
