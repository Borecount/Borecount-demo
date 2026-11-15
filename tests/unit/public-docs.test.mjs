import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
test('published README, architecture and nested guides retain resolvable local links', async () => {
  execFileSync(process.execPath, ['scripts/build-public-docs.mjs'], { cwd: root });
  const out = join(root, 'apps/web/public/guides');
  const files = ['README.md', 'ARCHITECTURE.md', ...(await readdir(join(out, 'docs'))).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
  let checked = 0;
  for (const file of files) {
    const content = await readFile(join(out, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (/^(?:[a-z]+:|\/|#)/i.test(href)) continue;
      const target = resolve(dirname(join(out, file)), decodeURIComponent(href.split(/[?#]/)[0]));
      assert.ok(!relative(out, target).startsWith('..'), `${file} escapes published guides: ${href}`);
      await access(target).catch(() => assert.fail(`${file} has a broken published link: ${href}`));
      checked++;
    }
  }
  assert.ok(checked > 10, 'Check the actual cross-document link graph');
  assert.equal(await readFile(join(out, 'openapi/openapi.yaml'), 'utf8'), await readFile(join(root, 'openapi/openapi.yaml'), 'utf8'));
});
