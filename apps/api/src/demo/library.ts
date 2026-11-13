import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApplicationServices } from '@borecount/core/application';
import { ForbiddenError } from '@borecount/core/errors';
import { resolveLimit } from '@borecount/http/query/pagination';
import { libraryOperations, libraryArguments } from '../../../../shared/library';
import type { LibraryCall, LibraryExecutionResponse } from '../../../../shared/library-types';
import type { OpenApiDocument } from '../api/openapi-types';
import type { LibraryRateLimit, PreparedLibraryOperation } from './library-types';
import type { SandboxIdentity } from './sandbox-types';
import { protectReports } from '../api/resource-protection/host-protection';
import { HostInputError } from '../api/errors/host-input-error';
import { isSameOrigin } from './same-origin';
import { createLibraryRegistry } from './library-registry';
import { buildLibraryInputSchema, parseLibraryFilter } from './library-validation';

interface ValidatedLibraryInput {
  readonly operation: PreparedLibraryOperation;
  readonly input: LibraryCall['input'];
  readonly where: unknown;
}

function validate(
  call: LibraryCall,
  operation: PreparedLibraryOperation,
): ValidatedLibraryInput {
  if (call.operation !== operation.metadata.operation) {
    throw new HostInputError('Library operation does not match input schema');
  }
  // AJV may coerce/default fields. Keep those changes separate from the submitted
  // JSON so validation never mutates journal/replay data supplied by the caller.
  const input = structuredClone(call.input);
  if (!operation.validate?.(input)) {
    throw new HostInputError('Invalid library arguments', { cause: operation.validate?.errors });
  }

  const fields = operation.implementation.filterFields;
  let where: unknown;
  if (fields && input.where !== undefined) {
    where = parseLibraryFilter(input.where, fields);
    if (where === null) throw new HostInputError('Invalid filter');
  }

  return { operation, input, where };
}

// Carry the matching operation and parsed filter through the validation boundary;
// argument construction must not reread the unvalidated request body.
function buildArgs(
  { operation, input, where }: ValidatedLibraryInput,
  identity: SandboxIdentity,
): unknown[] {
  const fields = operation.implementation.filterFields;
  let args: unknown[];
  try {
    args = libraryArguments(
      { operation: operation.metadata.operation, input },
      identity.tenant_id,
      identity.api_key_id,
    );
  } catch (cause) {
    throw new HostInputError('Invalid typed library arguments', { cause });
  }

  if (!operation.metadata.positional) {
    const argument = args[0] as Record<string, unknown>;
    if (fields && input.where !== undefined) argument.where = where;
    if (operation.metadata.method === 'GET' && operation.schema.properties.limit) {
      argument.limit = resolveLimit(argument.limit as number | undefined);
    }
  }
  return args;
}

export function registerLibrary(
  server: FastifyInstance,
  services: ApplicationServices,
  resolveSession: (request: FastifyRequest) => Promise<SandboxIdentity>,
  { protection }: LibraryRateLimit,
  specification: OpenApiDocument,
): void {
  const registry = createLibraryRegistry(protectReports(services, protection));
  const operations = new Map<string, PreparedLibraryOperation>(
    libraryOperations.map((metadata) => {
      const implementation = registry[metadata.operation];
      return [
        metadata.operation,
        {
          metadata,
          implementation,
          schema: buildLibraryInputSchema(specification, metadata, implementation.filterFields),
        },
      ];
    }),
  );

  // Route registration initializes Fastify's compiler. Compile each complete
  // schema once before accepting traffic; requests never allocate validators.
  server.addHook('onReady', async () => {
    if (!server.validatorCompiler) throw new Error('Library validation compiler is unavailable');
    for (const operation of operations.values()) {
      operation.validate = server.validatorCompiler({
        schema: operation.schema,
        method: 'POST',
        url: '/demo/library/execute',
        httpPart: 'body',
      });
    }
  });

  server.post<{ Body: LibraryCall }>(
    '/demo/library/execute',
    {
      bodyLimit: protection.config.bodyBytes,
      onRequest: async (request) => {
        if (!isSameOrigin(request)) throw new ForbiddenError('Same-origin library execution required');
        const identity = await resolveSession(request);
        request.tenantId = identity.tenant_id;
        request.apiKeyId = identity.api_key_id;
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['operation', 'input'],
          properties: {
            operation: { type: 'string', enum: [...operations.keys()] },
            input: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const identity: SandboxIdentity = { tenant_id: request.tenantId!, api_key_id: request.apiKeyId! };
      const call = request.body;
      const operation = operations.get(call.operation)!;
      if (operation.metadata.path === '/v1/transactions/bulk') protection.validateBulk(call.input);
      const validated = validate(call, operation);
      const args = buildArgs(validated, identity);
      protection.account(identity.tenant_id, operation.metadata.method === 'POST');
      const { value, result } = await operation.implementation.execute(args);
      // Positional readers are displayed with names, but every logged value comes
      // from the same argument tuple supplied to the service, never reconstructed input.
      const executedInput = operation.metadata.positional
        ? { tenantId: args[0], [operation.metadata.parameter!]: args[1] }
        : args[0];
      const response: LibraryExecutionResponse = {
        result,
        value,
        call: { operation: operation.metadata.operation, input: executedInput as LibraryCall['input'] },
      };

      // Preserve the native journal value and normalized panel result as distinct
      // views. Serialize the whole envelope once, including bigint and Date values.
      return reply
        .type('application/json')
        .send(
          JSON.stringify(response, (_key, child) =>
            typeof child === 'bigint' ? child.toString() : child,
          ),
        );
    },
  );
}
