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
| `RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS` | `20` | Integer 1–1000000 token-exchange attempts per source IP/window/process. |
| `RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS` | `60` | Integer 1–86400; fixed-window size in seconds. |
| `RATE_LIMIT_WRITE_MAX_REQUESTS` | `120` | Integer 1–1000000 REST mutations and mutating Library calls per authenticated tenant/window/process. |
| `RATE_LIMIT_WRITE_WINDOW_SECONDS` | `60` | Integer 1–86400; fixed-window size in seconds. |
| `RATE_LIMIT_READ_MAX_REQUESTS` / `RATE_LIMIT_READ_WINDOW_SECONDS` | `600` / `60` | Authenticated reads per tenant/window, including Library reads and session refresh. Same count/window ranges as write policy. |
| `RATE_LIMIT_ABUSE_MAX_REQUESTS` / `RATE_LIMIT_ABUSE_WINDOW_SECONDS` | `1200` / `60` | All `/v1/*`, `/demo/session`, and Library execute attempts per source IP before authentication/body parsing. Includes successful requests; separate from tenant budgets. |
| `RATE_LIMIT_SESSION_MAX_REQUESTS` / `RATE_LIMIT_SESSION_WINDOW_SECONDS` | `20` / `3600` | Same-origin sandbox creation attempts per source IP/window. |
| `RATE_LIMIT_MAX_KEYS` | `10000` | Integer 1–100000; maximum keys in **each** of four independent stores: abuse, token, session, tenant read/write. |
| `REQUEST_BODY_MAX_BYTES` | `1048576` | Integer 1–16777216; decoded request-body bytes for REST, Library bridge and session endpoints. Oversize returns 413. |
| `REQUEST_BULK_MAX_ITEMS` | `100` | Integer 1–100; host cap on transaction bulk items in both modes, before dispatch. May tighten, never raise the canonical maximum of 100. Oversize count returns 400. |
| `REPORT_CONCURRENCY_MAX` | `4` | Integer 1–1000; total in-flight reporting service calls/process. No queue. |
| `REPORT_TENANT_CONCURRENCY_MAX` | `2` | Integer 1–1000, at most global cap; report calls per authenticated tenant. |
| `TRUSTED_PROXY_CIDRS` | Empty | Comma-separated explicit ingress IPs/CIDRs, IPv4/IPv6; no wildcard, boolean, hop-count or `/0`. Empty ignores forwarded IP/protocol. |
| `BOOTSTRAP_TENANT_NAME` | **Optional bootstrap utility only** | Initial tenant display name for manually creating an initial ADMIN key. |
| `BOOTSTRAP_ADMIN_KEY_NAME` | `Initial admin key` | Initial key display name when using the optional bootstrap utility. |
| `BOOTSTRAP_ADMIN_API_KEY` | **Optional bootstrap utility only** | Generated initial admin key (`llk_` followed by 64 lowercase hex digits). Secret; not needed to run the demo or create private sandbox sessions. |

Unknown variables are ignored. Configuration is validated at process startup; invalid values fail fast.

## Rate limits

All resource controls are free host policy, without commercial entitlements. A bounded IP abuse budget runs before authentication and body parsing for REST, session refresh/creation and Library execution. Token exchange and sandbox creation also have separate IP budgets. Tenant accounting follows credential verification (including backing-key revocation and sandbox expiry); caller-supplied tenant headers and resource IDs never choose a bucket.

REST reads and Library reads share the authenticated tenant's read budget. REST mutations and Library mutations share its write budget, regardless of source IP or credentials within that tenant. Library HTTP POST is a transport: the allowlisted operation determines read/write classification. REST non-GET/HEAD routes count as writes, including preview operations. Invalid authentication does not consume tenant budgets. Valid REST and Library inputs are accounted before service dispatch. Schema/parser/argument rejections remain covered by the pre-auth budget.

A rejected quota, full key store or report-concurrency request returns `429`, `Retry-After`, and:

