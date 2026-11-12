# Interactive console

Run `npm run demo` after the README environment setup. The global **REST API / Library** switch changes how all six workspace sections and guided scenarios call the services. Both modes use the same private sandbox; switching does not provision a new tenant or reset data. REST API mode uses the same-origin `/v1` HTTP API. Library mode invokes an allowlisted set of library services on the demo server through `/demo/library/execute` and displays the native method name, arguments, example code, and result. This is a server-side library demonstration; browser JSON represents `bigint` and `Date` values as strings at the boundary.

All displayed request amounts are decimal strings in minor units; display uses the provisioned asset scale. USD and EUR use scale 2 and separate default ledgers with different seeded accounts and opening balances (Alice: 100.00 USD; Eva: 175.00 EUR). Each transaction or hold uses one currency; there are no cross-currency transfers or FX conversion. **Demo UI limitation:** the interface assumes one currency per ledger and does not support mixed-currency accounts within a ledger. This is a demo constraint, not a library restriction.

The **Guided demo** section sits above the workspace. Its five flow cards open the first step in the relevant workspace tab. In REST API mode, steps open editable HTTP requests; in Library mode, they open method calls with arguments, example code, and results. The section also explains the platform-side wallet accounting convention.

## Workspace

- **Accounts:** full paginated account directory, normal side, overdraft policy, grant capability, posted/reserved/available balances; create accounts and ledgers.
- **Transactions:** transfer form with a persistent reference, marketplace fee split, funding, atomic bulk and rollback, reversal/correction, backdated posting, and deliberate invariant failures. Select a transaction to inspect its entries, metadata, accounting/creation timestamps and related transaction ID.
- **Holds:** paginated reservations, selection, partial capture, capture remainder and void. Each new capture requires a new reference; an exact replay uses its original reference and amount.
- **Credits:** grants, short-lived grants, consumption, holds, partial unspent refunds, untouched-grant reversal, expiration preview/run, grant/transaction allocation lineage, credit balance and lot directory. IDs returned by writes populate subsequent templates.
- **Reconciliation:** editable matching rules, multiple external records or CSV import, dry run, persisted run, result filtering and audited debit/credit adjustments. The supported strategy is `one_to_one`. A rule's criteria are conjunctive; multiple rules are alternatives.
- **Reports:** historical balance, balance events, account statement, credit statement and trial balance. Edit fixed ISO time boundaries and use Next page without changing scope/filters.
- **API docs link:** opens REST documentation in locally bundled Swagger UI in a separate tab, generated from the installed contract; endpoints grouped by resource, complete schemas, editable parameters, and Try it out using the active sandbox token. Raw `/openapi.yaml` remains byte-identical to the package. The presentation JSON only adds tags and a same-origin server URL.

In REST API mode, workbench requests are editable before sending. Click **Regenerate with new reference** for a distinct posting; use **Repeat exact request** to test idempotency. Errors use the real transport/domain code and status. Failed requests stay in the HTTP journal. In Library mode, the workbench presents the selected method and arguments, example code, and result. Values crossing its JSON boundary represent `bigint` and `Date` as strings.

The execution journal retains the latest 150 operations in this tab, each labeled REST API, Library, or sandbox session. It redacts token/key values, shows HTTP status, response, timing and `x-request-id`, and copies POSIX-safe cURL using `$ACCESS_TOKEN`. Library records show service arguments, returned values or errors, timing, and a copyable Node.js example. The example requires DATABASE_URL for the database containing the displayed tenant and resources. Obtain an external token with `POST /v1/auth/token` and `x-api-key`; the private sandbox uses separate host provisioning and never reveals a bootstrap ADMIN key.

## Guided flows

1. **Wallet:** fund → transfer → insufficient funds. Repeat the transfer before advancing to see 201 vs 200; change amount without changing reference to see payload mismatch.
2. **Marketplace:** buyer debit 25.00 → seller credit 23.00 + fee credit 2.00 → reversal → separate payment → atomic correction. Select another original transaction when exploring freely.
3. **Authorization & capture:** reserve 25.00 → capture 10.00 → void 15.00. Posted funds change only on capture; available funds reflect reservations.
4. **Prepaid credits:** issue a regular grant and a 15-second lot → reserve → consume → void the reservation → refund eligible capacity → preview/run expiration → inspect allocations. Wait until the short-lived lot expires, regenerate preview, then run with that preview's `as_of`. Future preview is permitted; future run returns an error. Run again for further bounded expiration pages until the due preview is empty.
5. **Finance:** create rule → upload matching and external-only records → dry run → persist report → inspect results → audited adjustment → rerun. Editing a mismatched reference/amount or adding competing candidates demonstrates other result categories; a new run evaluates the same external upload against the current ledger.

## CSV and filters

CSV headers: `id,amount_minor,currency,reference,date` and optional `description`. Quoted commas, escaped quotes, CRLF and UTF-8 BOM are supported. Import accepts 1–1000 rows, up to 1 MB, validates positive integer amounts and timestamps, then converts locally to the documented JSON ingestion request. The API upload is not a multipart CSV endpoint.

Read panels accept endpoint-specific `where` JSON, for example `{"status":{"eq":"matched"}}` on reconciliation results. Use `eq`, `ne`, `in` and supported numeric/date comparisons only for documented fields. Metadata JSON paths and derived lot capacity are not filterable. The server validates unknown fields/operators; Next page preserves the exact filter and time boundaries. Every page has explicit completeness status.

## Host boundaries

`POST /demo/session` provisions a private tenant and returns a short-lived SERVICE bearer. `GET /demo/session` renews the bearer using the HttpOnly, SameSite=Strict session cookie; it is Secure behind HTTPS. Session creation and Library execution require either `Sec-Fetch-Site: same-origin` or an `Origin` host matching the request Host; cross-site requests and requests with neither signal are rejected. `New sandbox` replaces only this session. Tabs in the same browser profile share the cookie; a stale tab's revoked token requires a new page load.

The Holds panel uses one cursor-paginated list from `GET /v1/holds`, scoped to the selected ledger. Choose **All states**, **Active (HELD)**, **Applied (APPLIED)**, or **Voided (VOIDED)** to filter the same list; changing the state clears the current cursor. Pages default to 50 holds.

In REST API mode, business requests use the public `/v1` contract with the session's SERVICE bearer. Library mode calls the allowlisted services directly on the demo server, scoped to the active sandbox. Mutating Library calls share the REST write quota; Library reads do not consume it. The host owns session metadata and tenant provisioning; financial rules remain in the released packages.
