# Borecount Demo Architecture

This repository is a composition root, not a second implementation of ledger rules. Its purpose is to show how the published Borecount packages become a deployable HTTP service.

## Boundaries and dependency direction

```text
client
  │ HTTP + JWT
  ▼
demo API (apps/api/src/index.ts, apps/api/src/api/*)
  ├─ process lifecycle, configuration, auth/rate-limit hooks, probes, metrics
  └─ registers @borecount/fastify-routes
                │ validates/translates transport
                ▼
          @borecount/http
          route specs, schemas, DTO contracts, error serialization
                │
                ▼
          @borecount/core
          entities, invariants, use-case services, repository ports
                ▲
                │ implements ports
     @borecount/postgres-adapter
     Drizzle repositories, schema, PostgreSQL transaction/tenant context
                │
                ▼
            PostgreSQL
```

- **Core boundary:** ledger invariants and application workflows. It has no Fastify or PostgreSQL concern.
- **HTTP boundary:** canonical transport contracts and route specifications. Request/response DTOs must not be redefined in this app.
- **Fastify boundary:** binds the HTTP route specifications to core services and maps Fastify requests/replies. Borecount also publishes an Express adapter, but this demo registers exactly one framework adapter: Fastify.
- **PostgreSQL boundary:** persists tenants, keys, ledgers, accounts, entries, holds, snapshots, and reconciliation data; implements repository ports with Drizzle.
- **Demo boundary:** environment parsing, dependency wiring, authentication hooks, in-process rate limiting/metrics, public documentation routes, and process shutdown.

Changes to business rules belong in the relevant Borecount package. Demo code should remain wiring or operations code unless a demo-specific defect is proven.

## Reference application layer

`apps/api/src/demo/sandbox.ts` owns private demo provisioning: a tenant, SERVICE credential, USD/EUR assets and ledgers, and deterministic opening balances. It persists only a hash of the HttpOnly session secret in the host-owned `demo_sessions` table. Financial seed postings use public library services; tenant/key provisioning belongs to the host because it is not exposed by the released REST API.

The browser sends financial reads/writes directly to canonical `/v1/*` routes. Frontend DTOs are generated from the installed OpenAPI, and CI verifies both canonical YAML equality and generated-type freshness. Human-readable account names are labels; canonical requests carry UUIDs, signed minor-unit strings, references, metadata and timestamps.

`GET /demo/session` renews the short-lived bearer until the fixed eight-hour session expiry. Replacing a sandbox provisions a new tenant and revokes only the old service key. A host auth hook also enforces the persisted session boundary on `/v1` calls. The browser never receives the bootstrap ADMIN key. The only presentation SQL read, `/demo/session/holds`, is scoped by cookie-authenticated tenant and requested ledger, paginated, and establishes transaction-local RLS context. The library has no public hold-list operation; all hold mutations use the canonical adapter.

Swagger UI assets are served locally under `/docs/`. The presentation JSON at `/demo/contract` derives from canonical OpenAPI, adds resource grouping and a same-origin server URL, and leaves `/openapi.yaml` unchanged. Embedded `?demo=1` execution refreshes a session bearer and reports redacted request/response data to the parent journal; the parent validates message origin and frame identity.

Legacy `demo-service.ts` wrappers and `POST /demo/reset` remain registered only outside production for backwards-compatible examples/tests. Global reset truncates the dedicated database and is never used by the new browser or one-command launcher. Whole-database maintenance reset is a separately guarded operator command. See [CONSOLE.md](docs/CONSOLE.md) and [OPERATIONS.md](docs/OPERATIONS.md).

## Tenancy and authentication flow

1. `bootstrap:admin-key` atomically creates the initial tenant and hashed `ADMIN` API key only when `api_keys` is empty.
2. The client sends the raw key only to `POST /v1/auth/token` as `x-api-key`.
3. The API-key service authenticates the hash and resolves `tenantId`, `apiKeyId`, and role.
4. The demo signs an HS256 JWT containing issuer, API-key ID (`sub`), `tenant_id`, role, `iat`, and `exp`. With the documented configuration, `exp - iat = 900` seconds.
5. Every other `/v1/*` request verifies the signature, issuer, time window, and role, then calls `assertAccessTokenIsActive`. Consequently revoking the backing key invalidates an already-issued JWT on its **next authenticated request**, rather than waiting for expiry.
6. The authenticated tenant ID is passed to application services. PostgreSQL tenant transactions establish tenant context and repository queries scope records by tenant. A caller cannot choose a tenant ID in a request body.
7. `/v1/admin/*` additionally requires role `ADMIN`; `SERVICE` may call non-admin `/v1/*` routes. Public probes, metrics, OpenAPI, and docs do not require authentication.

The raw bootstrap or newly created API key is a secret. The create-key response is the only opportunity to capture a generated key; stored records contain a hash.

## PostgreSQL transaction boundaries

The adapter wraps each repository operation in a PostgreSQL transaction. Tenant-scoped operations use `runTenantTx`, which sets tenant context for that transaction.

- Single transaction posting writes the transaction, entries, balances, and balance snapshots atomically.
- `POST /v1/transactions/bulk` uses one transaction for the entire batch (maximum 100). Any failing item rolls back all earlier items.
- Correction creates its reversal and replacement within one transaction.
- Hold create, commit, and void each lock/update the relevant state and balance snapshots in one transaction; hold commit and its posted transaction are atomic.
- Reconciliation upload, rule creation, and run persistence each have an operation-level transaction.
- Initial tenant/admin bootstrap is atomic.

Idempotency resolution occurs inside the same transaction as writes. A reference collision with a different canonical payload fails; it never mutates the original transaction.

## Validation and error mapping

There are three layers:

1. Fastify/JSON-schema validation rejects malformed transport input with `400 INVALID_INPUT`.
2. Core domain/application errors carry stable `code`, `message`, HTTP status, and optional `details`; the demo preserves these fields.
3. Unknown or persistence failures are logged with request context and returned as `500 INTERNAL_ERROR` without leaking internals.

The coordinated package set uses the canonical structural `isDomainError` guard across public export identities. The PostgreSQL and HTTP boundaries preserve valid domain statuses while continuing to hide raw database and unknown errors as non-leaking `500 INTERNAL_ERROR` responses; no demo-specific error restoration is required.

Authentication errors map to `401 UNAUTHORIZED`, authorization to `403 FORBIDDEN`, missing resources normally to `404`, state conflicts to `409`, and rate limits to `429 RATE_LIMIT_EXCEEDED` with both `Retry-After` and `retry_after_seconds`. Every response includes `x-request-id`; a client-supplied `x-request-id` is retained for correlation.

## Deployment topology

```text
              TLS / ingress / load balancer
                         │
              one or more demo API processes
              (stateless except process-local
               limiter and metrics registry)
                         │
                     PostgreSQL 16
```

Run migrations as a release job before starting new API instances. Route traffic only after `/ready` returns 200; use `/health` for liveness. On `SIGTERM`/`SIGINT`, Fastify stops accepting work, drains in-flight requests, then closes the database client, bounded by `SHUTDOWN_TIMEOUT_MS`.

The current limiter and metrics registry are per process. Multiple replicas therefore do not provide a globally shared quota or aggregated metric state; place shared rate limiting at ingress and scrape every replica (or replace these demo components) for production. PostgreSQL 16 is the supported persistence model and the sole durable component. The API serves on `0.0.0.0`; TLS, secret management, network policy, backups, HA, and connection pooling are deployment responsibilities.