```json
{"error":"RATE_LIMIT_EXCEEDED","message":"Rate limit exceeded","retry_after_seconds":42}
```

The delay is rounded up to whole seconds until the fixed window ends. Windows start with the first accepted attempt, and rejected attempts do not extend them. Concurrency rejection uses a one-second backoff hint, not a prediction of completion. All 5xx responses are sanitized; validation/body-size errors use governed 400/413 envelopes.

Each limiter store has a hard key cap. Expired buckets are reclaimed lazily (at most one full sweep/second; a requested expired key is reclaimed immediately); active buckets are never evicted to admit new identities. At capacity, new keys fail closed until expired keys are swept (up to one additional second). Existing keys keep their counters. Key lengths are bounded to 256 characters and secrets/URLs are never used as keys. Separate abuse/token/session stores prevent unauthenticated key churn from evicting tenant counters. Idle expired keys can remain until the next request, but storage remains bounded. In-flight report state is deleted in `finally`, after awaited service work completes, including failures; client disconnects cannot free a still-running query's permit.

Concurrency protection covers `balances.getAt`, `balances.listHistory`, `balances.getTrialBalance`, `statements.getAccountStatement` and `statements.getCreditLotStatement`, through both REST and Library. It does not create a tenant-export API or a consistent multi-request snapshot. Full tenant export/restore remains LL-137; other expensive operations (notably reconciliation/seeding) currently have rate/body/DB-pool controls, not a dedicated concurrency queue. Transaction/hold entry counts, normalized reconciliation record counts and matching-rule ID counts have no independent host count knobs; their payloads remain bounded by the body-byte cap and canonical validation. The public DB client supports pool/connect/idle knobs above, but no host statement/query execution deadline; configure PostgreSQL `statement_timeout`/`lock_timeout` through the operator-owned database role/session policy and size them for real workloads. Do not use HTTP timeouts as proof that database work has stopped.

### Sizing and topology

This is a **single-process** example: counters and permits are neither persisted nor shared; restarting resets them, and replicas multiply allowances. Distributed coordination, ingress connection/body limits, capacity monitoring and shared limits are operator responsibilities. A shared source IP can exhaust the pre-auth budget even when tenant budgets are isolated. Per-tenant report caps reduce noisy-neighbor impact but global pool/CPU/report capacity remains shared; this is not a fairness or availability guarantee under saturation.

Start with the defaults, then measure peak requests, query duration, memory and PostgreSQL capacity. Keep the global report cap below pool capacity (default 4 versus 10), leaving connections for auth, mutations and readiness. Budget the sum of pools across processes, migrations and operator tools against database `max_connections`. Set per-tenant limits below aggregate service capacity, choose body/bulk limits from payload memory and transaction latency, and size key caps for active tenants/IPs across the longest window. Separate stores allow up to four times `RATE_LIMIT_MAX_KEYS` buckets; each tenant can use two read/write keys. These defaults are a starting profile, not load-test evidence for a particular host.

### Trusted ingress

By default forwarded IP/protocol headers are ignored and visitors behind nginx share its abuse/token/session buckets. To distinguish visitors, set `TRUSTED_PROXY_CIDRS` to the **actual immediate nginx peer IP or narrow dedicated network**, and keep the API port private. The Render sidecar can use `127.0.0.1/32`; Compose requires the deployed nginx peer/network, not a guessed public client range. Do not allowlist networks containing untrusted callers.

Bundled nginx overwrites `X-Forwarded-For` with `$remote_addr` and `X-Forwarded-Proto` with `$scheme`, dropping caller-selected chains. If another load balancer terminates HTTPS first, configure and verify nginx's real-IP/HTTPS handling with that explicitly trusted upstream; do not blindly restore incoming forwarding headers. Fastify trusts forwarding information only from allowlisted peers. Production sandbox cookies are always Secure; local non-production HTTP cookies become Secure only when the trusted request protocol is HTTPS.

