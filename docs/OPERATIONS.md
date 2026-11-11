# Operations Guide

## Environment variables

The demo reads process environment directly. Node forbids `--env-file` in `NODE_OPTIONS`, so local `*:local` npm scripts pass `--env-file=.env` directly to the Node executable. Production runtimes should inject secrets/configuration through their normal secret manager and use the non-local scripts.

| Variable | Required/default | Constraints and purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required by adapter/migrations | PostgreSQL connection URL for API, bootstrap, and migrations. |
| `DATABASE_URL_TEST` | Not used by normal API | Conventional URL for local test PostgreSQL on port 5433. |
| `DB_POOL_MAX` | `10` | Positive integer maximum connections in the process-local PostgreSQL pool. |
| `DB_IDLE_TIMEOUT` | `20` | Positive integer idle connection timeout in seconds. |
| `DB_CONNECT_TIMEOUT` | `10` | Positive integer connection timeout in seconds. |
| `NODE_ENV` | `development` in example | Runtime mode used by the API and build tools. |
| `PORT` | `3000` | Positive integer; server binds `0.0.0.0`. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Positive integer hard deadline for graceful shutdown. |
| `JWT_SIGNING_KEY` | **Required** | Unpadded base64url encoding of at least 32 random bytes. Secret. |
| `JWT_PREVIOUS_SIGNING_KEYS` | Empty | Comma-separated valid old signing keys; no duplicates and must exclude current key. |
| `JWT_ISSUER` | `borecount-api` | Issuer written to and required from access tokens. |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Integer 300–900; the supported/documented demo profile is exactly `900`. |
| `JWT_CLOCK_SKEW_SECONDS` | `5` | Integer 0–60 used for `iat`/`exp` verification. |
| `RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS` | `20` | Positive integer token-exchange requests per source IP/window/process. |
| `RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS` | `60` | Positive integer fixed-window size. |
| `RATE_LIMIT_WRITE_MAX_REQUESTS` | `120` | Positive integer POST `/v1/*` requests per source IP/window/process, excluding separate token policy. |
| `RATE_LIMIT_WRITE_WINDOW_SECONDS` | `60` | Positive integer fixed-window size. |
| `BOOTSTRAP_TENANT_NAME` | **Optional bootstrap utility only** | Initial tenant display name for manually creating an initial ADMIN key. |
| `BOOTSTRAP_ADMIN_KEY_NAME` | `Initial admin key` | Initial key display name when using the optional bootstrap utility. |
| `BOOTSTRAP_ADMIN_API_KEY` | **Optional bootstrap utility only** | Raw initial admin key. Secret; not needed to run the demo or create private sandbox sessions. |

Unknown variables are ignored. Configuration is validated at process startup; invalid values fail fast.

## Rate limits

The token endpoint and write endpoints use separate in-memory, fixed-window policies keyed by client IP. A rejected call returns `429`, `Retry-After`, and:

```json
{"error":"RATE_LIMIT_EXCEEDED","message":"Rate limit exceeded","retry_after_seconds":42}
```

GET requests are not limited by the demo limiter. Counters are neither shared nor persisted, so limits reset on restart and multiply with replica count. Production deployments should use a trusted proxy configuration and shared ingress/gateway limiter; the demo does not process forwarded-IP trust explicitly.

## Health, readiness, and metrics

| Endpoint | Auth | Semantics |
| --- | --- | --- |
| `GET /health` | None | Process liveness only; `200 {"ok":true}`. |
| `GET /ready` | None | Runs `select 1`; 200 when PostgreSQL is reachable, otherwise 503. |
| `GET /metrics` | None | Prometheus text exposition from this process. |
| `GET /openapi.yaml` | None | Checked-in API contract. |
| `GET /docs` | None | Locally bundled Swagger UI; no CDN. `?demo=1` uses the active sandbox credential. |

Metrics include request totals and duration histograms labeled by route/status, authentication failures, and token-issuance failures. The registry is process-local and resets on restart. These endpoints are unauthenticated; restrict them at the network/ingress layer when needed.

Logs are structured JSON and include request ID, tenant/key IDs when authenticated, route, method, status, and duration. Secret values and JWTs are not intentionally logged.

## Graceful shutdown

On the first `SIGTERM` or `SIGINT`, the process:

1. asks Fastify to stop accepting and drain in-flight requests;
2. closes the PostgreSQL client (five-second database close timeout);
3. exits 0 on success.

