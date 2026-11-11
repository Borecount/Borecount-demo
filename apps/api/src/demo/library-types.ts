import type { JsonSchema } from '../api/openapi-types';

export interface OperationSchemas {
  body: JsonSchema;
  query: JsonSchema & { properties: Record<string, JsonSchema> };
  parameter?: JsonSchema;
}

// Each exported mapper accepts a different result type. The operation registry
// pairs each mapper with its service, keeping the dynamic dispatch in one place.
export type ResultMapper = (value: never) => unknown;
