# LL-133 local verification record

Scope: implementation working tree on `codex/ll-133-public-hosting`, based on main `b85481b`.
These results are local evidence, not a completed live Render/Neon rollout.
The CI API process cleanup was subsequently corrected to stop the listening Node process directly;
integration → all 20 E2E tests passed sequentially with explicit port-release verification.

| Check | Result |
| --- | --- |
| Unit tests | 17 passed |
| Real PostgreSQL integration | Passed: sandbox 99 HTTP requests, Library workflows, mixed-mode quotas, retries, rollback, isolation and expiry |
| Chromium | 20 passed, including landing → release guides → posting → pilot contact link |
| Public-host PostgreSQL test | Fresh setup and existing-installation upgrade passed using a separate temporary PostgreSQL 16 cluster; prior opening balances/history preserved |
| Public-host safety | Non-owner RLS; denied DDL/TRUNCATE/cleanup; inaccessible canary; tenant/hour/concurrent seed limits; refusal of non-sandbox identities/unreviewed schema; restricted cron reset; old-token invalidation |
| TypeScript / OpenAPI / generated types / schema snapshot | Passed |
| Application build | Passed |
| Render web and cleanup Docker builds | Passed |
| Render nginx image tests | Passed: untrusted forwarding ignored, explicit trusted peer handling, Host/HTTPS forwarding, metrics denied, invalid broad trust rejected |
| Ingress body bounds | Exact 1 MiB accepted; next byte rejected before upstream for Content-Length and chunked REST/Library |
| Production dependency audit | `npm audit --omit=dev`: zero reported vulnerabilities after Fastify 5.12.8 / fast-uri patch updates |
| Configuration | Deployment/workflow YAML parses; shell syntax and git whitespace checks pass |

The public-host test creates fresh `luxledger_demo_hosted` / canary databases in an explicitly
selected local non-default-port cluster, refuses existing installations and removes only its own
fixtures. Reproduce with `PUBLIC_HOST_TEST_ADMIN_URL` set securely to that throwaway cluster's
`postgres` database, then `npm run test:public`. Do not point it at Neon or a shared production cluster.

Render ingress tests run in the built image with `tests/ingress` mounted read-only, as automated
in `.github/workflows/verify.yml`. No database or public listener is required for those image tests.

Not yet verified: live Neon managed-role setup and grants, actual Render Blueprint application,
same-SHA web/cron deployment, DNS/managed HTTPS/Cloudflare boundary, real scheduled cleanup,
notification delivery, account resource/billing limits and operating recovery. Follow
[PUBLIC_DEMO.md](PUBLIC_DEMO.md) and retain sanitized live acceptance evidence before closing LL-133.
