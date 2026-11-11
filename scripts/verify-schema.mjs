import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../apps/api/src/demo/schema.ts';
const previous = JSON.parse(await readFile(new URL('../drizzle/meta/0003_snapshot.json', import.meta.url), 'utf8'));
const current = generateDrizzleJson(schema, previous.id);
assert.deepEqual(await generateMigration(previous, current), [], 'Installed library / host schema has drifted from the checked-in migrations');
console.log('Library and sandbox schema match the migration snapshot');
