import * as http from '@borecount/http';
import type { JsonSchema, OpenApiDocument } from '../api/openapi-types';
import type { LibraryOperation } from '../../../../shared/library-types';
import type { LibraryInputSchema } from './library-types';

const opaqueFields = new Set(['metadata', 'raw', 'attributes']);
const camelCase = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function resolveReferences<T>(value: T, document: OpenApiDocument): T {
  if (Array.isArray(value)) return value.map((child) => resolveReferences(child, document)) as T;
  if (!value || typeof value !== 'object') return value;

  const object = value as Record<string, unknown>;
  if (typeof object.$ref === 'string') {
    const referenced = object.$ref
      .slice(2)
      .split('/')
      .reduce<unknown>((parent, key) => (parent as Record<string, unknown>)[key], document);
    return resolveReferences(referenced, document) as T;
  }
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => key !== 'example' && key !== 'xml')
      .map(([key, child]) => [key, resolveReferences(child, document)]),
  ) as T;
}

/** Rename schema properties, not arbitrary data or metadata property names. */
function camelCaseSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...schema };
  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, JsonSchema>).map(([name, property]) => [
        camelCase(name),
        opaqueFields.has(name) ? property : camelCaseSchema(property),
      ]),
    );
  }
  if (Array.isArray(schema.required))
    result.required = schema.required.map((name) => camelCase(String(name)));
  if (schema.items && typeof schema.items === 'object')
    result.items = camelCaseSchema(schema.items as JsonSchema);
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[keyword]))
      result[keyword] = schema[keyword].map((item) => camelCaseSchema(item as JsonSchema));
  }
  return result;
}

function filterSchema(fields: http.FilterFields): JsonSchema {
  const schema = http.whereFieldsToJsonSchema(fields);
  const properties = schema.properties as Record<string, JsonSchema>;
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(properties).map(([wireName, property]) => [
        fields[wireName].target ?? wireName,
        property,
      ]),
    ),
  };
}

/**
 * The editor validates camelCase arguments directly. Constraints still come
 * from released OpenAPI, so amounts, dates, lengths, batch sizes and required
 * fields cannot silently diverge from REST. Context fields never enter this schema.
 */
export function buildLibraryInputSchema(
  document: OpenApiDocument,
  operation: LibraryOperation,
  fields?: http.FilterFields,
): LibraryInputSchema {
  const canonicalPath = Object.keys(document.paths).find(
    (path) => path.replace(/\{[^}]+\}/g, ':id') === operation.path,
  );
  if (!canonicalPath) throw new Error(`Missing OpenAPI path for ${operation.operation}`);
  const path = document.paths[canonicalPath];
  const route = operation.method === 'GET' ? path.get : path.post;
  if (!route) throw new Error(`Missing OpenAPI operation for ${operation.operation}`);

  const parameters = [...(path.parameters ?? []), ...(route.parameters ?? [])].map((parameter) =>
    resolveReferences(parameter, document),
  );
  let schema: LibraryInputSchema;
  if (operation.method === 'POST' && route.requestBody) {
    schema = camelCaseSchema(
      resolveReferences(route.requestBody.content['application/json'].schema, document),
    ) as LibraryInputSchema;
  } else {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const parameter of parameters) {
      if (parameter.in !== 'query' || parameter.name === 'where') continue;
      if (!parameter.schema)
        throw new Error(`Missing query schema: ${operation.operation}.${parameter.name}`);
      properties[camelCase(parameter.name)] = parameter.schema;
      if (parameter.required) required.push(camelCase(parameter.name));
    }
    schema = { type: 'object', properties, required };
  }

  schema.additionalProperties = false;
  const required = new Set(schema.required as string[] | undefined);
  // Adjustment actors come from the session; callers cannot supply even a matching value.
  if (operation.operation.startsWith('adjustments.')) {
    delete schema.properties.actorId;
    required.delete('actorId');
  }
  if (operation.parameter) {
    const parameterSchema = parameters.find((parameter) => parameter.in === 'path')?.schema;
    if (!parameterSchema) throw new Error(`Missing resource ID schema: ${operation.operation}`);
    schema.properties[operation.parameter] = parameterSchema;
    required.add(operation.parameter);
  }
  if (fields) schema.properties.where = filterSchema(fields);
  schema.required = [...required];

  // Ingestion uses library-specific names rather than a simple casing change.
  if (operation.operation === 'reconciliation.ingest') {
    const records = schema.properties.records.items as LibraryInputSchema;
    records.properties.externalId = records.properties.id;
    records.properties.occurredAt = records.properties.date;
    delete records.properties.id;
    delete records.properties.date;
    records.required = (records.required as string[]).map((name) =>
      name === 'id' ? 'externalId' : name === 'date' ? 'occurredAt' : name,
    );
  }
  return schema;
}

/** Use public filter conversion for native Date/bigint values and length limits. */
export function parseLibraryFilter(input: unknown, fields: http.FilterFields): unknown {
  const wireNames = new Map(
    Object.entries(fields).map(([name, field]) => [field.target ?? name, name]),
  );
  const wireFilter = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([name, condition]) => [
      wireNames.get(name) ?? name,
      condition,
    ]),
  );
  return http.parseWhere(JSON.stringify(wireFilter), fields);
}
