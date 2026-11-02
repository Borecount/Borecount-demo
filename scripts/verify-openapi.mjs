import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const installedContract = require.resolve('@borecount/http/openapi/openapi.yaml');
const [canonical, copied] = await Promise.all([
  readFile(installedContract),
  readFile(new URL('../openapi/openapi.yaml', import.meta.url)),
]);

assert.deepEqual(
  copied,
  canonical,
  'openapi/openapi.yaml must be a byte-for-byte copy of @borecount/http',
);
console.log('Demo OpenAPI matches the installed @borecount/http contract');
