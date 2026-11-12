# Console walkthrough

1. Open the console and click **New sandbox**. Each visitor receives a separate tenant; Alice starts with 100.00 USD, while Eva starts with 175.00 EUR in a separate ledger. Keep credentials and environment files out of the presentation.
2. Use the global **REST API / Library** switch to choose the view. The same sandbox and its data remain active when switching.
3. In REST API mode, open **Transactions**, transfer 25.00, and inspect the debit/credit entries. In **Accounts**, Alice has 75.00 and Bob 25.00. Repeat the exact request in the journal: same transaction ID, `created: false`, no duplicate money movement.
4. In either mode, return to the **Guided demo** section, start **Authorization & capture**, reserve 25.00, capture 10.00, and void the remainder. Compare posted and available balances in Accounts.
5. Start **Prepaid credits** to show grants, consumption provenance, refund restrictions, and expiration. The short-lived lot expires after 15 seconds. Preview can use a future boundary; run requires a boundary no later than database time.
6. Start **Finance** to create rules and upload provider records. Show matched, unmatched and mismatched results, filtering, and audited adjustments. Use Reports for bounded statements and trial balance.
7. Switch to Library mode to show the selected service method, arguments, example code, and result. Library calls run on the demo server and use the same sandbox data; `bigint` and `Date` values appear as strings across the JSON boundary.
8. Return to REST API mode, open **API docs**, expand an endpoint and use Try it out. Clear prefilled example filters to list all data. Swagger uses the same private SERVICE token and displays its own request and response. Download the canonical OpenAPI for external integration.

REST API mode calls `/v1` directly. Library mode invokes allowlisted library services on the demo server. Financial behavior belongs to the released library and PostgreSQL adapter; the host owns private session provisioning and demo assets. Administrative endpoints correctly return 403 for sandbox SERVICE credentials.

For a partner discussion, map one real business event to a balanced transaction, identify the available balances it needs, and agree how references and provider IDs map into the API. Follow [HOSTED_DEMO.md](HOSTED_DEMO.md) for private deployment and [CONSOLE.md](CONSOLE.md) for all scenarios.
