# Hosted Demo Runbook

This runbook deploys the interactive console as three containers:

```text
browser → nginx (web + same-origin proxy) → Fastify API → PostgreSQL 16
```

It is a private sales demo, not a production SaaS deployment. Put port 8080 behind HTTPS and
access control supplied by the hosting platform, VPN, or identity-aware proxy. Do not expose it
as an anonymous public service.

## Configure

Copy the example without committing the resulting secret file:

```sh
cp .env.hosted.example .env.hosted
```

Generate independent secrets:

```sh
openssl rand -hex 32
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

Use the first value as `POSTGRES_PASSWORD` and the base64url value as `JWT_SIGNING_KEY`.
URL-encode the database password when placing it inside `DATABASE_URL`. No admin bootstrap key
is needed for private sandbox sessions.

## Start and verify

```sh
docker compose --env-file .env.hosted -f compose.hosted.yml up -d --build
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
curl -fsS http://127.0.0.1:8080/demo/contract > /dev/null
```

The API container applies checked-in migrations before it accepts traffic. Each visitor's private
tenant, ledgers, accounts, and opening transactions are provisioned when they create a sandbox.
Restarting containers does not reset customer-visible state.

Only nginx publishes a host port. PostgreSQL and the API remain on the private Compose network.
The browser never receives `JWT_SIGNING_KEY`.

## Start a guided call

Open the UI in a private window or click **New sandbox**. This creates a private tenant and revokes only this browser's previous service credential. In the USD ledger Alice starts at 100.00 and Bob at zero; in the EUR ledger Eva starts at 175.00 and Leo at zero.

Private sessions last eight hours. Replaced/expired tenant history is retained; this demo does not
include a reset command or a production data-retention service. Use your separately reviewed
infrastructure procedures to retire a disposable demo database. See
[OPERATIONS.md](OPERATIONS.md#private-sandbox-lifecycle).

## Operate

```sh
docker compose --env-file .env.hosted -f compose.hosted.yml ps
docker compose --env-file .env.hosted -f compose.hosted.yml logs --tail=200 api
docker compose --env-file .env.hosted -f compose.hosted.yml restart api web
```

Before each call, verify `/ready`, open the UI in a private window, and follow
[SALES_WALKTHROUGH.md](SALES_WALKTHROUGH.md).

Back up the PostgreSQL volume before upgrades. Deploy a single API replica: migrations and the
process-local quotas/concurrency guards in this reference deployment are intentionally not designed for
multi-replica orchestration.

The free LL-134 controls and all configuration units/defaults are documented in
[OPERATIONS.md](OPERATIONS.md#rate-limits). Both execution modes share authenticated tenant budgets.
Before widening access, configure the actual trusted nginx peer/network and verify the forwarding
boundary; an empty allowlist intentionally shares the proxy IP abuse bucket. Production cookies are
always Secure. Host tests do not establish deployed TLS, ingress or public-sandbox acceptance.
Public exposure, storage lifecycle/cleanup and shared-VPS isolation remain LL-133; the full independently
operable self-hosted installation/upgrade/backup/restore lifecycle remains LL-132.
