import { readFile, writeFile } from 'node:fs/promises';
import { parseTrustedProxies } from '../apps/api/src/api/resource-protection/trusted-proxies.ts';
try {
  const source = await readFile('/etc/nginx/templates/demo.conf', 'utf8');
  const peers = parseTrustedProxies(process.env.RENDER_TRUSTED_PROXY_CIDRS) ?? [];
  const trusted = peers.map(peer => `set_real_ip_from ${peer};`).join('\n');
  const config = source.replace('# RENDER_TRUSTED_INGRESS', `${trusted}\nreal_ip_header X-Forwarded-For;\nreal_ip_recursive off;`);
  await writeFile('/etc/nginx/conf.d/default.conf', config);
} catch {
  process.stderr.write('Render ingress configuration failed; verify trusted proxy CIDRs\n');
  process.exitCode = 1;
}
