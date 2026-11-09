# Integration Guide

The checked-in [OpenAPI document](../openapi/openapi.yaml) is a byte-for-byte copy of the canonical [`@borecount/http` OpenAPI document](https://github.com/Borecount/Borecount/blob/main/packages/http/openapi/openapi.yaml). This guide records conventions that are easy to miss when reading individual operations. Released package versions plus their executable tests define runtime behavior; repository documentation must not be used to infer unreleased features.

## Authentication and roles

The browser obtains and renews its sandbox bearer through host-owned `/demo/session`. For hosts that provision API keys directly, exchange a raw key at `POST /v1/auth/token` using `x-api-key`. Other `/v1/*` calls use `Authorization: Bearer <access_token>`.

| Role | Non-admin `/v1/*` | List/create/revoke API keys |
| --- | --- | --- |
| `ADMIN` | Yes | Yes |
| `SERVICE` | Yes | No (`403 FORBIDDEN`) |

The documented access-token TTL is **exactly 900 seconds** (`JWT_ACCESS_TTL_SECONDS=900`), reflected by `expires_in: 900`. The server permits configuration only in the 300–900 range, but changing it diverges from this demo profile.

A JWT is backed by its API-key record. Every authenticated request rechecks that record after JWT verification. Revoking an API key therefore invalidates all of its outstanding tokens on their **next authenticated request**. Revocation returns `204` with no body. A key cannot be used to obtain new tokens after revocation.

`JWT_PREVIOUS_SIGNING_KEYS` supports comma-separated old keys during signing-key rotation: new tokens use `JWT_SIGNING_KEY`; verification tries the active key and then old keys. Remove old keys after the longest token lifetime plus permitted clock skew.

## Wire conventions

- JSON field casing follows the OpenAPI schema. Ledger resources currently use `tenantId`/`createdAt`; accounting resources use snake case. Do not normalize fields client-side without an explicit mapping.
- UUIDs are opaque strings. Do not infer ordering from them.
- Timestamps are RFC 3339/ISO 8601 date-times and are returned in UTC. Send an explicit offset, preferably `Z`; never send a timezone-less local timestamp.
- Monetary amounts and balances are base-10 **strings in minor units**, avoiding JSON number precision loss. Entry `signed_amount_minor` is positive for DEBIT and negative for CREDIT; for a two-decimal currency, `"1250"` means 12.50 and `"-1250"` means a 12.50 credit. Currency scale is not discovered or converted by this API; integrators own currency metadata and presentation.
- Currency is an explicit string on accounts, transactions, entries, and holds. All entries in a transaction or hold must match its currency. Cross-currency transfers and FX conversion are not available.
- Client transaction and hold `reference` values are tenant-scoped idempotency keys. Repeating the identical payload returns `200` and `created: false`; reusing a reference with a materially changed posting payload returns `400 INVARIANT_VIOLATION`.
- Supply `x-request-id` for end-to-end correlation. The service echoes it on the response; otherwise it generates a UUID.

## Pagination

List ledgers, accounts, transactions, entries, holds and their lifecycle details, credit grants/lots/lineage, API keys, balance history, and reconciliation rules, uploads, persisted run summaries, and results with cursor pagination:

```http
GET /v1/transactions?ledger_id=<uuid>&limit=50
GET /v1/transactions?ledger_id=<uuid>&limit=50&cursor=<opaque-next_cursor>
GET /v1/reconciliation/uploads?limit=50&where=%7B%22source%22%3A%7B%22eq%22%3A%22bank-feed%22%7D%7D
GET /v1/reconciliation/runs?limit=50&where=%7B%22ledger_id%22%3A%7B%22eq%22%3A%22<uuid>%22%7D%7D
GET /v1/reconciliation/runs/<uuid>/results?limit=50&cursor=<opaque-next_cursor>
```

`limit` defaults to 50 and accepts 1–200. Treat `next_cursor` as opaque: pass it unchanged and do not decode, persist business meaning from, or construct it. `next_cursor: null` means the page is final. A malformed/stale cursor produces `400`. All these lists return `{ "data": [...], "next_cursor": "..." }`. Continue with `cursor=next_cursor` until it is `null`. Uploads are newest first and can be filtered by `id`, `source`, or `created_at`. Runs are newest first and can be filtered by `id`, `ledger_id`, `upload_id`, `status`, or `started_at`; summaries omit `results`, which remain available through the bounded results endpoint. Dry runs are transient and do not appear in run history. Typed `where` filters are endpoint-specific; see OpenAPI for supported fields and operators.

## Error envelope

All JSON errors use:

```json
{
  "error": "STABLE_MACHINE_CODE",
  "message": "Human-readable message",
  "details": {}
}
```

`details` is optional. Branch on status plus `error`, never on `message`. Common mappings:

| Status | Meaning | Representative codes |
| --- | --- | --- |
| `400` | schema or domain validation | `INVALID_INPUT`, `INVARIANT_VIOLATION`, `BULK_TRANSACTION_FAILED` |
| `401` | missing, invalid, expired, or revoked credential | `UNAUTHORIZED` |
| `403` | valid credential lacks admin role | `FORBIDDEN` |
| `404` | tenant-scoped resource absent | `LEDGER_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `HOLD_NOT_FOUND`, `RECONCILIATION_RUN_NOT_FOUND` |
| `409` | state/policy conflict | `INVALID_HOLD_STATE_TRANSITION`, `OVERDRAFT_POLICY_VIOLATION` |
| `429` | local fixed-window quota exceeded | `RATE_LIMIT_EXCEEDED` |
| `500` | unexpected/persistence failure | `INTERNAL_ERROR` |

For `429`, honor the integer `Retry-After` response header; the JSON body repeats it as `retry_after_seconds`. Retry `5xx`, `429`, and network failures with bounded exponential backoff and jitter. A transaction `reference` makes an uncertain POST safe to retry with exactly the same body.

## Idempotency and concurrency

Idempotency scope is `(tenant, reference)`, not ledger. Keep references globally unique within the tenant and immutable. Payload identity includes ledger, currency, normalized nullable description, explicit effective time, relation metadata, and the complete entry multiset. Entry order is ignored, but duplicate occurrence count and every account, signed amount, and currency must match. Omitting `effective_at` asks the server to assign accounting time on first creation, so an identical retry must also omit it unless the original explicit value is known.

Bulk posting reports each item and counts created versus idempotently resolved items. If one new item fails, the entire request rolls back. Duplicate references inside one batch are rejected before persistence. Account rows are locked in account-ID order; postings that affect the same account serialize. Avoid concurrent batches against the same accounts and split imports larger than the OpenAPI maximum of 100. A concurrent retry may resolve an already committed reference; clients should use returned IDs rather than assuming creation.

See [Scenario cookbook](SCENARIOS.md) for executable examples.
