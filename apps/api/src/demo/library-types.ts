import type { FastifyInstance } from 'fastify';
import type { LibraryOperation } from '../../../../shared/library-types';
import type { FilterFields } from '@borecount/http';
import type { HostProtection } from '../api/resource-protection/host-protection';
import type { JsonSchema, OpenApiDocument } from '../api/openapi-types';

/** A stable, complete editor-input schema derived from the canonical contract. */
export type LibraryInputSchema = JsonSchema & { properties: Record<string, JsonSchema> };

export interface LibraryServiceOperation {
  filterFields?: FilterFields;
  execute(args: unknown[]): Promise<{ value: unknown; result: unknown }>;
}

/** The same host protection instance is passed to REST and Library execution. */
export interface LibraryRateLimit {
  protection: HostProtection;
}

export interface LibraryBridgeOptions extends LibraryRateLimit {
  specification: OpenApiDocument;
}

export type LibraryInputValidator = ReturnType<NonNullable<FastifyInstance['validatorCompiler']>>;

export interface PreparedLibraryOperation {
  metadata: LibraryOperation;
  implementation: LibraryServiceOperation;
  schema: LibraryInputSchema;
  validate?: LibraryInputValidator;
}
