/**
 * Each public service call has one REST counterpart for the console's shared
 * controls. This allowlist also defines which methods the demo server can run.
 * Input shapes vary by operation and are validated against canonical schemas
 * before execution, so the editor stores their JSON fields dynamically.
 */
export interface LibraryCall {
  operation: string;
  input: Record<string, any>;
}

export interface RestRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, any>;
}

export interface LibraryOperation {
  operation: string;
  method: 'GET' | 'POST';
  path: string;
  parameter?: string;
  // Most services accept an input object. getById-style readers instead take
  // tenantId and a resource ID as separate positional arguments.
  positional?: boolean;
}

export const libraryOperations: LibraryOperation[] = [
  {
    operation: 'ledgers.list',
    method: 'GET',
    path: '/v1/ledgers',
  },
  {
    operation: 'ledgers.getById',
    method: 'GET',
    path: '/v1/ledgers/:id',
    parameter: 'ledgerId',
    positional: true,
  },
  {
    operation: 'ledgers.create',
    method: 'POST',
    path: '/v1/ledgers',
  },
  {
    operation: 'accounts.list',
    method: 'GET',
    path: '/v1/accounts',
  },
  {
    operation: 'accounts.getById',
    method: 'GET',
    path: '/v1/accounts/:id',
    parameter: 'accountId',
    positional: true,
  },
  {
    operation: 'accounts.create',
    method: 'POST',
    path: '/v1/accounts',
  },
  {
    operation: 'transactions.list',
    method: 'GET',
    path: '/v1/transactions',
  },
  {
    operation: 'transactions.getById',
    method: 'GET',
    path: '/v1/transactions/:id',
    parameter: 'transactionId',
    positional: true,
  },
  {
    operation: 'transactions.create',
    method: 'POST',
    path: '/v1/transactions',
  },
  {
    operation: 'holds.list',
    method: 'GET',
    path: '/v1/holds',
  },
  {
    operation: 'holds.getById',
    method: 'GET',
    path: '/v1/holds/:id',
    parameter: 'holdId',
    positional: true,
  },
  {
    operation: 'holds.create',
    method: 'POST',
    path: '/v1/holds',
  },
  {
    operation: 'creditGrants.list',
    method: 'GET',
    path: '/v1/credit-grants',
  },
  {
    operation: 'creditGrants.getById',
    method: 'GET',
    path: '/v1/credit-grants/:id',
    parameter: 'grantId',
    positional: true,
  },
  {
    operation: 'creditGrants.create',
    method: 'POST',
    path: '/v1/credit-grants',
  },
  {
    operation: 'transactions.reverse',
    method: 'POST',
    path: '/v1/transactions/:id/reverse',
    parameter: 'transactionId',
  },
  {
    operation: 'transactions.correct',
    method: 'POST',
    path: '/v1/transactions/:id/correct',
    parameter: 'transactionId',
  },
  {
    operation: 'holds.commit',
    method: 'POST',
    path: '/v1/holds/:id/commit',
    parameter: 'holdId',
  },
  {
    operation: 'holds.void',
    method: 'POST',
    path: '/v1/holds/:id/void',
    parameter: 'holdId',
  },
  {
    operation: 'creditGrants.reverse',
    method: 'POST',
    path: '/v1/credit-grants/:id/reversal',
    parameter: 'grantId',
  },
  {
    operation: 'creditGrants.refund',
    method: 'POST',
    path: '/v1/credit-grants/:id/refund',
    parameter: 'grantId',
  },
  {
    operation: 'transactions.createBulk',
    method: 'POST',
    path: '/v1/transactions/bulk',
  },
  {
    operation: 'transactions.listEntries',
    method: 'GET',
    path: '/v1/entries',
  },
  {
    operation: 'balances.getAt',
    method: 'GET',
    path: '/v1/accounts/:id/balance-as-of',
    parameter: 'accountId',
  },
  {
    operation: 'balances.listHistory',
    method: 'GET',
    path: '/v1/accounts/:id/balance-history',
    parameter: 'accountId',
  },
  {
    operation: 'balances.getTrialBalance',
    method: 'GET',
    path: '/v1/ledgers/:id/trial-balance',
    parameter: 'ledgerId',
  },
  {
    operation: 'statements.getAccountStatement',
    method: 'GET',
    path: '/v1/accounts/:id/statement',
    parameter: 'accountId',
  },
  {
    operation: 'statements.getCreditLotStatement',
    method: 'GET',
    path: '/v1/accounts/:id/credit-statement',
    parameter: 'accountId',
  },
  {
    operation: 'creditGrants.getBalance',
    method: 'GET',
    path: '/v1/accounts/:id/credit-balance',
    parameter: 'accountId',
    positional: true,
  },
  {
    operation: 'creditGrants.listLots',
    method: 'GET',
    path: '/v1/accounts/:id/credit-lots',
    parameter: 'accountId',
  },
  {
    operation: 'creditGrants.listLineageByGrant',
    method: 'GET',
    path: '/v1/credit-grants/:id/allocations',
    parameter: 'grantId',
  },
  {
    operation: 'creditGrants.listLineageByTransaction',
    method: 'GET',
    path: '/v1/transactions/:id/credit-allocations',
    parameter: 'transactionId',
  },
  {
    operation: 'holds.listEntries',
    method: 'GET',
    path: '/v1/holds/:id/entries',
    parameter: 'holdId',
  },
  {
    operation: 'holds.listCaptures',
    method: 'GET',
    path: '/v1/holds/:id/captures',
    parameter: 'holdId',
  },
  {
    operation: 'holds.listCreditAllocations',
    method: 'GET',
    path: '/v1/holds/:id/credit-allocations',
    parameter: 'holdId',
  },
  {
    operation: 'creditGrants.previewExpirations',
    method: 'POST',
    path: '/v1/credit-grants/expiration/preview',
  },
  {
    operation: 'creditGrants.runExpirations',
    method: 'POST',
    path: '/v1/credit-grants/expiration/run',
  },
  {
    operation: 'adjustments.credit',
    method: 'POST',
    path: '/v1/adjustments/credit',
  },
  {
    operation: 'adjustments.debit',
    method: 'POST',
    path: '/v1/adjustments/debit',
  },
  {
    operation: 'reconciliation.createRule',
    method: 'POST',
    path: '/v1/reconciliation/matching-rules',
  },
  {
    operation: 'reconciliation.ingest',
    method: 'POST',
    path: '/v1/reconciliation/external-records',
  },
  {
    operation: 'reconciliation.run',
    method: 'POST',
    path: '/v1/reconciliation/runs',
  },
  {
    operation: 'reconciliation.listRules',
    method: 'GET',
    path: '/v1/reconciliation/matching-rules',
  },
  {
    operation: 'reconciliation.listUploads',
    method: 'GET',
    path: '/v1/reconciliation/uploads',
  },
  {
    operation: 'reconciliation.getUpload',
    method: 'GET',
    path: '/v1/reconciliation/uploads/:id',
    parameter: 'uploadId',
    positional: true,
  },
  {
    operation: 'reconciliation.listRecords',
    method: 'GET',
    path: '/v1/reconciliation/uploads/:id/records',
    parameter: 'uploadId',
  },
  {
    operation: 'reconciliation.listRuns',
    method: 'GET',
    path: '/v1/reconciliation/runs',
  },
  {
    operation: 'reconciliation.getRun',
    method: 'GET',
    path: '/v1/reconciliation/runs/:id',
    parameter: 'runId',
    positional: true,
  },
  {
    operation: 'reconciliation.listResults',
    method: 'GET',
    path: '/v1/reconciliation/runs/:id/results',
    parameter: 'runId',
  },
];

