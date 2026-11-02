# Scenario Cookbook

These copy/paste scenarios use a private sandbox session for host-owned tenant provisioning, then public `/v1` APIs for every business flow. They do not require a bootstrap admin key or shared tenant.

Create a session, then create an isolated ledger, accounts, and one transaction for the examples:

```sh
export BASE_URL=http://localhost:3000
json_value() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }
SESSION="$(curl -fsS -c /tmp/borecount-sandbox.cookies -H "Origin: $BASE_URL" -X POST "$BASE_URL/demo/session")"
export ACCESS_TOKEN="$(printf '%s' "$SESSION" | json_value access_token)"
api() { curl -sS -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $ACCESS_TOKEN" "$@"; }

LEDGER_ID="$(api -X POST -H 'content-type: application/json' -d '{"name":"Scenario cookbook"}' "$BASE_URL/v1/ledgers" | sed -n '1p' | json_value id)"
DEBIT_ACCOUNT_ID="$(api -X POST -H 'content-type: application/json' -d "{\"ledger_id\":\"$LEDGER_ID\",\"code\":\"1000\",\"name\":\"Cash\",\"side\":\"DEBIT\",\"overdraft_policy\":\"ALLOW\",\"currency\":\"USD\"}" "$BASE_URL/v1/accounts" | sed -n '1p' | json_value id)"
CREDIT_ACCOUNT_ID="$(api -X POST -H 'content-type: application/json' -d "{\"ledger_id\":\"$LEDGER_ID\",\"code\":\"4000\",\"name\":\"Revenue\",\"side\":\"CREDIT\",\"overdraft_policy\":\"ALLOW\",\"currency\":\"USD\"}" "$BASE_URL/v1/accounts" | sed -n '1p' | json_value id)"
TX_BODY="{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"quickstart-sale-001\",\"currency\":\"USD\",\"description\":\"Quickstart sale\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"1250\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-1250\",\"currency\":\"USD\"}]}"
TRANSACTION_ID="$(api -X POST -H 'content-type: application/json' -d "$TX_BODY" "$BASE_URL/v1/transactions" | sed -n '1p' | json_value transaction_id)"
```

The private cookie is stored in `/tmp/borecount-sandbox.cookies`; the SERVICE token expires in 15 minutes. To renew it, call `GET /demo/session` with that cookie and read the returned `access_token`.

Generated IDs and timestamps are shown as placeholders. Error messages are useful diagnostics, but clients should branch on status and `error` code.

## Validation and domain errors

Transport validation happens before domain validation. An extra property is rejected because request schemas set `additionalProperties: false`:

```sh
api -X POST -H 'content-type: application/json' \
  -d '{"name":"Invalid ledger","unexpected":true}' "$BASE_URL/v1/ledgers"
```

Expected `HTTP 400`:

```json
{"error":"INVALID_INPUT","message":"body must NOT have additional properties"}
```

A syntactically valid request can still violate a core invariant. The examples below are domain failures.

### Unbalanced transaction

```sh
api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"failure-unbalanced-001\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"100\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-99\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions"
```

Expected `HTTP 400`:

```json
{"error":"INVARIANT_VIOLATION","message":"total debits must equal total credits"}
```

### Currency mismatch

```sh
api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"failure-currency-001\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"100\",\"currency\":\"EUR\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-100\",\"currency\":\"EUR\"}]}" \
  "$BASE_URL/v1/transactions"
```

Expected `HTTP 400`:

```json
{"error":"INVARIANT_VIOLATION","message":"currency must match"}
```

### Cross-ledger account

```sh
OTHER_LEDGER_ID="$(api -X POST -H 'content-type: application/json' -d '{"name":"Other ledger"}' "$BASE_URL/v1/ledgers" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"
OTHER_ACCOUNT_ID="$(api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$OTHER_LEDGER_ID\",\"name\":\"Other cash\",\"side\":\"DEBIT\",\"currency\":\"USD\"}" \
  "$BASE_URL/v1/accounts" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"

api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"failure-cross-ledger-001\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$OTHER_ACCOUNT_ID\",\"signed_amount_minor\":\"100\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-100\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions"
```

Expected `HTTP 400`:

```json
{"error":"INVARIANT_VIOLATION","message":"account must belong to same ledger"}
```

## Idempotent payload mismatch

The setup above created `quickstart-sale-001` for 1250. Reuse that tenant-scoped reference with a changed amount:

```sh
api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"quickstart-sale-001\",\"currency\":\"USD\",\"description\":\"Quickstart sale\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"1300\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-1300\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions"
```

Expected `HTTP 400`:

```json
{"error":"INVARIANT_VIOLATION","message":"Unable to create transaction: reference payload mismatch"}
```

The original transaction and balances remain unchanged.

Description is also part of transaction identity in the current PostgreSQL adapter. Retry the original amount and entries with a changed description:

```sh
api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"quickstart-sale-001\",\"currency\":\"USD\",\"description\":\"Changed description\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"1250\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-1250\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions"
```

