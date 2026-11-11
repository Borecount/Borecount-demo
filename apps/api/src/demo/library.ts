import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApplicationServices } from '@borecount/core/application';
import * as http from '@borecount/http';
import * as mappers from '@borecount/http/mappers';
import {
  libraryOperations,
  operationDefinition,
  toRestRequest,
  toLibraryCall,
  libraryArguments,
} from '../../../../shared/library';
import type {
  LibraryCall,
  LibraryOperation,
  LibraryExecutionResponse,
} from '../../../../shared/library-types';
import type { JsonSchema, OpenApiDocument } from '../api/openapi-types';
import type { OperationSchemas, ResultMapper } from './library-types';
import type { SandboxIdentity } from './sandbox-types';
import { FixedWindowLimiter } from '../api/rate-limit/fixed-window-limiter';
import { RateLimitExceededError } from '../api/errors';

const specification = parse(
  readFileSync(new URL('../../../../openapi/openapi.yaml', import.meta.url), 'utf8'),
) as OpenApiDocument;

function invalidInput(message: string): never {
  // The existing server error handler recognizes validation errors and returns INVALID_INPUT.
  throw Object.assign(new Error(message), { validation: [], code: 'INVALID_INPUT' });
}

function serializeForBrowser(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, child) => (typeof child === 'bigint' ? child.toString() : child)),
  );
}

const filterFieldsByOperation: Record<string, http.FilterFields> = {
  'ledgers.list': http.ledgerFilterFields,
  'accounts.list': http.accountFilterFields,
  'transactions.list': http.transactionFilterFields,
  'transactions.listEntries': http.entryFilterFields,
  'balances.listHistory': http.balanceHistoryFilterFields,
  'holds.list': http.holdSummaryFilterFields,
  'holds.listEntries': http.holdEntryFilterFields,
  'holds.listCaptures': http.holdCaptureFilterFields,
  'holds.listCreditAllocations': http.holdCreditAllocationFilterFields,
  'creditGrants.list': http.creditGrantFilterFields,
  'creditGrants.listLots': http.creditGrantFilterFields,
  'creditGrants.listLineageByGrant': http.creditLineageFilterFields,
  'creditGrants.listLineageByTransaction': http.creditLineageFilterFields,
  'reconciliation.listRules': http.reconRuleFilterFields,
  'reconciliation.listUploads': http.reconUploadListFilterFields,
  'reconciliation.listRuns': http.reconRunListFilterFields,
  'reconciliation.listResults': http.reconResultListFilterFields,
};

/** Expand local OpenAPI references so Fastify can compile each standalone input schema. */
function resolveReferences<T>(value: T): T {
  if (Array.isArray(value)) return value.map(resolveReferences) as T;
  if (!value || typeof value !== 'object') return value;

  const object = value as Record<string, unknown>;
  if (typeof object.$ref === 'string') {
    const referenced = object.$ref
      .slice(2)
      .split('/')
      .reduce<unknown>((parent, key) => (parent as Record<string, unknown>)[key], specification);
    return resolveReferences(referenced) as T;
  }

  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => key !== 'example' && key !== 'xml')
      .map(([key, child]) => [key, resolveReferences(child)]),
  ) as T;
}

function buildOperationSchemas(operation: LibraryOperation): OperationSchemas {
  const canonicalPath = Object.keys(specification.paths).find(
    (path) => path.replace(/\{[^}]+\}/g, ':id') === operation.path,
  );
  if (!canonicalPath) throw new Error(`Missing OpenAPI path for ${operation.operation}`);

  const path = specification.paths[canonicalPath];
  const route = operation.method === 'GET' ? path.get : path.post;
  if (!route) throw new Error(`Missing OpenAPI operation for ${operation.operation}`);

  const parameters = [...(path.parameters ?? []), ...(route.parameters ?? [])].map(
    resolveReferences,
  );
  const queryProperties: Record<string, JsonSchema> = {};
  const requiredQueryParameters: string[] = [];

  for (const parameter of parameters) {
    if (parameter.in !== 'query') continue;
    // OpenAPI describes `where` as JSON content; the URL carries a bounded string.
    // The public filter parser validates its fields and operators separately below.
    queryProperties[parameter.name] = parameter.schema ?? { type: 'string', maxLength: 8192 };
    if (parameter.required) requiredQueryParameters.push(parameter.name);
  }

  return {
    body: route.requestBody
      ? resolveReferences(route.requestBody.content['application/json'].schema)
      : { type: 'object', additionalProperties: false, properties: {} },
    query: {
      type: 'object',
      additionalProperties: false,
      properties: queryProperties,
      required: requiredQueryParameters,
    },
    parameter: parameters.find((parameter) => parameter.in === 'path')?.schema,
  };
}

// Reuse released input constraints without invoking the HTTP adapter or duplicating its rules.
const schemasByOperation = new Map(
  libraryOperations.map((operation) => [operation.operation, buildOperationSchemas(operation)]),
);

