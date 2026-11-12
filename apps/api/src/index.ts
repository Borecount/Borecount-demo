import { parseJwtAuthConfig } from '@api/auth/policy';
import { parseRateLimitConfig } from '@api/rate-limit/policy';
import { FixedWindowLimiter } from '@api/rate-limit/fixed-window-limiter';
import { createServerCore, registerApplication } from '@api/server';
import { registerSandbox } from './demo/sandbox';
import { isMainModule } from './utils/is-main-module';
import { ApiKeyRole } from '@borecount/core/application';
import { ForbiddenError } from '@borecount/core/errors';
import { createApplicationServices, createDbClient } from '@borecount/postgres-adapter';

const parsePort = (value: string | undefined): number => {
  if (value === undefined) {
    return 3000;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return port;
};

const parseShutdownTimeout = (value: string | undefined): number => {
  if (value === undefined) {
    return 10_000;
  }

  const timeout = Number(value);

  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error('SHUTDOWN_TIMEOUT_MS must be a positive integer');
  }

  return timeout;
};

export const run = async (): Promise<void> => {
  const dbClient = createDbClient();
  const server = createServerCore({
    readinessCheck: async () => {
      await dbClient.sql`select 1`;
    },
    logger: true,
  });
  const services = createApplicationServices(dbClient);
  const jwtAuth = parseJwtAuthConfig(process.env);
  const rateLimit = parseRateLimitConfig(process.env);
  const rateLimiter = new FixedWindowLimiter();
  registerApplication(server, {
    services,
    jwtAuth,
    rateLimit,
    rateLimiter,
    authorizeAdjustment: async ({ tenantId, apiKeyId, apiKeyRole }) => {
      if (apiKeyRole !== ApiKeyRole.ADMIN) {
        const [sandbox] = await dbClient.sql`select id from demo_sessions
          where tenant_id = ${tenantId} and api_key_id = ${apiKeyId} and expires_at > now()`;
        if (!sandbox) throw new ForbiddenError('Adjustments require an ADMIN key or an active sandbox session');
      }
      return { actorId: apiKeyId };
    },
  });
  registerSandbox(server, dbClient, services, jwtAuth, {
    rateLimiter,
    writePolicy: rateLimit.write,
  });
  const port = parsePort(process.env.PORT);
  const shutdownTimeoutMs = parseShutdownTimeout(process.env.SHUTDOWN_TIMEOUT_MS);

  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    server.log.info({ signal }, 'Received shutdown signal');

    const hardStopTimer = setTimeout(() => {
      server.log.error({ timeoutMs: shutdownTimeoutMs }, 'Graceful shutdown timed out');
      process.exit(1);
    }, shutdownTimeoutMs);
    hardStopTimer.unref();

    try {
      // Fastify close waits for in-flight requests to drain.
      await server.close();
      await dbClient.sql.end({ timeout: 5 });
      clearTimeout(hardStopTimer);
      process.exit(0);
    } catch (error) {
      clearTimeout(hardStopTimer);
      server.log.error(error);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await server.listen({
      host: '0.0.0.0',
      port,
    });
  } catch (error) {
    server.log.error(error);

    await dbClient.sql.end({ timeout: 5 });

    process.exit(1);
  }
};

if (isMainModule(import.meta.url)) {
  await run();
}
