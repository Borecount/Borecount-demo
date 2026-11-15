// Operator-only release step. Use an owner login OR a managed admin allowed to SET ROLE.
// Never put either credential in the web/cron environment.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrationHistoryMatches } from './migration-history.mjs';
import { safeDatabaseFailure } from './safe-db-error.mjs';

export async function preparePublicDemo(databaseUrl) {
  let target;
  try {
    target = new URL(databaseUrl);
    if (target.pathname !== '/luxledger_demo_hosted' || target.hostname.includes('-pooler')) throw new Error();
    if (!['localhost', '127.0.0.1'].includes(target.hostname) && target.searchParams.get('sslmode') !== 'verify-full') throw new Error();
  } catch {
    throw Object.assign(new Error(), { code: 'CONFIGURATION_INVALID' });
  }
  // All queries and Drizzle migrations share this single connection and its session role.
  const client = postgres(target.href, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await client.unsafe('SET ROLE borecount_demo_owner');
    const [identity] = await client`select current_database() as database, current_user as role`;
    if (identity.database !== 'luxledger_demo_hosted' || identity.role !== 'borecount_demo_owner') {
      throw Object.assign(new Error(), { code: 'CONFIGURATION_INVALID' });
    }
    const folder = new URL('../drizzle/', import.meta.url);
    const journal = JSON.parse(await readFile(new URL('meta/_journal.json', folder), 'utf8'));
    const hashes = await Promise.all(journal.entries.map(async ({ tag }) =>
      createHash('sha256').update(await readFile(new URL(`${tag}.sql`, folder))).digest('hex')));
    const [table] = await client`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
    if (table.exists) {
      const applied = await client`select hash from drizzle.__drizzle_migrations order by created_at, id`;
      if (!migrationHistoryMatches(applied.map(row => row.hash), hashes)) {
        throw Object.assign(new Error(), { code: 'MIGRATION_HISTORY_MISMATCH' });
      }
    }
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(folder) });
    const source = (await readFile(new URL('../deploy/public/prepare.sql', import.meta.url), 'utf8')).replace(/^\\set.*$/gm, '');
    await client.unsafe(source);
  } finally { await client.end({ timeout: 5 }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await preparePublicDemo(process.env.DATABASE_URL);
    console.log('Public demo migrations and permissions prepared as borecount_demo_owner');
  } catch (error) {
    console.error(JSON.stringify({ event: 'public_demo_preparation_failed', ...safeDatabaseFailure(error) }));
    process.exitCode = 1;
  }
}
