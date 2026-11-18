// Database-free liveness is safe to schedule frequently; other modes wake Neon.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runPublicDemoCheck({ baseUrl, mode = 'smoke', expectedReleaseSha, fetchImpl = fetch }) {
  let step = 'configuration';
  try {
    const base = new URL(baseUrl);
    assert.ok(['liveness', 'read-only', 'smoke'].includes(mode));
    assert.equal(base.protocol, 'https:', 'Public checks require HTTPS');
    assert.equal(base.pathname, '/');
    assert.equal(base.username + base.password + base.search + base.hash, '');
    const get = async (path, options = {}, status = 200) => {
      const response = await fetchImpl(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, status);
      return response;
    };
    step = 'health';
    assert.deepEqual(await (await get('/health')).json(), { ok: true });
    if (mode !== 'liveness') {
      step = 'database readiness';
      assert.deepEqual(await (await get('/ready')).json(), { ok: true });
      step = 'sandbox admission availability';
      assert.deepEqual(await (await get('/demo/availability')).json(), { ok: true });
    }
    step = 'versioned guides and contract';
    const release = await (await get('/guides/release.json')).json();
    assert.match(release.revision, /^[a-f0-9]{40}$/);
    assert.equal(release.simulated, true);
    if (expectedReleaseSha) assert.equal(release.revision, expectedReleaseSha);
    const contract = await (await get('/openapi.yaml')).text();
    assert.ok(contract.includes(`version: ${release.contract}`));
    assert.equal(release.packages, release.contract);
    const guides = await (await get('/guides/')).text();
    assert.ok(guides.includes('PUBLIC_DEMO.md'));
    await get('/guides/docs/PUBLIC_DEMO.md');
    await get('/docs');
    await get('/metrics', {}, 404);
    step = 'landing page';
    const landing = await (await get('/')).text();
    assert.match(landing, /<div id="root">/);
    if (mode === 'smoke') {
      step = 'fresh visitor session';
      const create = async () => {
        const response = await get('/demo/session', { method: 'POST', headers: { origin: base.origin } }, 201);
        assert.match(response.headers.get('set-cookie'), /; Secure/);
        assert.match(response.headers.get('set-cookie'), /HttpOnly/);
        return response.json();
      };
      const first = await create();
      const second = await create();
      assert.notEqual(first.tenant_id, second.tenant_id);
      const call = async (path, session = first, body, status = 200) =>
        (await get(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, status)).json();
      const ledger = (await call('/v1/ledgers')).data.find(item => item.name === 'USD product ledger');
      step = 'cross-tenant rejection';
      await call(`/v1/ledgers/${ledger.id}`, second, undefined, 404);
      await call('/v1/admin/api-keys', first, undefined, 403);
      const accounts = (await call(`/v1/accounts?ledger_id=${ledger.id}`)).data;
      const primary = accounts.find(a => a.code === 'DEMO_PRIMARY');
      const secondary = accounts.find(a => a.code === 'DEMO_SECONDARY');
      step = 'posting/retry/integrity';
      const body = { ledger_id: ledger.id, reference: `public-smoke-${randomUUID()}`, currency: 'USD', entries: [
        { account_id: primary.id, signed_amount_minor: '100', currency: 'USD' },
        { account_id: secondary.id, signed_amount_minor: '-100', currency: 'USD' },
      ] };
      const posted = await call('/v1/transactions', first, body, 201);
      const retried = await call('/v1/transactions', first, body);
      assert.equal(retried.transaction_id, posted.transaction_id);
      assert.equal(retried.created, false);
      await call('/v1/transactions', first, { ...body, entries: body.entries.map(e => ({ ...e, signed_amount_minor: e.signed_amount_minor.replace('100', '101') })) }, 400);
      const balance = await call(`/v1/accounts/${primary.id}`);
      assert.equal(balance.balance_minor, '-9900');
      step = 'cross-site provisioning rejected';
      await get('/demo/session', { method: 'POST', headers: { origin: 'https://untrusted.invalid' } }, 403);
    }
    return { check: mode === 'liveness' ? 'public_liveness' : mode === 'read-only' ? 'public_availability' : 'public_smoke', ok: true, revision: release.revision, packages: release.packages };
  } catch {
    // Discard transport errors: they can contain request data.
    throw Object.assign(new Error('Public demo check failed'), { step });
  }
}
