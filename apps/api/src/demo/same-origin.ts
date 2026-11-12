import type { FastifyRequest } from 'fastify';

/** Cookie-authenticated mutations require affirmative browser origin context. */
export function isSameOrigin(request: FastifyRequest): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  // Browsers set Fetch Metadata against the public URL. Prefer that evidence
  // when a reverse proxy rewrites Host or strips its public port.
  if (request.headers['sec-fetch-site'] === 'same-origin') return true;
  const origin = request.headers.origin;
  if (!origin) return false;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
