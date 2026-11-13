// Run inside an isolated Node + nginx container with one bundled nginx config mounted.
// INGRESS_TEST_PORT selects the config's listener (8080 for Compose, 10000 for Render).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { setTimeout } from 'node:timers/promises';

const limit = 1_048_576;
const port = Number(process.env.INGRESS_TEST_PORT ?? 8080);
let calls = 0;
const upstream = createServer(async (request, response) => {
  let bytes = 0;
  for await (const chunk of request) bytes += chunk.length;
  calls++;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ bytes }));
});
await new Promise(resolve => upstream.listen(3000, '0.0.0.0', resolve));
let nginx;
try {
  execFileSync('nginx', ['-t'], { stdio: 'inherit' });
  nginx = spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' });
  const closed = once(nginx, 'close');
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5000;
  while (true) {
    try { await fetch(`${url}/health`); break; }
    catch (error) { if (Date.now() >= deadline) throw error; await setTimeout(50); }
  }
  try {
    for (const path of ['/v1/ledgers', '/demo/library/execute']) {
      const accepted = await fetch(url + path, { method: 'POST', body: Buffer.alloc(limit, 'x') });
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), { bytes: limit });
      const before = calls;
      for (const chunked of [false, true]) {
        const bytes = Buffer.alloc(limit + 1, 'x');
        const body = chunked ? Readable.from([bytes.subarray(0, limit), bytes.subarray(limit)]) : bytes;
        const rejected = await fetch(url + path, { method: 'POST', body, ...(chunked ? { duplex: 'half' } : {}) });
        assert.equal(rejected.status, 413);
        assert.match(rejected.headers.get('content-type'), /^application\/json/);
        assert.match(rejected.headers.get('x-request-id'), /^[a-f0-9]{32}$/);
        assert.deepEqual(await rejected.json(), { error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
        assert.equal(calls, before, 'Ingress rejects oversize bodies before upstream dispatch');
      }
    }
    console.log(`Ingress ${port}: exact 1 MiB forwarded; next byte rejected with governed JSON for Content-Length and chunked REST/Library requests`);
  } finally {
    nginx.kill('SIGTERM');
    await closed;
    nginx = undefined;
  }
} finally {
  nginx?.kill('SIGTERM');
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
}
