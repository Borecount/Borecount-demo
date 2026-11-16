import postgres from 'postgres';

export function validateCleanupUrl(value) {
  try {
    const target = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
        target.pathname !== '/luxledger_demo_hosted' || target.username !== 'borecount_demo_cleanup' ||
        target.hostname.includes('-pooler') || target.hostname.includes(',')) throw new Error();
    const local = ['localhost', '127.0.0.1'].includes(target.hostname);
    if (!local && target.searchParams.get('sslmode') !== 'verify-full') throw new Error();
    // Do not let URL options override TLS, role, timeouts or connection limits.
    for (const key of target.searchParams.keys()) {
      if (!['sslmode', 'channel_binding'].includes(key) || target.searchParams.getAll(key).length !== 1) throw new Error();
    }
    return target;
  } catch {
    throw Object.assign(new Error('Invalid cleanup configuration'), { code: 'CONFIGURATION_INVALID' });
  }
}

export function cleanupConnection(target) {
  // Discard URL query options after validation. Enforce verified TLS explicitly.
  const local = ['localhost', '127.0.0.1'].includes(target.hostname);
  const url = new URL(target.href);
  url.search = '';
  const sql = postgres(url.href, {
    max: 1, connect_timeout: 5, idle_timeout: 5,
    ssl: local ? false : { rejectUnauthorized: true },
    onnotice: () => {},
    connection: { application_name: 'public-demo-cleanup', statement_timeout: 30000, lock_timeout: 2000 },
  });
  return {
    async status() { return (await sql`select demo_ops.public_status() as status`)[0]?.status; },
    async cleanup() { return (await sql`select demo_ops.cleanup_due() as reset`)[0]?.reset; },
    close() { return sql.end({ timeout: 0 }); },
  };
}
