import { RateLimitExceededError } from '@borecount/core/errors';
import type { DbClient, UnitOfWorkContext } from '@borecount/postgres-adapter';
import { sql } from 'drizzle-orm';
import { parseIntegerWithinRange } from '../utils/parse-integer-with-range';

export function parseSandboxLimits(env: NodeJS.ProcessEnv) {
  const integer = (name: string, defaultValue: number, max: number) => parseIntegerWithinRange(env[name], {
    defaultValue, min: 1, max, errorMessage: `${name} must be an integer in 1..${max}`,
  });
  return {
    maxTenants: integer('SANDBOX_MAX_TENANTS', 500, 10_000),
    hourlyCreates: integer('SANDBOX_HOURLY_CREATES', 60, 1_000),
  };
}

// Shared by provisioning and the disposable database reset. Not a financial lock.
export const SANDBOX_LIFECYCLE_LOCK = 133_132;

export async function assertPublicHost(db: DbClient, databaseUrl?: string) {
  if (databaseUrl) {
    const target = new URL(databaseUrl);
    if (target.hostname.includes('-pooler') ||
        (!['localhost', '127.0.0.1'].includes(target.hostname) && target.searchParams.get('sslmode') !== 'verify-full')) {
      throw new Error('Public demo requires a direct verified-TLS database connection');
    }
  }
  const [identity] = await db.sql`select current_database() as database, current_user as role,
    rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
    exists (select 1 from pg_auth_members where member = pg_roles.oid) as member_of_role,
    exists (select 1 from pg_tables where schemaname in ('public', 'demo_ops') and tableowner = current_user) as owns_tables,
    has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
    has_table_privilege(current_user, 'public.demo_sessions', 'TRUNCATE') as can_truncate,
    has_function_privilege(current_user, 'demo_ops.cleanup_due()', 'EXECUTE') as can_cleanup
    from pg_roles where rolname = current_user`;
  if (identity?.database !== 'luxledger_demo_hosted' || identity.role !== 'borecount_demo_runtime' ||
      identity.rolsuper || identity.rolbypassrls || identity.rolcreatedb || identity.rolcreaterole ||
      identity.member_of_role || identity.owns_tables || identity.can_create || identity.can_truncate || identity.can_cleanup) {
    throw new Error('Public demo requires its dedicated unprivileged runtime and database');
  }
  const [marker] = await db.sql`select demo_ops.public_status() as status`;
  if (marker?.status?.purpose !== 'borecount-disposable-public-demo') {
    throw new Error('Public demo requires its disposable installation marker');
  }
}

export async function assertSandboxCapacity(tx: UnitOfWorkContext['tx'], limits: ReturnType<typeof parseSandboxLimits>) {
  const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(${SANDBOX_LIFECYCLE_LOCK}) as acquired`);
  if (!lock?.acquired) throw new RateLimitExceededError(1);
  const [counts] = await tx.execute<{ total: number; recent: number }>(sql`select count(*)::int as total,
    count(*) filter (where created_at > now() - interval '1 hour')::int as recent from demo_sessions`);
  if (counts.total >= limits.maxTenants || counts.recent >= limits.hourlyCreates) {
    throw new RateLimitExceededError(60);
  }
}
