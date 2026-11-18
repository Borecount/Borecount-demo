# LL-133 local verification record

Scope: implementation working tree on `codex/ll-133-public-hosting`, based on main `b85481b`.
These results are local evidence, not a completed live Render/Neon rollout.
The CI API process cleanup was subsequently corrected to stop the listening Node process directly;
integration → all 20 E2E tests passed sequentially with explicit port-release verification.

| Check | Result |
| --- | --- |
| Unit tests | 19 passed |
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

## Live Neon preparation (partial)

The existing dedicated demo database was inspected through Neon Console. It contained 17 sandbox
tenants, 17 sessions and 34 opening postings, with no non-sandbox tenants or non-SERVICE keys.
The initial ownership transaction hit a managed-role schema permission error and was rolled back;
verification confirmed zero new roles and unchanged original owners. The corrected order grants
schema ownership before transferring tables and now runs in tests under a NOSUPERUSER admin.
The corrected transaction committed successfully in Neon: three service roles exist, application
objects belong to borecount_demo_owner, and the 17/17/34 counts remain. Passwords were not set.
Runtime grants, cleanup installation/scheduling and Render credential rollout remain separate steps.

Live Neon runtime/cleanup permissions were then installed and committed with user approval.
Metadata checks confirmed: runtime can read accounts but cannot TRUNCATE, CREATE in public,
bypass RLS or execute cleanup; cleanup cannot read/TRUNCATE accounts or CREATE in public and
can execute only the restricted reset/status functions. Account RLS remains enabled and the
17 tenant / 17 session / 34 posting counts are unchanged. The reset function was not invoked;
cron was not configured or started. Credential setup and Render rollout still require completion.

## Review regression checks

All six review findings are covered in the updated implementation and local tests:
private/local provisioning ignores public persistent caps; the same DB can reject public admission
while private provisioning succeeds; the operator CLI uses a managed admin's SET ROLE with a
NOLOGIN owner; rolling-hour admission history survives whole-demo reset and recovers only when
that hour expires; repeated availability probes leave admission history unchanged and return 503
on exhausted capacity while readiness remains 200; cleanup logs only allowlisted code/category
fields; generated README/architecture/docs/OpenAPI relative links resolve both locally and inside
the Render image. The complete npm test pipeline, both PostgreSQL public-host variants, 19 unit
and 20 browser tests, Render/cleanup builds and real nginx image tests passed.

The reviewed SQL was applied through Neon Console on 2026-11-15 with user approval. All four
migration hashes matched the release. Admission history and updated functions committed, with
25 tenants/sessions preserved and two recent admissions backfilled. Runtime claim permission,
cleanup-only reset execution, denied direct cleanup TRUNCATE and enabled account RLS were checked.
Availability was true; the existing reset deadline was unchanged and reset was not invoked.
The user confirmed runtime/cleanup authentication works. Administrator SET ROLE into those two
roles is denied; no extra memberships were granted to bypass that boundary.

## GitHub cleanup scheduler

Cleanup now uses the opt-in main-only `Public demo cleanup` Actions workflow instead of a paid
Render cron. It retains the existing role and reset function, runs serially, and keeps the
15-minute overdue guard. GitHub schedule delays can therefore cause a fail-closed outage.
Live secret installation, explicit schedule activation, first approved reset and notification
verification remain rollout steps; adding the workflow alone does not establish live cleanup.

## LL-150 embedded scheduler (2026-11-16)

The primary implementation now runs a supervised Node worker inside the existing Render web
container. No paid Render cron or SQL/role changes are introduced. Actions remains an opt-in
recovery path; its live variable must remain enabled until the embedded worker is verified.

Local evidence:

- Deterministic clock/timer tests cover future deadlines without polling, overdue startup,
  persisted rescheduling, retry/error/lock-busy-equivalent false results, competing workers,
  container clock offsets/jumps against sampled DB time and monotonic elapsed time,
  invalid marker/status/database time, attempt timeout and shutdown. Regressions cover paired
  cleanup/status failures without losing the original diagnostic, invalid switch values and
  explicit rejection of unsupported channel-binding URL options.
- Real child-process tests cover environment secret canaries, private/public launch profiles,
  all required child exit/spawn failures, signals and bounded forced shutdown.
- Both fresh and upgrade fixtures pass in a disposable local PostgreSQL 16 cluster: real
  advisory-lock contention, overdue readiness/admission refusal, guarded reset, future deadline,
  migration/admission-history preservation, token invalidation and inaccessible canary.
- TypeScript, OpenAPI/generated types, schema checks and web build pass. Render and portable
  cleanup Docker builds and existing image ingress/body-limit checks pass.

Live acceptance is **pending**: operator entry of the separate Render cleanup secret, reviewed
SHA deployment, existing deadline/supervised-process verification, Actions scheduler disablement,
first live scheduled attempt within 60 seconds and its following persisted deadline, HTTPS/sandbox
smoke and actual alert delivery. No live secret, schedule, database deadline or data was changed
for these local tests. See the rollout/rollback procedure in [PUBLIC_DEMO.md](PUBLIC_DEMO.md).


## Idle compute correction (November 2026)

The source now routes Render health checks to database-free `/health`; frequent Actions probes
use liveness, with one daily explicit readiness/admission check. Actions cleanup is manual-only.
Regression tests cover DB-free repeated probes, fresh readiness failure/recovery and 24-hour
scheduler sleep without polling. Fresh/upgrade public PostgreSQL fixtures preserve role, isolation
and overdue-cleanup protections. No database grants or TLS policies change.

Read-only live audit: Render still uses `/ready`; GitHub availability and cleanup workflows are
active, with the cleanup opt-in variable already `false`. Rollout, cold wake/suspend observation
and quota recovery remain pending; local tests do not establish live suspension or restore the
exhausted Neon allowance. Follow [the rollout checklist](PUBLIC_DEMO.md#idle-compute-rollout-and-verification).
