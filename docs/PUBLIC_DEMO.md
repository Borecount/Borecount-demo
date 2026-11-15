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
                             Render Cron Job (every 5 minutes, cleanup role)
```

`render.yaml` defines one bounded web instance and one cleanup cron. Render supplies TLS,
health-based routing/restarts, service resource limits and notifications. Neon supplies the
separate database/compute boundary. There is no Caddy/VPS/Docker Compose requirement for this
public deployment. The existing `compose.hosted.yml` remains the separate private/local demo.

The web service gets **only** the runtime DB credential and JWT signing secret. Cron gets **only**
the cleanup DB credential. Neither receives the migration owner, Neon API token, production DB
URL or production privileges. Keep demo and SaaS in separate Neon projects; do not branch from
production data. Merely renaming a database in a production project is not this isolation model.

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
   verified-TLS connection in its corresponding Render service. The migration owner can remain
   NOLOGIN when migrations are run via the managed admin's explicit SET ROLE.
5. Keep the old Render connection active until replacement permissions are verified. Update the
   existing service and add cleanup cron; no project, domain, certificate or paid web-plan migration
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
It is operator-only: **do not put either admin or owner URL in Render web/cron settings**. Role
setup intentionally fails if roles/database already exist; review an existing installation rather
than adopting it or resetting it silently. Preparation is idempotent and does not postpone reset.
A DB initialized before the 0.8.0 squashed baseline requires reviewed migration or intentional
replacement of the disposable installation, not blind replay.

## Configure and release on Render

Use `render.yaml` to configure our existing `borecount-demo` and `borecount-demo-cleanup` cron.
Blueprint service names can match existing services; review that mapping before applying. For
existing Blueprints, add new `sync: false` secrets manually—Render prompts only on initial creation.
See [Blueprint configuration](https://render.com/docs/blueprint-spec).

Web settings:

- `DATABASE_URL`: direct verified-TLS URL as `borecount_demo_runtime`.
- `JWT_SIGNING_KEY`: independent unpadded base64url encoding of 32+ random bytes.
- `PUBLIC_DEMO=true`, `TRUSTED_PROXY_CIDRS=127.0.0.1/32`, bounded pool of 5 connections.
- `RENDER_TRUSTED_PROXY_CIDRS`: only verified immediate Render ingress peer IPs/CIDRs. Empty
  safely ignores incoming forwarding chains and shares the ingress IP's abuse/session budget.
- `VITE_PUBLIC_URL=https://borecount.dev/` (build input), `/ready` health check, one instance,
  0.5 CPU / 512 MiB service plan, 30-second shutdown allowance.

Cron settings: same reviewed code release, `Dockerfile.cleanup`, own cleanup URL, UTC schedule
`*/5 * * * *`. The image runs once and exits; its total deadline is 45 seconds. Render's cron has
no persistent disk requirement. See [Render cron](https://render.com/docs/cronjobs).

Remove any inherited owner/admin/production URL from the existing web service: Blueprint omission
**does not remove old environment variables**. No public startup migrations run. Prepare the DB
with the owner separately, then deploy the web and cron from the same SHA. Both are manual deploys
(`autoDeployTrigger: off`) to prevent an uncoordinated schema/cleanup rollout.

`Verify host` checks unit/contracts/schema/types/build, real PostgreSQL workflows, Chromium and the
restricted public-host lifecycle. `Build Render demo release` requires those checks, then builds
matching SHA-tagged web/cron images and records their digests as `public-release.txt`. Render can
build the Dockerfiles from the same selected Git SHA; alternatively configure image-based services
with those exact digests. Record SHA, digests, migration journal, package/contract versions and time.
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

Every five minutes cron calls one fixed-target function. Once the persisted 24-hour deadline is
due, it atomically truncates **all reviewed financial/session tables of this disposable installation**.
This is whole-demo reset, not deletion of a customer's immutable tenant history. The function uses
a fixed search path and explicit tables; it never disables triggers or uses CASCADE. Marker and
migration and rolling-hour admission history survive. Unexpected tables, foreign dependencies, non-sandbox tenants or
non-SERVICE credentials fail closed. Cleanup has no direct table, schema, role-management or
TRUNCATE permission and no production credentials. Old keys/tokens cease working after reset.

The reset may briefly lock tables/end active sessions. Failure retries at the next scheduled run;
readiness fails if the reset deadline is more than 15 minutes overdue. Render cron failures and web
readiness must notify our operator. Cleanup errors report only an allowlisted SQLSTATE/application
code and static reason category (for example `P1303` / `non_sandbox_data`, `P1304` / `schema_drift`,
`42501` / `permission`, `55P03` / `lock_timeout`), never raw messages, queries or credentials.
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
returns 503 if retained-tenant or rolling-hour capacity is exhausted or cleanup is overdue, even
when `/ready` still reports database health. The probe creates/reserves no sandbox and consumes
no creation quota. It is a current capacity snapshot, not a reservation for a future request.

Set repository variable `PUBLIC_DEMO_URL` to enable the 15-minute **Public demo availability**
workflow. Enable operator GitHub Actions failure notifications and Render web/cron deploy/run
notifications. A missing URL deliberately disables network checks. Verify actual notification
delivery; repository configuration alone does not establish an operating alert channel.

Render's `/ready` HTTP health checks gate deployment and restart unhealthy web instances; the
entrypoint exits if either nginx or API stops. See [Render health checks](https://render.com/docs/health-checks).
Cron and database incidents need separate investigation. Monitor 5xx, p95 latency, 429s, OOM/CPU,
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
| Render cron | 8640 starts/30 days; aim <5 seconds each, 12 active hours/month; minimum charge applies |
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
Render scheduler, live certificate, DNS/Cloudflare configuration, alerts or actual monthly bill.

Before closing LL-133, record sanitized project/service IDs, same-SHA web/cron deployments, direct
Neon role/security checks, real HTTPS smoke, fresh private-browser path, a scheduled reset,
notification delivery, recovery and idle resource/cost measurements. Live operations require access
to our Render/Neon accounts; local CI alone is insufficient evidence.
