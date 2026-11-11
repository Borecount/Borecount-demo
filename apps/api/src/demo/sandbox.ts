import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AccountSide, ApiKeyRole, generateApiKey, type ApplicationServices } from '@borecount/core/application';
import { UnauthorizedError } from '@borecount/core/errors';
import { OverdraftPolicy } from '@borecount/core/account';
import { generateUuidV7, TenantId } from '@borecount/core/base';
import { createUnitOfWork, type DbClient } from '@borecount/postgres-adapter';
import { demoSessions } from './schema';
import { registerLibrary } from './library';
import { issueAccessToken, type JwtAuthConfig } from '../api/auth/jwt';
import { FixedWindowLimiter } from '../api/rate-limit/fixed-window-limiter';
import { RateLimitExceededError } from '../api/errors';

const COOKIE = 'borecount_sandbox';
const SESSION_SECONDS = 8 * 60 * 60;
const sandboxProfiles = {
  USD: { openingMinor: 10000n, names: { funding: 'system:funding', primary: 'wallet:alice', secondary: 'wallet:bob', fees: 'platform:fees', credits: 'credits:alice', usage: 'service:usage' } },
  EUR: { openingMinor: 17500n, names: { funding: 'treasury:eu', primary: 'wallet:eva', secondary: 'wallet:leo', fees: 'platform:commission', credits: 'credits:eva', usage: 'service:subscription' } },
} as const;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const cookieValue = (request: FastifyRequest) => request.headers.cookie?.split(';')
  .map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

export function registerSandbox(server: FastifyInstance, db: DbClient, services: ApplicationServices, jwt: JwtAuthConfig) {
  const limiter = new FixedWindowLimiter();
  const unitOfWork = createUnitOfWork(db);
  const session = async (request: FastifyRequest) => {
    const secret = cookieValue(request);
    if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new UnauthorizedError('Start a demo session first');
    const [row] = await db.sql`select s.*, k.revoked_at from demo_sessions s
      join api_keys k on k.id = s.api_key_id
      where s.token_hash = ${hash(secret)} and s.expires_at > now() and k.revoked_at is null`;
    if (!row) throw new UnauthorizedError('Demo session expired. Start a new sandbox.');
    return row;
  };
  registerLibrary(server, services, session);
  const payload = async (row: Record<string, any>) => ({
    access_token: issueAccessToken({ tenantId: row.tenant_id, apiKeyId: row.api_key_id, role: ApiKeyRole.SERVICE }, jwt),
    expires_in: jwt.accessTokenTtlSeconds,
    session_expires_at: new Date(row.expires_at).toISOString(),
    tenant_id: row.tenant_id,
    actor_id: row.api_key_id,
    assets: (await services.assets.list({ tenantId: row.tenant_id, limit: 200 })).data.map(asset => ({ code: asset.code, scale: asset.scale })),
  });

  server.addHook('onRequest', async request => {
    if (!request.url.startsWith('/v1/') || !request.apiKeyId) return;
    const [expired] = await db.sql`select id from demo_sessions
      where api_key_id = ${request.apiKeyId} and expires_at <= now()`;
    if (expired) throw new UnauthorizedError('Demo session expired');
  });

  server.get('/demo/session', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return payload(await session(request));
  });

  server.post('/demo/session', async (request, reply) => {
    // A new tenant is host provisioning, not part of the library's financial API.
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Same-origin session creation required' });
    const origin = request.headers.origin;
    // Browsers set Sec-Fetch-Site before a reverse proxy can rewrite Host/Origin.
    let sameOrigin = request.headers['sec-fetch-site'] === 'same-origin' || !origin;
    try { sameOrigin ||= new URL(origin!).host === request.headers.host; } catch { /* Reject malformed Origin. */ }
    if (!sameOrigin) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Same-origin session creation required' });
    const decision = limiter.consume(request.ip, { maxRequests: 20, windowSeconds: 3600 });
    if (!decision.allowed) throw new RateLimitExceededError(decision.retryAfterSeconds);
    const secret = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
    const command = {
      tenantId: generateUuidV7(new Date()),
      tenantName: 'Interactive sandbox',
      keyName: 'Sandbox service',
      role: ApiKeyRole.SERVICE,
      rawApiKey: generateApiKey(),
    };
    const row = await unitOfWork.run(new TenantId(command.tenantId), async ({ provisioning, services, tx }) => {
      const provisioned = await provisioning.provisionTenant(command);
      for (const code of ['USD', 'EUR'] as const) {
        const profile = sandboxProfiles[code];
        await services.assets.create({ tenantId: provisioned.tenantId, code, scale: 2 });
        const ledger = await services.ledgers.create({ tenantId: provisioned.tenantId, name: `${code} product ledger` });
        const accounts: Record<string, string> = {};
        for (const [role, side, policy, grant] of [
          ['funding', AccountSide.DEBIT, OverdraftPolicy.ALLOW, false],
          ['primary', AccountSide.CREDIT, OverdraftPolicy.DISALLOW, false],
          ['secondary', AccountSide.CREDIT, OverdraftPolicy.DISALLOW, false],
          ['fees', AccountSide.CREDIT, OverdraftPolicy.DISALLOW, false],
          ['credits', AccountSide.CREDIT, OverdraftPolicy.DISALLOW, true],
          ['usage', AccountSide.CREDIT, OverdraftPolicy.DISALLOW, false],
        ] as const) {
          const account = await services.accounts.create({ tenantId: provisioned.tenantId, ledgerId: ledger.id, code: `DEMO_${role.toUpperCase()}`, name: profile.names[role], side, overdraftPolicy: policy, grantEnabled: grant, currency: code });
          accounts[role] = account.id;
        }
        await services.transactions.create({ tenantId: provisioned.tenantId, ledgerId: ledger.id,
          reference: `sandbox-${code}-opening`, currency: code, description: 'Opening wallet funding',
          metadata: { scenario: 'wallet', provider: { payment_id: `pay_opening_${code.toLowerCase()}` } },
          entries: [{ accountId: accounts.funding, signedAmountMinor: profile.openingMinor, currency: code },
            { accountId: accounts.primary, signedAmountMinor: -profile.openingMinor, currency: code }] });
      }
      const [created] = await tx.insert(demoSessions).values({
        tokenHash: hash(secret),
        tenantId: provisioned.tenantId,
        apiKeyId: provisioned.key.id,
        expiresAt: expires,
      }).returning();
      return {
        tenant_id: created.tenantId,
        api_key_id: created.apiKeyId,
        expires_at: created.expiresAt,
      };
    });
    // Replacing a sandbox revokes its previous credential, never truncates shared tables.
    const previous = cookieValue(request);
    if (previous) await db.sql`update api_keys set revoked_at = now() where id in
      (select api_key_id from demo_sessions where token_hash = ${hash(previous)})`;
    reply.header('set-cookie', `${COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
    reply.header('cache-control', 'no-store');
    return reply.code(201).send(await payload(row));
  });

}
