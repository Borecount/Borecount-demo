// Runs inside the Render image, with tests mounted read-only. No database or public port needed.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
let calls = 0;
const api = createServer((req, res) => {
  calls++;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ client: req.headers['x-forwarded-for'], protocol: req.headers['x-forwarded-proto'], host: req.headers.host }));
});
await new Promise(resolve => api.listen(3000, '127.0.0.1', resolve));
try {
  for (const trusted of ['', '127.0.0.1/32']) {
    const configured = spawnSync(process.execPath, ['--import', 'tsx', 'deploy/render-configure.mjs'], {
      env: { ...process.env, RENDER_TRUSTED_PROXY_CIDRS: trusted }, encoding: 'utf8',
    });
    assert.equal(configured.status, 0, configured.stderr);
    const nginx = spawn('nginx', ['-g', 'daemon off;'], { stdio: 'ignore' });
    const closed = once(nginx, 'close');
    try {
      for (let n = 0; ; n++) {
        try { await fetch('http://127.0.0.1:10000/health'); break; }
        catch (error) { if (n > 50) throw error; await setTimeout(50); }
      }
      const result = await new Promise((resolve, reject) => {
        const req = request('http://127.0.0.1:10000/v1/ledgers', { headers: {
          host: 'demo.test:10000', 'x-forwarded-for': '192.0.2.99, 198.51.100.7', 'x-forwarded-proto': 'http',
        } }, res => {
          let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
        });
        req.on('error', reject); req.end();
      });
      assert.equal(result.client, trusted ? '198.51.100.7' : '127.0.0.1');
      assert.equal(result.protocol, 'https');
      assert.equal(result.host, 'demo.test:10000');
      const before = calls;
      assert.equal((await fetch('http://127.0.0.1:10000/metrics')).status, 404);
      assert.equal(calls, before, 'Public metrics must not reach the API');
    } finally { nginx.kill('SIGTERM'); await closed; }
  }
  const invalid = spawnSync(process.execPath, ['--import', 'tsx', 'deploy/render-configure.mjs'], {
    env: { ...process.env, RENDER_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }, encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Render ingress configuration failed/);
  console.log('Render ingress passed: untrusted chains ignored, trusted final peer selected, HTTPS/Host preserved, public metrics denied and broad trust rejected');
} finally {
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
}