const pageItemMappers: Record<string, ResultMapper> = {
  'accounts.list': mappers.toAccountResponse,
  'transactions.list': mappers.toTransactionResponse,
  'transactions.listEntries': mappers.toEntryResponse,
  'holds.list': mappers.toHoldSummaryResponse,
  'holds.listEntries': mappers.toHoldEntryResponse,
  'holds.listCaptures': mappers.toHoldCaptureResponse,
  'holds.listCreditAllocations': mappers.toHoldCreditAllocationResponse,
  'creditGrants.list': mappers.toCreditGrantResponse,
  'creditGrants.listLots': mappers.toCreditGrantLotResponse,
  'creditGrants.listLineageByGrant': mappers.toCreditGrantLineageItemResponse,
  'creditGrants.listLineageByTransaction': mappers.toCreditGrantLineageItemResponse,
  'reconciliation.listRules': mappers.toReconRuleResponse,
  'reconciliation.listUploads': mappers.toReconUploadResponse,
  'reconciliation.listRuns': mappers.toReconRunSummaryResponse,
  'reconciliation.listRecords': mappers.toReconRecordResponse,
  'reconciliation.listResults': mappers.toReconResultResponse,
};

const resultMappers: Record<string, ResultMapper> = {
  'accounts.create': mappers.toAccountResponse,
  'accounts.getById': mappers.toAccountResponse,
  'transactions.getById': mappers.toTransactionResponse,
  'holds.getById': mappers.toHoldSummaryResponse,
  'balances.getTrialBalance': mappers.toTrialBalanceResponse,
  'statements.getAccountStatement': mappers.toAccountStatementResponse,
  'statements.getCreditLotStatement': mappers.toCreditLotStatementResponse,
  'creditGrants.getById': mappers.toCreditGrantResponse,
  'creditGrants.getBalance': mappers.toCreditBalanceResponse,
  'creditGrants.refund': mappers.toRefundCreditGrantResponse,
  'creditGrants.previewExpirations': mappers.toCreditGrantExpirationResponse,
  'creditGrants.runExpirations': mappers.toCreditGrantExpirationResponse,
  'adjustments.credit': mappers.toAdjustmentResponse,
  'adjustments.debit': mappers.toAdjustmentResponse,
  'reconciliation.createRule': mappers.toReconRuleResponse,
  'reconciliation.ingest': mappers.toReconUploadResponse,
  'reconciliation.getUpload': mappers.toReconUploadResponse,
  'reconciliation.run': mappers.toReconRunResponse,
  'reconciliation.getRun': mappers.toReconRunResponse,
};

/** Used only for structural result fields; metadata-bearing entities use public mappers. */
function structuralResultToSnakeCase(value: unknown): unknown {
  if (value instanceof Date || typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(structuralResultToSnakeCase);

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      structuralResultToSnakeCase(child),
    ]),
  );
}

function toDisplayResult(operation: string, value: unknown): unknown {
  const pageMapper = pageItemMappers[operation];
  if (pageMapper || operation === 'ledgers.list') {
    const page = value as { data: unknown[]; nextCursor: string | null };
    return {
      data: pageMapper ? page.data.map((item) => pageMapper(item as never)) : page.data,
      next_cursor: page.nextCursor,
    };
  }

  const resultMapper = resultMappers[operation];
  if (resultMapper) return resultMapper(value as never);

  switch (operation) {
    case 'ledgers.create':
    case 'ledgers.getById':
      return value;
    case 'creditGrants.create':
    case 'creditGrants.reverse': {
      const result = value as Awaited<ReturnType<ApplicationServices['creditGrants']['create']>>;
      return mappers.toCreditGrantResponse(result.grant);
    }
    case 'balances.getAt': {
      const balance = value as Awaited<ReturnType<ApplicationServices['balances']['getAt']>>;
      return {
        account_id: balance.accountId,
        timestamp: balance.at,
        posted_minor: balance.postedMinor,
        reserved_delta_minor: balance.reservedDeltaMinor,
        available_minor: balance.availableMinor,
      };
    }
    default:
      return structuralResultToSnakeCase(value);
  }
}

function isSameOrigin(request: FastifyRequest): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin || request.headers['sec-fetch-site'] === 'same-origin') return true;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

const authorityFields = new Set([
  'tenantId',
  'tenant_id',
  'actorId',
  'actor_id',
  '__proto__',
  'constructor',
  'prototype',
]);
const opaqueDataFields = new Set(['metadata', 'raw', 'attributes']);

function containsAuthorityOverride(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(containsAuthorityOverride);
  if (!input || typeof input !== 'object') return false;

  return Object.entries(input).some(
    ([key, value]) =>
      authorityFields.has(key) ||
      // Arbitrary business metadata may contain these names without granting authority.
      (!opaqueDataFields.has(key) && containsAuthorityOverride(value)),
  );
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectKeys((value as Record<string, unknown>)[key])]),
  );
}

