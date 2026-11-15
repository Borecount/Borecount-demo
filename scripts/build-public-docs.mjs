import { mkdir, copyFile, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const { dependencies } = JSON.parse(await readFile('apps/api/package.json', 'utf8'));
const version = dependencies['@borecount/core'];
let revision = process.env.RELEASE_SHA || process.env.RENDER_GIT_COMMIT;
if (!revision) {
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { revision = 'unversioned-local-build'; }
}
if (revision !== 'unversioned-local-build' && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('RELEASE_SHA must be a full commit SHA');
const out = 'apps/web/public/guides';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const docs = ['CONSOLE', 'INTEGRATION', 'SCENARIOS', 'OPERATIONS', 'PUBLIC_DEMO', 'HOSTED_DEMO', 'SALES_WALKTHROUGH'];
await cp('docs', `${out}/docs`, { recursive: true });
await mkdir(`${out}/openapi`, { recursive: true });
await copyFile('openapi/openapi.yaml', `${out}/openapi/openapi.yaml`);
await copyFile('README.md', `${out}/README.md`);
await copyFile('ARCHITECTURE.md', `${out}/ARCHITECTURE.md`);
await writeFile(`${out}/release.json`, JSON.stringify({ revision, packages: version, contract: version, runtime: 'Node.js 22', postgres: '16', simulated: true }, null, 2) + '\n');
await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Borecount evaluation guides</title>
<style>body{font:18px/1.6 system-ui;max-width:760px;margin:48px auto;padding:0 24px;background:#f8fafc;color:#172438}a{color:#215dcc}li{margin:12px 0}code{overflow-wrap:anywhere}</style>
<nav><a href="/">Sandbox &amp; pilot contact</a> · <a href="/docs?demo=1">API documentation</a></nav>
<h1>Free evaluation and self-hosting guides</h1><p>Simulated test data only. The public sandbox is disposable, has no uptime guarantee, and cannot accept real funds or customer data. Self-hosting guidance is free; pilots require manual agreement.</p>
<p>Package and API contract version: <strong>${version}</strong><br>Host revision: <code>${revision}</code></p>
<p>These Markdown guides are copied from this exact host release. They remain accessible without signup or commercial enrollment.</p>
<ul>${['README', 'ARCHITECTURE', ...docs].map(doc => `<li><a href="${['README', 'ARCHITECTURE'].includes(doc) ? '' : 'docs/'}${doc}.md">${doc.replaceAll('_', ' ')}</a></li>`).join('')}</ul>
<p><a href="mailto:herman.klushin@gmail.com?subject=Borecount%20pilot%20request">Discuss a manually approved pilot</a></p></html>`);