If the total exceeds `SHUTDOWN_TIMEOUT_MS` (default 10 seconds), the hard-stop timer exits 1. Configure an orchestrator termination grace period longer than this value and remove the instance from readiness/load balancing before termination.

## Migrations and upgrades

Migrations are versioned SQL under `drizzle/`; Drizzle state is under `drizzle/meta/`. Run from the exact application release with the same `DATABASE_URL`:

```sh
npm ci
npm run db:migrate:local
```

For a release:

1. back up the database and test restore;
2. compare installed package versions and the canonical OpenAPI contract with the target Borecount release;
3. rehearse migration against a production-like copy;
4. quiesce incompatible writers if a future migration requires it;
5. run migrations once as a release job, not independently in every replica;
6. deploy API instances and require `/ready` before traffic;
7. run the quickstart/smoke walkthrough and monitor errors/latency.

The 0.8.0 migration chain starts with the squashed upstream baseline. Recreate disposable demo databases initialized by earlier releases before applying it. Durable environments require a separately reviewed data migration. Schema rollback requires a separately reviewed reverse migration or a tested restore.

## Production limitations and non-goals

This is an integration demo and reusable financial-core composition, not a hosted or managed accounting product. In particular:

- no TLS termination, WAF, CORS policy, shared rate limiter, or trusted-proxy setup;
- no built-in secret manager or automated signing-key rotation;
- no PostgreSQL HA, backups, disaster recovery, external pooler, or capacity tuning;
- no distributed traces, alert rules, dashboards, audit export, or log retention policy;
- metrics/rate-limit state is per process and ephemeral;
- `/metrics`, `/docs`, and the OpenAPI contract are public unless the deployment restricts them;
- no FX conversion, currency exponent catalog, tax, fees, settlement orchestration, or general-ledger chart governance;
- only PostgreSQL 16 is supported; alternative persistence adapters are not implemented;
- reporting is limited to the documented ledger, entry, balance-history, and trial-balance surfaces;
- no asynchronous job system/webhooks for reconciliation and no file parser—the caller sends normalized external records;
- the bundled UI is a local reference transfer demo, not a customer identity system, API-key self-service surface, fine-grained authorization system, or tenant lifecycle console;
- no claim of regulatory, accounting-standard, PCI, or jurisdictional compliance.

Core records are not soft-deleted. Reversal/correction are the supported way to preserve immutable posting history. Features absent from the canonical OpenAPI contract must not be inferred from package internals.

Before production use, threat-model the deployment, pin exact package versions, establish database/audit/retention controls, and validate the domain model against the intended accounting policy.

For a private, single-instance sales environment, use the narrower
[hosted demo runbook](HOSTED_DEMO.md). It provisions isolated sandboxes without a shared reset and packages
the demo without claiming production SaaS readiness.

## Private sandbox lifecycle

`POST /demo/session` provisions a private tenant with USD/EUR assets, ledgers, demo accounts, and opening transactions through the public application services, then returns a short-lived SERVICE bearer. A random 256-bit session credential is set as an HttpOnly, SameSite=Strict cookie; only its SHA-256 hash is persisted as host session metadata. TLS ingress supplies `X-Forwarded-Proto: https` so the cookie is Secure. No raw library API key is exposed. `GET /demo/session` refreshes the bearer until the fixed eight-hour session boundary; the API rejects sandbox bearer use after that boundary as well.

New sandbox creation is limited to 20 per source IP per hour per process. Financial writes retain the existing `/v1` limiter. Because forwarded-IP trust is not configured here, visitors behind nginx share the proxy's rate-limit bucket; configure ingress limits / trusted proxy settings before widening access. Browser Origin / Fetch Metadata checks reject cross-site session creation.

Creating a replacement sandbox revokes only its previous service key. It does not mutate another visitor's tenant. The console reads holds through public `/v1/holds` with tenant-scoped authentication, ledger/state filters, and opaque cursor pagination. All financial reads and mutations use the public HTTP contract and application services.

Expired/replaced tenant histories are retained. Session expiry controls access, not storage retention. The demo has no public reset endpoint or database-reset CLI; use a dedicated demo database and manage its lifecycle through separately reviewed infrastructure procedures. Immutable financial history must not be pruned with ad hoc deletes. Back up the database before upgrades. Migrations 0000–0002 come from Borecount v0.8.0. Migration 0003 adds the host session table.

`npm run verify:schema` compares the installed library plus host Drizzle model with the checked-in snapshot. `npm run generate:api` regenerates frontend DTO types after an intentional contract update. Neither changes the downloaded canonical YAML.