function validateSchema(request: FastifyRequest, schema: JsonSchema, value: unknown): void {
  if (!request.compileValidationSchema(schema)(value)) invalidInput('Invalid library arguments');
}

function prepareServiceArguments(
  request: FastifyRequest,
  call: LibraryCall,
  operation: LibraryOperation,
  identity: SandboxIdentity,
): unknown[] {
  if (containsAuthorityOverride(call.input)) {
    invalidInput('Tenant and actor are supplied by the authenticated sandbox');
  }

  let restRequest;
  try {
    restRequest = toRestRequest(call);
  } catch {
    return invalidInput('Invalid library arguments');
  }

  const url = new URL(restRequest.path, 'http://demo.invalid');
  const schemas = schemasByOperation.get(call.operation)!;
  if (operation.parameter) {
    validateSchema(
      request,
      {
        type: 'object',
        required: ['id'],
        properties: { id: schemas.parameter ?? { type: 'string', format: 'uuid' } },
      },
      { id: call.input[operation.parameter] },
    );
  }

  if (restRequest.method === 'POST') {
    if (call.operation.startsWith('adjustments.')) {
      restRequest.body!.actor_id = identity.api_key_id;
    }
    validateSchema(request, schemas.body, restRequest.body);
  } else {
    validateSchema(request, schemas.query, Object.fromEntries(url.searchParams));
  }

  // Reject misspelled or snake_case arguments instead of silently dropping them in conversion.
  const canonicalInput = toLibraryCall(restRequest).input;
  if (
    JSON.stringify(sortObjectKeys(canonicalInput)) !== JSON.stringify(sortObjectKeys(call.input))
  ) {
    invalidInput('Use the displayed camelCase library arguments');
  }

  const filterFields = filterFieldsByOperation[call.operation];
  let parsedWhere: unknown;
  if (filterFields && call.input.where !== undefined) {
    parsedWhere = http.readWhereParameter(url.pathname + url.search, filterFields);
    if (parsedWhere === null) invalidInput('Invalid filter');
  }

  // Validate filters before bigint/date conversion: invalid editor input is a 400, not a 500.
  let args: unknown[];
  try {
    args = libraryArguments(call, identity.tenant_id, identity.api_key_id);
  } catch {
    return invalidInput('Invalid typed library arguments');
  }

  if (!operation.positional) {
    const input = args[0] as Record<string, unknown>;
    if (filterFields && call.input.where !== undefined) input.where = parsedWhere;
    if (operation.method === 'GET' && schemas.query.properties.limit && input.limit === undefined) {
      input.limit = 50;
    }
  }
  return args;
}

async function invokeService(
  services: ApplicationServices,
  operation: string,
  args: unknown[],
): Promise<unknown> {
  // Only names in libraryOperations reach this boundary; no caller-selected property dispatch.
  const [serviceName, methodName] = operation.split('.');
  const service = services[serviceName as keyof ApplicationServices];
  const method = (service as unknown as Record<string, (...args: never[]) => Promise<unknown>>)[
    methodName
  ];
  return method.apply(service, args as never[]);
}

export function registerLibrary(
  server: FastifyInstance,
  services: ApplicationServices,
  resolveSession: (request: FastifyRequest) => Promise<SandboxIdentity>,
): void {
  const limiter = new FixedWindowLimiter();

  server.post<{ Body: LibraryCall }>(
    '/demo/library/execute',
    {
      bodyLimit: 1024 * 1024,
      errorHandler(error, _request, reply) {
        if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          return reply.code(413).send({
            error: 'PAYLOAD_TOO_LARGE',
            message: 'Library request exceeds the 1 MiB limit',
          });
        }
        throw error;
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['operation', 'input'],
          properties: {
            operation: { type: 'string', enum: libraryOperations.map((item) => item.operation) },
            input: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!isSameOrigin(request)) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Same-origin library execution required',
        });
      }

      // This route sits outside /v1, so it must enforce session and quota checks itself.
      const identity = await resolveSession(request);
      request.tenantId = identity.tenant_id;
      request.apiKeyId = identity.api_key_id;
      const quota = limiter.consume(identity.api_key_id, { maxRequests: 600, windowSeconds: 60 });
      if (!quota.allowed) throw new RateLimitExceededError(quota.retryAfterSeconds);

      const call = request.body;
      const operation = operationDefinition(call.operation);
      const args = prepareServiceArguments(request, call, operation, identity);
      const value = await invokeService(services, call.operation, args);
      const executedInput = operation.positional
        ? { ...call.input, tenantId: identity.tenant_id }
        : args[0];

      // Existing panels consume the REST-shaped display result. The journal gets the native
      // library value and actual trusted arguments, with only bigint/Date serialization applied.
      const response: LibraryExecutionResponse = {
        result: serializeForBrowser(toDisplayResult(call.operation, value)),
        value: serializeForBrowser(value),
        call: {
          operation: call.operation,
          input: serializeForBrowser(executedInput) as LibraryCall['input'],
        },
      };
      return response;
    },
  );
}
