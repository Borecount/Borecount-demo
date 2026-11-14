// Operator-only release step. Never put the owner credential in the web or cron environment.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  const target = new URL(process.env.DATABASE_URL);
  if (target.pathname !== '/luxledger_demo_hosted' || target.username !== 'borecount_demo_owner' || target.hostname.includes('-pooler')) throw new Error();
  if (!['localhost', '127.0.0.1'].includes(target.hostname) && target.searchParams.get('sslmode') !== 'verify-full') throw new Error();
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error()));
  });
  // Validate squashed-history compatibility before migrating; no public startup migrations.
  const child = spawn(process.execPath, ['scripts/migrate-local.mjs'], { cwd: root, env: process.env, stdio: 'inherit' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error())); });
  await run(['deploy/public/prepare.mjs']);
} catch {
  process.stderr.write('Public demo preparation failed; verify owner, direct TLS URL, schema and target\n');
  process.exitCode = 1;
}
