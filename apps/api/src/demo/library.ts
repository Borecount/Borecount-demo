import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApplicationServices } from '@borecount/core/application';
import * as http from '@borecount/http';
import * as mappers from '@borecount/http/mappers';
import { libraryOperations, operationDefinition, toRestRequest, toLibraryCall, libraryArguments, type LibraryCall } from '../../../../shared/library';
import { FixedWindowLimiter } from '../api/rate-limit/fixed-window-limiter';
import { RateLimitExceededError } from '../api/errors';

const specification = parse(readFileSync(new URL('../../../../openapi/openapi.yaml', import.meta.url), 'utf8'));
const invalid = (message: string): never => { throw Object.assign(new Error(message), { validation: [], code: 'INVALID_INPUT' }); };
const serialize = (value: any): any => JSON.parse(JSON.stringify(value, (_key, child) => typeof child === 'bigint' ? child.toString() : child));
const filterNames: Record<string, string> = {
  'ledgers.list': 'ledgerFilterFields', 'accounts.list': 'accountFilterFields', 'transactions.list': 'transactionFilterFields',
  'transactions.listEntries': 'entryFilterFields', 'balances.listHistory': 'balanceHistoryFilterFields',
  'holds.list': 'holdSummaryFilterFields', 'holds.listEntries': 'holdEntryFilterFields', 'holds.listCaptures': 'holdCaptureFilterFields', 'holds.listCreditAllocations': 'holdCreditAllocationFilterFields',
  'creditGrants.list': 'creditGrantFilterFields', 'creditGrants.listLots': 'creditGrantFilterFields', 'creditGrants.listLineageByGrant': 'creditLineageFilterFields', 'creditGrants.listLineageByTransaction': 'creditLineageFilterFields',
  'reconciliation.listRules': 'reconRuleFilterFields', 'reconciliation.listUploads': 'reconUploadListFilterFields', 'reconciliation.listRuns': 'reconRunListFilterFields', 'reconciliation.listResults': 'reconResultListFilterFields',
};
function resolve(schema: any): any {
  if (Array.isArray(schema)) return schema.map(resolve);
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return resolve(schema.$ref.slice(2).split('/').reduce((value: any, key: string) => value[key], specification));
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !['example', 'xml'].includes(key)).map(([key, value]) => [key, resolve(value)]));
}
// Canonical request schemas validate data only. Execution never dispatches an HTTP route.
const schemas = new Map(libraryOperations.map(entry => {
  const path = Object.keys(specification.paths).find(path => path.replace(/\{[^}]+\}/g, ':id') === entry.path)!;
  const route = specification.paths[path][entry.method.toLowerCase()];
  const parameters = [...(specification.paths[path].parameters ?? []), ...(route.parameters ?? [])].map(resolve);
  const properties: Record<string, any> = {}, required: string[] = [];
  for (const parameter of parameters.filter((item: any) => item.in === 'query')) {
    properties[parameter.name] = parameter.schema ?? { type: 'string', maxLength: 8192 };
    if (parameter.required) required.push(parameter.name);
  }
  return [entry.operation, {
    body: route.requestBody ? resolve(route.requestBody.content['application/json'].schema) : { type: 'object', additionalProperties: false, properties: {} },
    query: { type: 'object', additionalProperties: false, properties, required },
    parameter: parameters.find((item: any) => item.in === 'path')?.schema,
  }];
}));
const pageMappers: Record<string, string> = {
  'accounts.list': 'toAccountResponse', 'transactions.list': 'toTransactionResponse', 'transactions.listEntries': 'toEntryResponse',
  'holds.list': 'toHoldSummaryResponse', 'holds.listEntries': 'toHoldEntryResponse', 'holds.listCaptures': 'toHoldCaptureResponse', 'holds.listCreditAllocations': 'toHoldCreditAllocationResponse',
  'creditGrants.list': 'toCreditGrantResponse', 'creditGrants.listLots': 'toCreditGrantLotResponse', 'creditGrants.listLineageByGrant': 'toCreditGrantLineageItemResponse', 'creditGrants.listLineageByTransaction': 'toCreditGrantLineageItemResponse',
  'reconciliation.listRules': 'toReconRuleResponse', 'reconciliation.listUploads': 'toReconUploadResponse', 'reconciliation.listRuns': 'toReconRunSummaryResponse', 'reconciliation.listRecords': 'toReconRecordResponse', 'reconciliation.listResults': 'toReconResultResponse',
};
const valueMappers: Record<string, string> = {
  'accounts.create': 'toAccountResponse', 'accounts.getById': 'toAccountResponse', 'transactions.getById': 'toTransactionResponse',
  'holds.getById': 'toHoldSummaryResponse', 'balances.getTrialBalance': 'toTrialBalanceResponse',
  'statements.getAccountStatement': 'toAccountStatementResponse', 'statements.getCreditLotStatement': 'toCreditLotStatementResponse',
  'creditGrants.getById': 'toCreditGrantResponse', 'creditGrants.getBalance': 'toCreditBalanceResponse', 'creditGrants.refund': 'toRefundCreditGrantResponse',
  'creditGrants.previewExpirations': 'toCreditGrantExpirationResponse', 'creditGrants.runExpirations': 'toCreditGrantExpirationResponse',
  'adjustments.credit': 'toAdjustmentResponse', 'adjustments.debit': 'toAdjustmentResponse',
  'reconciliation.createRule': 'toReconRuleResponse', 'reconciliation.ingest': 'toReconUploadResponse', 'reconciliation.getUpload': 'toReconUploadResponse', 'reconciliation.run': 'toReconRunResponse', 'reconciliation.getRun': 'toReconRunResponse',
};
function normalize(operation: string, value: any): any {
  const map = (name: string, data: any) => (mappers as any)[name](data);
  if (pageMappers[operation]) return { data: value.data.map((item: any) => map(pageMappers[operation], item)), next_cursor: value.nextCursor };
  if (valueMappers[operation]) return map(valueMappers[operation], value);
  if (operation === 'ledgers.list') return { data: value.data, next_cursor: value.nextCursor };
  if (operation === 'ledgers.create' || operation === 'ledgers.getById') return value;
  if (operation === 'creditGrants.create' || operation === 'creditGrants.reverse') return map('toCreditGrantResponse', value.grant);
  if (operation === 'balances.getAt') return { account_id: value.accountId, timestamp: value.at, posted_minor: value.postedMinor, reserved_delta_minor: value.reservedDeltaMinor, available_minor: value.availableMinor };
  // These operation results have only canonical, structural fields (no arbitrary metadata).
  const snake = (input: any): any => {
    if (input instanceof Date || typeof input !== 'object' || input === null) return input;
    if (Array.isArray(input)) return input.map(snake);
    return Object.fromEntries(Object.entries(input).map(([key, child]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), snake(child)]));
  };
  return snake(value);
}
export function registerLibrary(server: FastifyInstance, services: ApplicationServices, session: (request: FastifyRequest) => Promise<Record<string, any>>) {
  const limiter = new FixedWindowLimiter();
  server.post<{ Body: LibraryCall }>('/demo/library/execute', {
    bodyLimit: 1024 * 1024,
    errorHandler(error, _request, reply) {
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'PAYLOAD_TOO_LARGE', message: 'Library request exceeds the 1 MiB limit' });
      throw error;
    },
    schema: { body: { type: 'object', additionalProperties: false, required: ['operation', 'input'], properties: {
      operation: { type: 'string', enum: libraryOperations.map(item => item.operation) }, input: { type: 'object', additionalProperties: true },
    } } },
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const origin = request.headers.origin;
    let sameOrigin = !origin || request.headers['sec-fetch-site'] === 'same-origin';
    try { sameOrigin ||= new URL(origin!).host === request.headers.host; } catch { /* Invalid origins remain denied. */ }
    if (!sameOrigin || request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Same-origin library execution required' });
    const row = await session(request);
    request.tenantId = row.tenant_id;
    request.apiKeyId = row.api_key_id;
    const decision = limiter.consume(row.api_key_id, { maxRequests: 600, windowSeconds: 60 });
    if (!decision.allowed) throw new RateLimitExceededError(decision.retryAfterSeconds);
    const call = request.body;
    const forbidden = (input: any): boolean => {
      if (Array.isArray(input)) return input.some(forbidden);
      if (!input || typeof input !== 'object') return false;
      return Object.entries(input).some(([key, value]) => ['tenantId', 'tenant_id', 'actorId', 'actor_id', '__proto__', 'constructor', 'prototype'].includes(key) || (!['metadata', 'raw', 'attributes'].includes(key) && forbidden(value)));
    };
    if (forbidden(call.input)) invalid('Tenant and actor are supplied by the authenticated sandbox');
    const entry = operationDefinition(call.operation);
    let rest;
    try { rest = toRestRequest(call); } catch { return invalid('Invalid library arguments'); }
    const url = new URL(rest.path, 'http://demo.invalid');
    const schema = schemas.get(call.operation)!;
    const validate = (schema: any, value: any) => {
      if (!request.compileValidationSchema(schema)(value)) invalid('Invalid library arguments');
    };
    if (entry.parameter) validate({ type: 'object', required: ['id'], properties: { id: schema.parameter ?? { type: 'string', format: 'uuid' } } }, { id: call.input[entry.parameter] });
    if (rest.method === 'POST') {
      if (call.operation.startsWith('adjustments.')) rest.body!.actor_id = row.api_key_id;
      validate(schema.body, rest.body);
    } else validate(schema.query, Object.fromEntries(url.searchParams));
    // Round-trip rejects misspelled/snake_case argument names instead of silently dropping them.
    const canonical = toLibraryCall(rest).input;
    const sorted = (value: any): any => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
    if (JSON.stringify(sorted(canonical)) !== JSON.stringify(sorted(call.input))) invalid('Use the displayed camelCase library arguments');
    const fields = filterNames[call.operation];
    let where: unknown;
    if (fields && call.input.where !== undefined) {
      where = http.readWhereParameter(url.pathname + url.search, (http as any)[fields]);
      if (where === null) invalid('Invalid filter');
    }
    // Public filter parsing must precede bigint/date conversion of editable arguments.
    let args: any[];
    try { args = libraryArguments(call, row.tenant_id, row.api_key_id); }
    catch { return invalid('Invalid typed library arguments'); }
    if (fields && call.input.where !== undefined) args[0].where = where;
    if (entry.method === 'GET' && schema.query.properties.limit && args[0]?.limit === undefined) args[0].limit = 50;
    const [serviceName, method] = call.operation.split('.');
    const service = (services as any)[serviceName];
    const value = await service[method](...args);
    return { result: serialize(normalize(call.operation, value)), value: serialize(value), call: { operation: call.operation, input: serialize(entry.positional ? { ...call.input, tenantId: row.tenant_id } : args[0]) } };
  });
}
