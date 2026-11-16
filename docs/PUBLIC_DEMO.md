# Our public demo: Render + Neon (LL-133)

This is the deployment/runbook for **our** public Borecount demo at `https://borecount.dev/`,
with the existing Render service `borecount-demo` and a **separate disposable Neon project**.
It is not the customer self-hosted distribution (LL-132).

Use simulated test data only. No customer records, real payment details, production secrets,
financial-service SLA, certification or production-readiness claim. Sessions expire after eight
hours and may end earlier when the whole public sandbox resets daily. Self-hosting guidance is
free; pilots are [manually agreed](mailto:herman.klushin@gmail.com?subject=Borecount%20pilot%20request).

## Architecture and ownership

```text
borecount.dev → Render managed HTTPS → nginx :10000 → API 127.0.0.1:3000
                                                        ↓ runtime role
                                          dedicated Neon PostgreSQL 16
                                                        ↑ restricted function
                             supervised Node worker (same Render container)
```

`render.yaml` defines one bounded web instance. A supervised Node worker schedules cleanup from the
persisted database deadline; no paid Render cron is used. GitHub Actions is an opt-in recovery tool. Render supplies TLS,
health-based routing/restarts, service resource limits and notifications. Neon supplies the
separate database/compute boundary. There is no Caddy/VPS/Docker Compose requirement for this
public deployment. The existing `compose.hosted.yml` remains the separate private/local demo.

The container/supervisor holds both runtime and cleanup credentials. The API receives the runtime
URL and JWT signing secret, with the cleanup secret explicitly removed. The cleanup worker receives
only a small OS-environment allowlist and its cleanup URL mapped to `DATABASE_URL`; it receives no
runtime URL, JWT, bootstrap/admin credential or inherited arbitrary secret. nginx and configuration
receive no database credentials. This is reduced isolation compared with a separate cron service:
process environment separation does not protect against compromise of the container/supervisor.
Neither role receives migration-owner, production or Neon API privileges. Keep demo and SaaS in
separate Neon projects; do not branch from production data.

LL-132/135 own general installation/upgrade/backup/verified restore; LL-134 supplies reusable host
limits; LL-136 covers isolation assurance. Daily disposable reset is not backup or portable tenant
restore (LL-137). Public evaluation does not depend on commercial entitlement or SaaS enrollment.

## Update our existing deployment first

Our existing Neon project is dedicated to the demo and already contains `luxledger_demo_hosted`.
Reuse that project, database, Render service `borecount-demo` (`srv-d9j1um3eo5us73anf95g`),
current paid compute plan, domain and certificate. Do not run `neon-init.sql` against it.

1. Verify actual table owners, migration history and that all identities are sandbox SERVICE data.
2. Review/run `deploy/public/neon-upgrade.sql` as the current managed admin. It creates three
   initially passwordless roles, transfers only the existing public/drizzle application objects,
   and sets query/lock timeouts. It does not create/reset a database or delete financial data.
   If a lock/schema/identity guard fails, the transaction rolls back; investigate rather than reset.
3. Set `DATABASE_URL` securely to the managed-admin direct connection and run
   `npm run db:prepare:public`. The tool uses one connection, executes `SET ROLE borecount_demo_owner`,
   checks migration history, runs migrations and installs permissions/marker/functions. It does
   not execute cleanup and does not need a password or LOGIN on the owner role.
4. The account owner securely sets the two operational role passwords and enters each direct
   verified-TLS connection in Render (runtime and separate cleanup secret), retaining the cleanup GitHub Secret for recovery. The migration owner can remain
   NOLOGIN when migrations are run via the managed admin's explicit SET ROLE.
5. Keep the old Render connection active until replacement permissions are verified. Update the
   existing service and configure the embedded cleanup worker; no project, domain, certificate or paid web-plan migration
   is needed. Enable the daily-reset schedule only after reviewing its destructive scope.

The initial-install instructions below apply only to a genuinely new empty project.

## Prepare the dedicated Neon project

Choose PostgreSQL 16 and a region near the Render service. Start from an empty project; do not
reuse the existing private demo database automatically. Record its project/branch/endpoint IDs.