// These objects belong to the integrator or to a typed filter parser. Walking
// their nested keys would change provider payloads and metadata identity.
const opaqueFields = new Set(['metadata', 'raw', 'attributes', 'where']);
const toCamelCase = (key: string) =>
  key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const toSnakeCase = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function mapKeys(value: any, convert: (key: string) => string): any {
  if (Array.isArray(value)) {
    return value.map((item) => mapKeys(item, convert));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, child]) => {
      const mappedChild = opaqueFields.has(key) ? child : mapKeys(child, convert);
      return [convert(key), mappedChild];
    });
    return Object.fromEntries(entries);
  }
  return value;
}

export function operationDefinition(operation: string): LibraryOperation {
  const definition = libraryOperations.find((item) => item.operation === operation);
  if (!definition) {
    throw new Error('Unsupported library operation');
  }
  return definition;
}

export function toLibraryCall(request: RestRequest): LibraryCall {
  const url = new URL(request.path, 'http://demo.invalid');
  if (url.origin !== 'http://demo.invalid') {
    throw new Error('Use a local demo operation');
  }

  // Match /transactions/bulk before /transactions/:id. Otherwise a fixed route
  // could be interpreted as a resource ID and call the wrong service method.
  const candidates = libraryOperations
    .filter((item) => item.method === request.method)
    .sort((left, right) => Number(left.path.includes(':id')) - Number(right.path.includes(':id')));
  const definition = candidates.find((item) => {
    const pathPattern = new RegExp(`^${item.path.replace(':id', '([^/]+)')}$`);
    return pathPattern.test(url.pathname);
  });
  if (!definition) {
    throw new Error('This operation has no library example');
  }

  const source: Record<string, any> =
    request.method === 'POST' ? { ...request.body } : Object.fromEntries(url.searchParams);
  if (typeof source.where === 'string') {
    source.where = JSON.parse(source.where);
  }
  if (source.limit !== undefined && request.method === 'GET') {
    source.limit = Number(source.limit);
  }

  const input = mapKeys(source, toCamelCase);
  if (input.where) {
    // Rename filter fields only. Operators and their values belong to the
    // canonical filter parser, which validates and converts them on the server.
    input.where = Object.fromEntries(
      Object.entries(input.where).map(([field, condition]) => [toCamelCase(field), condition]),
    );
  }
  if (definition.parameter) {
    const pathPattern = new RegExp(`^${definition.path.replace(':id', '([^/]+)')}$`);
    const resourceId = url.pathname.match(pathPattern)![1];
    input[definition.parameter] = decodeURIComponent(resourceId);
  }

  // The browser describes business arguments. The authenticated host supplies
  // actor and tenant context when it invokes the library.
  delete input.actorId;
  if (definition.operation === 'reconciliation.ingest') {
    input.records = input.records?.map(({ id, date, ...record }: any) => ({
      ...record,
      externalId: id,
      occurredAt: date,
    }));
  }
  return { operation: definition.operation, input };
}