Run `npm run test:unit` for bounded, clock-controlled window recovery, capacity/key-churn, concurrent mixed-mode requests, tenant/noisy-neighbor, proxy-spoof and captured-log privacy checks. `npm run test:integration` verifies real PostgreSQL atomicity/retries/isolation plus rejection and retry recovery with the composed host. These are local tests, not deployed ingress or multi-instance verification.

## Health, readiness, and metrics

| Endpoint | Auth | Semantics |
| --- | --- | --- |
| `GET /health` | None | Process liveness only; `200 {"ok":true}`. |
| `GET /ready` | None | Runs `select 1`; 200 when PostgreSQL is reachable, otherwise 503. |
| `GET /metrics` | None | Prometheus text exposition from this process. |
| `GET /openapi.yaml` | None | Checked-in API contract. |
| `GET /docs` | None | Locally bundled Swagger UI; no CDN. `?demo=1` uses the active sandbox credential. |

Metrics include request totals and duration histograms labeled by route/status, authentication failures, and token-issuance failures. The registry is process-local and resets on restart. These endpoints are unauthenticated; restrict them at the network/ingress layer when needed.

Logs are structured JSON and include request ID, tenant/key IDs when authenticated, route, method, status, and duration. Request IDs accept only 1–64 ASCII letters, digits, `_` and `-`; invalid values are replaced with generated UUIDs. Logs use route templates (unmatched paths use `/unmatched`), never query strings, bodies, headers, SQL, raw errors or cause/stack chains. Each 5xx has a correlated safe error event, including adapter-mapped and readiness failures. Error serializers and header redaction provide an additional boundary. Bundled nginx emits only generated request ID, status and duration; its native raw error log is disabled because it can embed request URLs. Operators needing ingress diagnostics must supply a separately reviewed sanitizing collector. External platform/load-balancer logs are outside this application boundary and require their own privacy policy.

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

- no TLS termination, WAF, CORS policy or shared/distributed rate limiter; operators configure the explicit trusted-proxy allowlist;
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

`POST /demo/session` provisions a private tenant with USD/EUR assets, ledgers, demo accounts, and opening transactions through the public application services, then returns a short-lived SERVICE bearer. A random 256-bit session credential is set as an HttpOnly, SameSite=Strict cookie; only its SHA-256 hash is persisted as host session metadata. Production cookies are always Secure; HTTPS/access control remain ingress responsibilities. No raw library API key is exposed. `GET /demo/session` refreshes the bearer until the fixed eight-hour session boundary; the API rejects sandbox bearer use after that boundary as well.

New sandbox creation defaults to 20 attempts per source IP per hour per process. REST and Library share tenant read/write budgets after authentication; pre-auth protection uses source IP with the explicit trusted-ingress policy above. Session creation and Library execution reject explicit cross-site requests and require either `Sec-Fetch-Site: same-origin` or an `Origin` whose host matches the request Host. Requests with neither signal are rejected.

Creating a replacement sandbox revokes only its previous service key. It does not mutate another visitor's tenant. REST mode uses the public `/v1` contract. Library mode invokes the allowlisted application services directly through the same-origin, session-authenticated demo bridge. Both use the active sandbox tenant; the host owns session provisioning while the released packages own financial rules.

Expired/replaced tenant histories are retained. Session expiry controls access, not storage retention. The demo has no public reset endpoint or database-reset CLI; use a dedicated demo database and manage its lifecycle through separately reviewed infrastructure procedures. Immutable financial history must not be pruned with ad hoc deletes. Back up the database before upgrades. Migrations 0000–0002 come from Borecount v0.8.0. Migration 0003 adds the host session table.

`npm run verify:schema` compares the installed library plus host Drizzle model with the checked-in snapshot. `npm run generate:api` regenerates frontend DTO types after an intentional contract update. Neither changes the downloaded canonical YAML.
