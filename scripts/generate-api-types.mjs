import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
const spec = parse(await readFile(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'));
const literal = value => JSON.stringify(value);
function type(schema = {}) {
  if (schema.$ref) return schema.$ref.split('/').at(-1);
  let result;
  if (schema.enum) result = schema.enum.map(literal).join(' | ');
  else if (schema.oneOf || schema.anyOf) result = (schema.oneOf ?? schema.anyOf).map(type).join(' | ');
  else if (Array.isArray(schema.type)) result = schema.type.map(t => type({ ...schema, type: t, nullable: false })).join(' | ');
  else if (schema.type === 'array') result = `Array<${type(schema.items)}>`;
  else if (schema.type === 'object' || schema.properties) {
    const fields = Object.entries(schema.properties ?? {}).map(([name, s]) => `${literal(name)}${schema.required?.includes(name) ? '' : '?'}: ${type(s)};`);
    const extra = schema.additionalProperties;
    if (extra === true || (typeof extra === 'object' && !fields.length)) fields.push(`[key: string]: ${extra === true ? 'Json' : type(extra)};`);
    result = fields.length ? `{ ${fields.join(' ')} }` : 'Record<string, Json>';
  } else result = ({ string: 'string', integer: 'number', number: 'number', boolean: 'boolean', null: 'null' })[schema.type] ?? 'Json';
  return schema.nullable && !result.includes(' | null') ? `${result} | null` : result;
}
let output = '// Generated from openapi/openapi.yaml. Run npm run generate:api; do not edit.\n';
output += `export const apiVersion = ${literal(spec.info.version)};\n`;
output += 'export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };\n';
for (const [name, schema] of Object.entries(spec.components.schemas)) output += `export type ${name} = ${type(schema)};\n`;
const target = new URL('../apps/web/src/generated-contract.ts', import.meta.url);
if (process.argv.includes('--check')) assert.equal(await readFile(target, 'utf8'), output, 'Generated API types are stale; run npm run generate:api');
else await writeFile(target, output);
console.log('OpenAPI client types are current');
