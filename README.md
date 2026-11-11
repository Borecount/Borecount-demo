# Borecount Demo

Interactive reference console composing `@borecount/core`, Fastify, Drizzle, PostgreSQL, and React into wallets, marketplace settlement, authorizations, prepaid credits, and finance workflows. The checked-in Borecount contract is [OpenAPI 0.8.0](openapi/openapi.yaml).

The browser sends actual `/v1/*` requests using the released OpenAPI payloads and responses. Each browser session gets an isolated tenant, USD/EUR ledgers, six accounts per ledger, and a short-lived SERVICE token. Bootstrap administrative credentials remain server-side. The **API docs** link opens locally served Swagger UI with authenticated **Try it out** in a separate tab.

See [the console guide](docs/CONSOLE.md) for every scenario, endpoint family, and sandbox boundary.

The wider product guarantees and package boundaries are maintained in the upstream [Borecount documentation](https://github.com/Borecount/Borecount/tree/main/docs). This repository documents the behavior of the exact package set pinned by the demo.

## 10–15 minute quickstart

### Prerequisites

- Node.js 22 and npm 10+
- Docker Engine with Docker Compose v2
- `curl`, `openssl`, and a POSIX shell (`bash` or `zsh`)

Commands below assume the repository root and use `http://localhost:3000`.

### 1. Install and configure

```sh
npm ci
cp .env.example .env
JWT_SIGNING_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
sed -i.bak "s|REPLACE_WITH_BASE64URL_32_BYTE_SECRET|$JWT_SIGNING_KEY|" .env
rm .env.bak
```

Node does **not** read `.env` automatically, and Node forbids `--env-file` inside `NODE_OPTIONS`. The `*:local` npm scripts below pass `--env-file=.env` directly to Node. Do not use `source .env`: secrets or values containing shell metacharacters need not be valid shell syntax.

### One-command demo

After the initial install and `.env` setup above, start PostgreSQL, apply migrations, start API and web with:

```sh
npm run demo
```

When `Borecount demo is ready` appears, open `http://localhost:5173`. Stop API and web with `Ctrl+C`; PostgreSQL remains available for the next run.

The steps below describe the same setup individually for readers learning how the backend is composed.

### 2. Start PostgreSQL and migrate

Version 0.8.0 uses the squashed Borecount migration history. If upgrading an existing disposable local demo, recreate its database before running the steps below. With the default Docker Compose setup, `docker compose down -v` deletes the demo's PostgreSQL volume and all data in it.

```sh
docker compose up -d postgres
docker compose exec postgres pg_isready -U luxledger -d luxledger
npm run db:migrate:local
```

Expected readiness output ends with `accepting connections`; migration output ends successfully with `migrations applied successfully` (or reports that there is nothing left to migrate).

### 3. Start and probe the API

```sh
npm run dev:local
```

In a second shell:

```sh
export BASE_URL=http://localhost:3000
curl -i "$BASE_URL/health"
curl -i "$BASE_URL/ready"
```

Both return `HTTP/1.1 200 OK` and:

```json
{"ok":true}
```

`/health` proves the process is serving. `/ready` also runs `select 1` against PostgreSQL and returns `503` with `{"error":"NOT_READY","message":"Service not ready"}` when the database is unavailable.

### 4. Open the console

Open `http://localhost:5173`. The first visit provisions a private sandbox: Alice starts with 100.00 USD and Bob with zero; Eva starts with 175.00 EUR and Leo with zero.

Choose one of five guided scenarios, or open Accounts, Transactions, Holds, Credits, Reconciliation, and Reports. Every operation exposes editable canonical JSON; the request journal shows real HTTP status, body, timing, and request ID. **New sandbox** provisions a new tenant and revokes only the previous session's credential.

Each browser session provisions a private SERVICE-only tenant and its opening data. The host exposes no shared demo state, financial wrapper routes, or database reset endpoint.

## Automated verification

Install the Playwright browser once:

```sh
npx playwright install chromium
```

Then run the complete verification pipeline:

```sh
npm test
```

The pipeline checks unit helpers, canonical OpenAPI equality, generated client types, schema drift, TypeScript, and the production build. It recreates only `luxledger_demo_test`, checks real `/v1` workflows (isolation, retries, rollback, partial captures, refunds, expiration, statements and reconciliation), then exercises the console, CSV import, Swagger execution and mobile layout in Chromium. The test database guard rejects any `DATABASE_URL_TEST` whose database name is not exactly `luxledger_demo_test`.

Individual commands are `npm run test:unit`, `npm run verify:openapi`, `npm run test:integration`, and `npm run test:e2e`.

Tests live in `tests/unit/`, `tests/integration/`, and `tests/e2e/`. The `scripts/` directory contains setup, database preparation, and other supporting commands.

## Private hosted sales demo

The repository includes a provider-neutral container deployment with a same-origin nginx proxy,
production API settings and per-browser sandboxes.

- [Hosted demo runbook](docs/HOSTED_DEMO.md)
- [Five-minute sales walkthrough](docs/SALES_WALKTHROUGH.md)

The hosted profile is intended for guided sales calls behind HTTPS and access control. It is not
a public multi-tenant SaaS environment.

## Use the API from a private sandbox

Create a private session to get a SERVICE bearer for `/v1/*` calls. No bootstrap admin key is needed:

```sh
export BASE_URL=http://localhost:3000
SESSION="$(curl -fsS -c /tmp/borecount-sandbox.cookies \
  -H "Origin: $BASE_URL" -X POST "$BASE_URL/demo/session")"
export ACCESS_TOKEN="$(printf '%s' "$SESSION" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).access_token')"
```

Send business requests with `Authorization: Bearer $ACCESS_TOKEN`. The token lasts 15 minutes;
renew it using `GET /demo/session` with the saved cookie. The session expires after eight hours.
Continue with the [scenario cookbook](docs/SCENARIOS.md) for public `/v1` examples.

## Continue evaluating

- [Integration guide](docs/INTEGRATION.md): auth, roles, wire conventions, pagination, and errors.
- [Scenario cookbook](docs/SCENARIOS.md): failure modes, bulk atomicity, reversal/correction, holds, backdating, and reconciliation.
- [Operations guide](docs/OPERATIONS.md): environment, probes, metrics, shutdown, migrations, and production limitations.
- [Architecture](ARCHITECTURE.md): package boundaries, tenancy, transactions, error mapping, and deployment.
- Upstream references: [product overview](https://github.com/Borecount/Borecount/blob/main/docs/product/overview.md), [ledger invariants](https://github.com/Borecount/Borecount/blob/main/docs/product/invariants.md), and [known limitations](https://github.com/Borecount/Borecount/blob/main/docs/product/limitations.md).
- Raw contract: `GET /openapi.yaml`; Swagger UI: `GET /docs` (its assets load from a public CDN).

Stop local services with `docker compose down`. Add `-v` only when you intentionally want to delete the demo database volume.

## Rebrand identities

Package names and active branding use Borecount. Existing database names/users,
Docker volumes, reset guards and backup identities remain unchanged. The public demo domain is `https://borecount.dev/`; it must be connected in Render
and Cloudflare before use. The Render service address is `luxledger-demo.onrender.com`.

Set `VITE_PUBLIC_URL=https://borecount.dev/` in the Render service environment before
building to configure the public URL in page metadata (this is also the default).
Changing it requires a new build. Local Vite commands read it from the root `.env`.
`Dockerfile.render` accepts the same variable as a build argument.
API requests use relative same-origin paths and need no separate API URL.