export function toRestRequest(call: LibraryCall): RestRequest {
  const definition = operationDefinition(call.operation);
  const source = { ...call.input };
  delete source.tenantId;
  delete source.actorId;

  let path = definition.path;
  if (definition.parameter) {
    path = path.replace(':id', encodeURIComponent(source[definition.parameter]));
    delete source[definition.parameter];
  }
  if (call.operation === 'reconciliation.ingest') {
    source.records = source.records?.map(({ externalId, occurredAt, ...record }: any) => ({
      ...record,
      id: externalId,
      date: occurredAt,
    }));
  }

  const body = mapKeys(source, toSnakeCase);
  if (body.where) {
    body.where = Object.fromEntries(
      Object.entries(body.where).map(([field, condition]) => [toSnakeCase(field), condition]),
    );
  }
  if (definition.method === 'POST') {
    return { method: 'POST', path, body };
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      query.set(key, key === 'where' ? JSON.stringify(value) : String(value));
    }
  }
  return { method: 'GET', path: path + (query.size ? `?${query}` : '') };
}

const bigintFields = new Set(['amountMinor', 'signedAmountMinor', 'amountToleranceMinor']);
const dateFields = new Set(['effectiveAt', 'expiresAt', 'asOf', 'at', 'from', 'to', 'occurredAt']);