Create the three operational roles with **SQL**, not Neon Console/API role creation: console/API
roles normally inherit `neon_superuser`. See [Neon role management](https://neon.com/docs/manage/roles).
Use the managed project admin only for initial setup:

```sh
# Configure libpq PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGSSLMODE securely for the NEW project.
# Do not put connection secrets in command arguments or shell history.
psql -X -f deploy/public/neon-init.sql
```

The script creates `luxledger_demo_hosted`, three unprivileged roles, and asks for each password
using psql's hidden `\password` prompt. Use independent random passwords. It denies PUBLIC access
to the other user databases in this **dedicated project**, so never run it in a shared production
project. Runtime/cleanup must have no role memberships, including `neon_superuser`.

Use **direct** Neon connection URLs (hostname without `-pooler`) with `sslmode=verify-full`.
This verifies the certificate/hostname instead of merely requesting encryption. Keep migrations
and cleanup on direct connections; pooled/session behavior is outside this profile's validation.
Cleanup accepts only the `sslmode` URL option. It rejects `channel_binding` explicitly because
this adapter does not implement that requirement; it never silently strips it and claims support.
See [Neon pooling limits](https://neon.com/docs/connect/connection-pooling).

From the exact host release, set `DATABASE_URL` securely to a managed admin allowed to
`SET ROLE borecount_demo_owner` (or a direct owner login for a new installation) and run:

```sh
npm ci
npm run db:prepare:public
```

This executes `SET ROLE borecount_demo_owner` on the same connection used for migration history,
Drizzle migrations and permission installation. It then revokes PUBLIC schema/function access,
grants runtime workflows, and installs the marker/admission history/restricted reset functions.
It is operator-only: **do not put either admin or owner URL in Render web or GitHub cleanup settings**. Role
setup intentionally fails if roles/database already exist; review an existing installation rather
than adopting it or resetting it silently. Preparation is idempotent and does not postpone reset.
A DB initialized before the 0.8.0 squashed baseline requires reviewed migration or intentional
replacement of the disposable installation, not blind replay.

## Configure and release on Render

Use `render.yaml` to configure our existing `borecount-demo`. No paid Render cron service is needed.
Blueprint service names can match existing services; review that mapping before applying. For
existing Blueprints, add new `sync: false` secrets manually—Render prompts only on initial creation.
See [Blueprint configuration](https://render.com/docs/blueprint-spec).

Web settings:

- `DATABASE_URL`: direct verified-TLS URL as `borecount_demo_runtime`.
- `PUBLIC_DEMO_CLEANUP_DATABASE_URL`: separate direct verified-TLS URL as `borecount_demo_cleanup`.
- `PUBLIC_DEMO_CLEANUP_ENABLED=true`: embedded worker switch, used only with `PUBLIC_DEMO=true`.
  Only exact `true`/`false` values are accepted; omitted defaults to true in the public profile.
  Typos fail startup. Set false to disable the worker for rollback; private/local profiles never require its secret.
- `JWT_SIGNING_KEY`: independent unpadded base64url encoding of 32+ random bytes.
- `PUBLIC_DEMO=true`, `TRUSTED_PROXY_CIDRS=127.0.0.1/32`, bounded pool of 5 connections.
- `RENDER_TRUSTED_PROXY_CIDRS`: only verified immediate Render ingress peer IPs/CIDRs. Empty
  safely ignores incoming forwarding chains and shares the ingress IP's abuse/session budget.
- `VITE_PUBLIC_URL=https://borecount.dev/` (build input), `/ready` health check, one instance,
  0.5 CPU / 512 MiB service plan, 30-second shutdown allowance.

Credential map:

| Location/process | Credential | Allowed use |
| --- | --- | --- |
| Render container/supervisor | Both separate runtime and cleanup URLs | Launch isolated child environments |
| API | Runtime `DATABASE_URL`, JWT key | Financial demo workflows; no reset |
| Cleanup worker | Cleanup URL mapped to `DATABASE_URL` | Restricted status/reset functions only |
| nginx/configuration | None | Ingress configuration/serving |
| GitHub recovery job | Cleanup Actions secret | Operator opt-in recovery |
| Operator preparation only | Managed admin/owner URL | Reviewed migrations/permissions; never API/worker env |

### LL-150 rollout and recovery scheduler

1. Review and test the scheduler/supervisor SHA before changing live settings. Keep the existing
   runtime URL. Enter the separate cleanup-role URL using Render's operator credential-entry flow;
   do not copy it into logs, chat, source or shell arguments. Existing Blueprints do not prompt for
   newly added `sync: false` secrets automatically.
2. Deploy the reviewed SHA manually with `PUBLIC_DEMO=true` and
   `PUBLIC_DEMO_CLEANUP_ENABLED=true`. No database preparation is needed for this scheduling-only
   change. Verify API, nginx and worker are all running. Check safe `sandbox_cleanup_started` and
   `sandbox_cleanup_scheduled` events against the **existing** stored `next_reset_at`; restarting
   must not change that value. A due startup immediately invokes the guarded cleanup function.
3. The current Actions cleanup can overlap briefly during migration: the database advisory lock
   serializes reset, and the worker rereads the persisted deadline after each invocation. Once the
   embedded worker is verified, set the **GitHub Actions variable**
   `PUBLIC_DEMO_CLEANUP_ENABLED=false`. This variable is separate from Render's same-named switch.
   Do not disable the external read-only `Public demo availability` monitor.
4. Record `sandbox_cleanup_attempt.at`, `next_reset_at`, and `lateness_ms` for the first scheduled
   attempt (target: starts within 60 seconds while the container is healthy), separately from
   `sandbox_database_reset.at` and the following persisted deadline. Record public HTTPS/readiness/
   availability and `npm run smoke:public` results. Do not manually force a live deadline/reset for
   acceptance without explicit approval; use the isolated PostgreSQL fixture for destructive tests.
5. Verify monitoring notification delivery separately. A green Actions run proves neither alert
   delivery nor that the internal scheduler met its deadline.

Retain `.github/workflows/public-cleanup.yml`, its cleanup secret and the portable cleanup image
as operator recovery tools. For recovery, temporarily set the **Actions variable**
`PUBLIC_DEMO_CLEANUP_ENABLED=true`, manually dispatch **Public demo cleanup** on main, inspect the
sanitized result/new deadline, then set that variable false again. Both manual and scheduled runs
use this opt-in; enabling it also temporarily enables its five-minute schedule. The script resets
all disposable demo data if due, so it is not a connectivity probe. GitHub scheduling is best effort
and is not the primary timing guarantee.

Rollback: set the **Render** switch `PUBLIC_DEMO_CLEANUP_ENABLED=false`, restore the previously
reviewed compatible deployment/configuration and re-enable Actions cleanup when needed. Never
restore owner credentials to the API, postpone the stored deadline, or reset/delete the database
as a rollback. Disabling the worker removes timely cleanup until the recovery path succeeds.

Remove any inherited owner/admin/production URL from the existing web service: Blueprint omission
**does not remove old environment variables**. No public startup migrations run. Prepare the DB
with the owner separately, then deploy the reviewed web SHA. Web deployment remains manual
(`autoDeployTrigger: off`). The embedded worker uses the web revision; manual Actions recovery uses main. Review SQL/function
compatibility and record both revisions in rollout evidence.

`Verify host` checks unit/contracts/schema/types/build, real PostgreSQL workflows, Chromium and the
restricted public-host lifecycle. `Build Render demo release` requires those checks, then builds
matching SHA-tagged web/portable-cleanup images and records their digests as `public-release.txt`. Render can
build the web Dockerfile from the selected Git SHA; the portable cleanup image remains available
for another scheduler, while GitHub Actions runs the script directly. Record SHA, digests, migration journal, package/contract versions and time.
No `latest` application tag is used. `/guides/release.json` contains the build's SHA (`RELEASE_SHA`
or Render's `RENDER_GIT_COMMIT`) and coordinated package/contract version `0.8.0`. Published guides preserve the source
`README.md`, `ARCHITECTURE.md`, `docs/` and `openapi/` tree so their relative links resolve.

## Domain, HTTPS and trusted ingress

Connect `borecount.dev` in Render and apply the DNS records Render supplies. Review Cloudflare's
proxy/TLS settings; avoid introducing another forwarding hop without testing it. Verify managed
certificate issuance, HTTP→HTTPS redirect and the canonical domain independently. Render terminates
TLS; nginx forwards HTTPS semantics and overwrites client forwarding data before Fastify sees it.
The API binds loopback only; port 10000 is the public web listener. Cookies are Secure/HttpOnly.

nginx trusts real-IP headers only from `RENDER_TRUSTED_PROXY_CIDRS`, rejects broad/invalid CIDR
configuration and never blindly accepts a client-selected forwarding chain. Verify the actual
Render peer chain and spoofed-header behavior before widening the allowlist. With an empty
allowlist quotas safely aggregate behind the proxy; don't claim per-visitor fairness in that mode.
Public `/metrics` returns 404; operators can inspect API metrics over loopback in a service shell.
Native raw nginx error logging is disabled; application/proxy events omit bodies, headers and URLs.
Render/Neon platform logs and their retention need their own operator privacy settings.

## Sandbox admission and cleanup

Seeding uses released provisioning APIs and one atomic transaction: exactly two ledgers/currencies,
twelve accounts and two opening postings. Only the `PUBLIC_DEMO=true` profile uses the durable
database-serialized admission policy: at most 60 creates in a rolling hour and 500 retained tenants.
Private/local profiles do not apply these lifetime/hourly caps because they have no scheduled reset. Competing seeds return 429 with one-second retry;
capacity rejection creates no tenant. Admission history lives in `demo_ops.sandbox_admissions`,
separate from disposable sessions; it survives both API restarts and daily reset. A failed seed
rolls back its admission row. Only entries older than one hour are pruned. Per-IP and authenticated
REST/Library quotas, a 1 MiB body cap, report concurrency 2/global and 1/tenant, database role query/
lock timeouts and the 5-connection pool also apply. See [OPERATIONS.md](OPERATIONS.md).

The worker opens at most one short-lived cleanup-role connection per check and closes it before
sleeping. At startup it validates the exact database/role/direct verified-TLS URL, reads the expected
marker and valid persisted `next_reset_at`, and samples `clock_timestamp()` in the same query.
It calculates the remaining delay using database time, then uses a relative timer and monotonic
elapsed time (including connection shutdown) so container wall-clock offsets/jumps do not move the
scheduled attempt. No database functions or grants need changing. Normal
operation does not poll every minute/five minutes. At a due deadline it invokes only
`demo_ops.cleanup_due()`; PostgreSQL time, marker, schema/identity guards and advisory lock remain
authoritative. The function atomically truncates **all reviewed financial/session tables of this
disposable installation**. This is whole-demo reset, not deletion of customer immutable history.
It uses fixed tables/search path, no CASCADE or disabled triggers. Marker, migration journal and
rolling-hour admission history survive. Unexpected schema, non-sandbox tenants or non-SERVICE
credentials fail closed. Cleanup has no direct table/TRUNCATE or role-management privileges.

After each invocation the worker rereads status, including after a query failure. A newly advanced
deadline from either worker is used unchanged; failures, busy lock, or a still-due deadline retry
in five minutes. Invalid/missing marker/status/database time never authorizes reset. Early timers
reschedule the future persisted deadline. Attempts do not overlap and have a 45-second deadline;
shutdown clears timers and closes the connection. SIGTERM/SIGINT and unexpected child exits are
supervised, with a bounded termination/kill fallback for all remaining processes.

The reset can briefly lock tables/end sessions. `/ready` and `/demo/availability` retain their
15-minute overdue grace, evaluated with database time rather than the container wall clock;
admission exhaustion may fail availability while readiness stays healthy.
A stopped/unhealthy Render container cannot run this scheduler; restart inspects the stored deadline
and recovers overdue work. This is not a hard real-time guarantee: process suspension, event-loop
stalls or changes to the database clock during sleep can affect timing. The worker rereads database
time when it wakes, without introducing periodic DB polling. This remains a disposable demo
without HA or production SLA.

Safe structured events include startup, scheduled deadline, attempt start/lateness, retry, check,
reset, failure and shutdown. Diagnostics contain only allowlisted codes/categories and timestamps,
never raw exceptions, messages, SQL, credentials or URLs. Attempt events include `database_at` and
database-relative `lateness_ms`; `at`/`scheduled_at` are host-clock diagnostics. Cleanup errors are
logged before rereading status, so a second failure cannot hide the initial code/category.
Monitor retries and overdue attempt starts.
Database admission limits do not bound exact storage bytes:
monitor Neon database growth and WAL/history-retention usage; logical reset does not remove the
provider's retained backup/history immediately. No real data is permitted in this environment.

## Smoke checks, monitoring and recovery

```sh
# PUBLIC_DEMO_URL must be the actual HTTPS origin; EXPECTED_RELEASE_SHA is optional but recommended.
npm run smoke:public
npm run monitor:public
```

Full smoke creates two disposable sessions and verifies HTTPS probes, versioned docs/contract,
Secure cookies, SERVICE admin denial, cross-tenant denial, balanced posting, identical retry,
conflicting retry, final balance and cross-site rejection. It logs only check/release identifiers;
it never sends pilot email. Read-only monitoring also checks `GET /demo/availability`, which
returns 503 if retained-tenant or rolling-hour capacity is exhausted, even when `/ready` remains
healthy. Both endpoints also fail when cleanup is more than 15 minutes overdue. The probe
creates/reserves no sandbox and consumes no creation quota. It is a current capacity snapshot, not a reservation for a future request.

Set repository variable `PUBLIC_DEMO_URL` to enable the 15-minute **Public demo availability**
workflow. Enable operator GitHub Actions failure notifications for monitoring/cleanup and Render web deploy
notifications. A missing URL deliberately disables network checks. Verify actual notification
delivery; repository configuration alone does not establish an operating alert channel.

Render's `/ready` HTTP health checks gate deployment and restart unhealthy web instances; the
supervisor exits nonzero if nginx, API or the enabled cleanup worker stops unexpectedly. See [Render health checks](https://render.com/docs/health-checks).
Scheduler and database incidents need separate investigation. Monitor 5xx, p95 latency, 429s, OOM/CPU,
Neon connections/size/storage, cleanup failures and certificate expiry. Initial thresholds: sustained
5xx >1%, p95 >2 seconds, memory >80%, storage >75% of budget or repeated reset failures. Tune from
real measurements. Readiness checks/monitoring can keep Neon compute awake; budget that idle cost.

Recovery: inspect sanitized logs, service/run status, Neon compute/connections/storage and DNS;
fix the affected configuration/capacity; redeploy the same known-good SHA and rerun smoke. Application
rollback is safe only with a compatible schema. A prior image does not reverse migrations. Use
LL-132/135 for durable backup/restore procedures; intentionally recreating this emptyable demo must
never target a production project/branch/database.

## Monthly budget and capacity triggers

Initial planning envelope, to be reconciled with our actual account before publication:

| Resource | Budget |
| --- | --- |
| Render web | One 0.5-CPU / 512-MiB instance continuously; 365 vCPU-hours and 365 GiB-hours at 730 hours |
| Cleanup | Embedded in existing Render web instance; one daily attempt plus recovery retries; Actions disabled normally; no paid Render cron |
| Neon compute | Separate PostgreSQL 16 project, initial 0.25-CU floor / 0.5-CU ceiling; up to 182.5 CU-hours/month at floor if kept awake |
| Neon logical data | 1 GiB initial alert budget, plus separately measured retained history/WAL |
| Egress | 10 GiB/month initial budget across Render/Neon; measure actual use |

Render/Neon plan availability, charges, build minutes and allowances are account-specific; record
an actual monthly currency estimate and spending alert in the launch record. Reference
[current Render plans](https://render.com/docs/compute-plans) and our Neon billing page rather than
claiming a free/zero-idle-cost deployment. Increase web/Neon capacity when sustained CPU >60%,
memory >80%, p95 misses target, pool saturation persists or storage approaches budget. One web
instance and process-local quotas are deliberate limitations, not HA or a fairness guarantee.

No SaaS colocates in this Neon project. If later colocated, revalidate databases/roles/secrets/reset
targets plus burst/reset behavior against a production canary; shared compute remains an availability
risk. A dedicated project/service is the baseline for this demo.

## Evidence and remaining live acceptance

Local tests cover real PostgreSQL non-owner workflows/RLS, admission/concurrent seed rejection,
restricted cleanup, non-sandbox/schema refusal, inaccessible canary and old-token invalidation;
Chromium covers landing → release guides → transaction → pilot link. Container tests cover nginx
request/forwarding boundaries and Render entrypoint. They do **not** prove a Neon account's grants,
GitHub scheduler, live certificate, DNS/Cloudflare configuration, alerts or actual monthly bill.

Before closing LL-133, record sanitized project/service IDs, reviewed web/cleanup revisions, direct
Neon role/security checks, real HTTPS smoke, fresh private-browser path, a scheduled reset,
notification delivery, recovery and idle resource/cost measurements. Live operations require access
to our Render/Neon accounts; local CI alone is insufficient evidence.
