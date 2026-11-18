// Runs only against an explicitly selected evaluation host. Never logs credentials or payloads.
import { runPublicDemoCheck } from './public-demo-check.mjs';
try {
  const mode = process.argv.includes('--liveness') ? 'liveness' : process.argv.includes('--read-only') ? 'read-only' : 'smoke';
  console.log(JSON.stringify(await runPublicDemoCheck({ baseUrl: process.env.PUBLIC_DEMO_URL, mode, expectedReleaseSha: process.env.EXPECTED_RELEASE_SHA })));
} catch (error) {
  console.error(JSON.stringify({ check: 'public_demo', ok: false, step: error.step }));
  process.exitCode = 1;
}