Expected `HTTP 400` with the same payload-mismatch body. Entry order alone is not a mismatch, while entry multiplicity remains significant.

## Bulk posting and atomic rollback

First post two valid items atomically:

```sh
api -X POST -H 'content-type: application/json' \
  -d "{\"transactions\":[{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"bulk-ok-001\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"200\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-200\",\"currency\":\"USD\"}]},{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"bulk-ok-002\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"300\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-300\",\"currency\":\"USD\"}]}]}" \
  "$BASE_URL/v1/transactions/bulk"
```

Expected `HTTP 201`:

```json
{"created_count":2,"idempotent_count":0,"transactions":[{"reference":"bulk-ok-001","transaction_id":"<uuid>","created":true},{"reference":"bulk-ok-002","transaction_id":"<uuid>","created":true}]}
```

Retrying the same body returns `HTTP 200`, `created_count: 0`, `idempotent_count: 2`, and `created: false` for both.

The HTTP contract caps a batch at 100. The adapter locks affected account rows in account-ID order, but writes touching the same account still serialize; do not run such batches concurrently. A backdated batch can be more expensive because each posting propagates its balance delta through later snapshots.

Now make item 2 unbalanced. Item 1 is valid but must roll back:

```sh
api -X POST -H 'content-type: application/json' \
  -d "{\"transactions\":[{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"bulk-rollback-001\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"400\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-400\",\"currency\":\"USD\"}]},{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"bulk-rollback-002\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"500\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-499\",\"currency\":\"USD\"}]}]}" \
  "$BASE_URL/v1/transactions/bulk"
```

Expected `HTTP 400`:

```json
{"error":"BULK_TRANSACTION_FAILED","message":"Bulk transaction 1 (bulk-rollback-002) failed: total debits must equal total credits","details":{"item_index":1,"reference":"bulk-rollback-002","category":"VALIDATION"}}
```

Verify the valid first item was not committed:

```sh
api "$BASE_URL/v1/transactions?ledger_id=$LEDGER_ID&limit=200" | grep -q 'bulk-rollback-001' && echo 'unexpected: committed' || echo 'OK: rolled back'
```

Expected: `OK: rolled back`.

## Reversal and correction

Reverse the README transaction:

```sh
REVERSAL_RESPONSE="$(api -X POST -H 'content-type: application/json' \
  -d '{"reference":"quickstart-sale-001-reversal","description":"Reverse quickstart sale"}' \
  "$BASE_URL/v1/transactions/$TRANSACTION_ID/reverse")"
printf '%s\n' "$REVERSAL_RESPONSE"
```

Expected `HTTP 201`:

```json
{"transaction_id":"<reversal uuid>","created":true}
```

The reversal uses opposite signed entry amounts and links back with `relation_type: "REVERSAL"`. An identical retry returns `HTTP 200` and `created: false`.

Correction is an atomic reversal plus replacement. Use a transaction not already reversed:

```sh
CORRECT_SOURCE_ID="$(api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"correction-source-001\",\"currency\":\"USD\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"600\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-600\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).transaction_id')"

api -X POST -H 'content-type: application/json' \
  -d "{\"reversal_reference\":\"correction-source-001-reversal\",\"corrected_reference\":\"correction-source-001-v2\",\"description\":\"Correct amount\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"650\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-650\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions/$CORRECT_SOURCE_ID/correct"
```

Expected `HTTP 201`:

```json
{"reversal_transaction_id":"<uuid>","corrected_transaction_id":"<uuid>","created":true}
```

An identical retry returns `HTTP 200` with the same IDs and `created: false`.

## Hold lifecycle

A hold changes inflight/available balances without changing posted balance. Create one for 800:

```sh
HOLD_RESPONSE="$(api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"hold-001\",\"currency\":\"USD\",\"description\":\"Authorization\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"800\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-800\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/holds")"
printf '%s\n' "$HOLD_RESPONSE"
export HOLD_ID="$(printf '%s' "$HOLD_RESPONSE" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).hold_id')"
```

Expected `HTTP 201`:

```json
{"hold_id":"<uuid>","created":true,"state":"HELD","remaining_amount_minor":"800"}
```

Partially commit 500:

```sh
api -X POST -H 'content-type: application/json' \
  -d '{"reference":"hold-001-commit-001","amount_minor":"500"}' \
  "$BASE_URL/v1/holds/$HOLD_ID/commit"
```

Expected `HTTP 201`:

```json
{"hold_id":"<same uuid>","transaction_id":"<uuid>","created":true,"state":"HELD","remaining_amount_minor":"300"}
```

Void the remaining 300:

```sh
api -X POST "$BASE_URL/v1/holds/$HOLD_ID/void"
```

Expected `HTTP 200`:

```json
{"hold_id":"<same uuid>","state":"VOIDED","voided":true,"remaining_amount_minor":"0"}
```

A second void is idempotent (`200`, `voided: false`). A new commit after void is rejected because the hold is no longer `HELD`; branch on the returned status and `error` code rather than the message.

