import type { FixedWindowLimiter } from '../api/rate-limit/fixed-window-limiter';
import type { EndpointRateLimitConfig } from '../api/rate-limit/policy';
import type { JsonSchema } from '../api/openapi-types';

export interface OperationSchemas {
  body: JsonSchema;
  query: JsonSchema & { properties: Record<string, JsonSchema> };
  resourceId?: JsonSchema;
}

// Each exported mapper accepts a different result type. The operation registry
// pairs each mapper with its service, keeping the dynamic dispatch in one place.
export type ResultMapper = (value: never) => unknown;

/** The same instance and write policy are passed to REST and Library execution. */
export interface LibraryRateLimit {
  rateLimiter: FixedWindowLimiter;
  writePolicy: EndpointRateLimitConfig;
}