function nativeFilterValue(field: string, value: any): any {
  if (value === null) return null;
  if (/Minor$/.test(field)) return BigInt(value);
  if (/At$/.test(field)) return new Date(value);
  return value;
}

/** Restore only known service types after crossing the browser's JSON boundary. */
export function nativeInput(value: any, key = ''): any {
  if (key === 'where' && value && typeof value === 'object') {
    const filters = Object.entries(value).map(([field, conditions]) => {
      const nativeConditions = Object.entries(conditions as object).map(([operator, operand]) => {
        const nativeOperand = Array.isArray(operand)
          ? operand.map((item) => nativeFilterValue(field, item))
          : nativeFilterValue(field, operand);
        return [operator, nativeOperand];
      });
      return [field, Object.fromEntries(nativeConditions)];
    });
    return Object.fromEntries(filters);
  }

  // Metadata and raw provider records may contain keys such as amountMinor or
  // effectiveAt. They must remain exactly as supplied by the integrator.
  if (opaqueFields.has(key) || value === null || value === undefined) return value;
  if (bigintFields.has(key)) return BigInt(value);
  if (dateFields.has(key)) return new Date(value);
  if (Array.isArray(value)) {
    return value.map((item) => nativeInput(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, nativeInput(child, childKey)]),
    );
  }
  return value;
}

/** Used by both execution and code generation so examples show the actual call. */
export function libraryArguments(call: LibraryCall, tenantId: string, actorId: string): any[] {
  const definition = operationDefinition(call.operation);
  if (definition.positional) {
    return [tenantId, call.input[definition.parameter!]];
  }

  const input = { ...nativeInput(call.input), tenantId };
  if (call.operation.startsWith('adjustments.')) {
    input.actorId = actorId;
  }
  if (call.operation === 'transactions.createBulk') {
    input.transactions = input.transactions.map((transaction: any) => ({
      ...transaction,
      tenantId,
    }));
  }

  // Service inputs require explicit nullable fields that the HTTP contract lets
  // clients omit. Supply those defaults before execution and example generation.
  if (call.operation === 'creditGrants.create' && input.expiresAt === undefined) {
    input.expiresAt = null;
  }
  if (call.operation === 'reconciliation.ingest') {
    input.records = input.records.map((record: any) => ({
      ...record,
      description: record.description ?? null,
      raw: record.raw ?? null,
    }));
  }
  return [input];
}

// JSON.stringify cannot emit bigint literals or Date constructors. Render native
// values as executable TypeScript so copying an example preserves service types.
function typescriptLiteral(value: unknown, depth = 1): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;

  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map((child) => childIndent + typescriptLiteral(child, depth + 1));
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const fields = entries.map(
      ([key, child]) =>
        `${childIndent}${JSON.stringify(key)}: ${typescriptLiteral(child, depth + 1)}`,
    );
    return `{\n${fields.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function libraryCode(
  call: LibraryCall,
  tenantId = '<sandbox-tenant-id>',
  actorId = '<sandbox-actor-id>',
): string {
  const argumentsCode = libraryArguments(call, tenantId, actorId)
    .map((argument) => typescriptLiteral(argument))
    .join(', ');

  return `// Node.js, @borecount/postgres-adapter@0.8.0, migrated PostgreSQL.
// Set DATABASE_URL to the database containing this tenant and its resources.
import { createDbClient, createApplicationServices } from '@borecount/postgres-adapter';

const db = createDbClient();
const services = createApplicationServices(db);
try {
  const result = await services.${call.operation}(${argumentsCode});
  console.dir(result, { depth: null });
} finally {
  await db.sql.end();
}
`;
}