## Backdated posting and historical balances

Capture the current account history boundary, then post with an earlier accounting effective time. `effective_at` controls accounting history; `created_at` remains ingestion time.

```sh
export HISTORY_FROM=2026-01-01T00:00:00.000Z
export BACKDATED_AT=2026-06-01T12:00:00.000Z
export HISTORY_TO=2030-01-01T00:00:00.000Z

api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"reference\":\"backdated-001\",\"currency\":\"USD\",\"effective_at\":\"$BACKDATED_AT\",\"entries\":[{\"account_id\":\"$DEBIT_ACCOUNT_ID\",\"signed_amount_minor\":\"700\",\"currency\":\"USD\"},{\"account_id\":\"$CREDIT_ACCOUNT_ID\",\"signed_amount_minor\":\"-700\",\"currency\":\"USD\"}]}" \
  "$BASE_URL/v1/transactions"

api "$BASE_URL/v1/accounts/$DEBIT_ACCOUNT_ID/balance-as-of?at=$BACKDATED_AT"
api "$BASE_URL/v1/accounts/$DEBIT_ACCOUNT_ID/balance-history?from=$HISTORY_FROM&to=$HISTORY_TO&limit=200"
```

Posting returns `HTTP 201`. Balance-as-of returns `HTTP 200`:

```json
{"account_id":"<uuid>","timestamp":"2026-06-01T12:00:00.000Z","posted_minor":"<value including events effective by that instant>","inflight_debit_minor":"<value>","inflight_credit_minor":"<value>","available_minor":"<value>"}
```

History returns `{"data":[...],"next_cursor":null}`; find the snapshot with `event_type: "TX_APPLIED"`, the backdated transaction `source_id`, and `effective_at: "2026-06-01T12:00:00.000Z"`. History is ordered by `(effective_at, id)` ascending. The backdated write also applies its posted-balance delta to later snapshots, so reads remain immediately consistent; write cost grows with the amount of later history.

## Reconciliation

Create a rule whose criteria are conjunctive:

```sh
RULE_RESPONSE="$(api -X POST -H 'content-type: application/json' \
  -d '{"name":"Exact reference/currency","description":"Quickstart exact match","criteria":[{"field":"reference","operator":"equals"},{"field":"currency","operator":"equals"},{"field":"amount","operator":"equals","amount_tolerance_minor":"0"}]}' \
  "$BASE_URL/v1/reconciliation/matching-rules")"
printf '%s\n' "$RULE_RESPONSE"
export RULE_ID="$(printf '%s' "$RULE_RESPONSE" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"
```

Expected `HTTP 201` with a `ReconciliationMatchingRule` body containing the generated `id`, tenant, criteria, and `created_at`.

Ingest one normalized external record matching the README transaction:

```sh
UPLOAD_RESPONSE="$(api -X POST -H 'content-type: application/json' \
  -d '{"source":"demo-bank","records":[{"id":"bank-quickstart-001","amount_minor":"1250","currency":"USD","reference":"quickstart-sale-001","description":"Quickstart sale","date":"2026-01-01T00:00:00.000Z","raw":{"source_line":1}}]}' \
  "$BASE_URL/v1/reconciliation/external-records")"
printf '%s\n' "$UPLOAD_RESPONSE"
export UPLOAD_ID="$(printf '%s' "$UPLOAD_RESPONSE" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).upload_id')"
```

Expected `HTTP 201`:

```json
{"upload_id":"<uuid>","tenant_id":"<uuid>","source":"demo-bank","record_count":1,"created_at":"<date-time>"}
```

Run and persist one-to-one reconciliation:

```sh
RUN_RESPONSE="$(api -X POST -H 'content-type: application/json' \
  -d "{\"ledger_id\":\"$LEDGER_ID\",\"upload_id\":\"$UPLOAD_ID\",\"strategy\":\"one_to_one\",\"matching_rule_ids\":[\"$RULE_ID\"],\"dry_run\":false}" \
  "$BASE_URL/v1/reconciliation/runs")"
printf '%s\n' "$RUN_RESPONSE"
export RUN_ID="$(printf '%s' "$RUN_RESPONSE" | sed -n '1p' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"

api "$BASE_URL/v1/reconciliation/runs/$RUN_ID"
```

Both return the `ReconciliationRun` shape. Creation is `HTTP 201`; read is `HTTP 200`. For an unambiguous match, expect `status: "completed"`, `matched_count: 1`, a result with `status: "matched"`, the external ID, and the matching transaction ID. A run with `"dry_run": true` returns `HTTP 200` and is reported but not persisted for later GET.

Rules supplied to a run are alternatives; criteria inside one rule are all required. Conflict/unmatched counters are explicit—do not infer success solely from HTTP 2xx. Reconciliation never mutates ledger transactions. Committed run results are retained for audit, while dry-run rows are not persisted. Re-uploading the same provider record ID for the same tenant and source is rejected by the `(tenant_id, source, external_id)` uniqueness boundary.
