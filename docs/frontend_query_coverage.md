# Frontend query coverage

The signed-in workspace uses the same `createApiClient` implementation for administrators and company members. The integration test runs that client in Docker against a dedicated Supabase stack containing two companies, real Auth sessions, inventory, Finances, fees and saved payouts. The current workload covers 37 client methods and 41 HTTP method and route combinations, counting password and refresh grants separately. It requires every exported client method to complete successfully at least once. The guard also compares the recorded wire requests against the entire endpoint inventory below. A missing lookup, an unexercised new method, or an unexpected HTTP route fails the test. [Client composition](../services/frontend/user-webpage/src/api/client.ts) · [Executable coverage](../services/frontend/user-webpage/tests/live/verify-client.mjs)

## Requests issued by the frontend

PostgREST paths below are relative to `/rest/v1/`. The Auth requests use `/auth/v1/`.

| Area | HTTP methods and endpoints | Request shapes |
| --- | --- | --- |
| Auth | POST `signup`, `token`, `recover`, `logout` · GET and PUT `user` | Email signup, password and refresh grants, session verification, recovery acknowledgement, password change and local sign-out. |
| Workspace and selectors | GET `rpc/workspace_revisions`, `companies`, `company_skus` · POST `rpc/sku_filter_options` | Account lookup uses an empty revision list. Polls select source tokens. Lookup catalogs support paginated responses. The administrator can request the full SKU catalog. |
| Transactions and raw Finances | POST `rpc/transaction_page`, `rpc/transaction_count`, `rpc/source_transaction_page`, `rpc/source_transaction_count` | Page and count share the active filters and resolved searches. Date and amount orders, offsets, combined or separate counts and the newest single-row date anchor use these routes. Raw Finances requires administrator access. |
| Current totals and trends | POST `rpc/transaction_totals` | Period totals group by marketplace and currency, type totals select one currency, and trend requests select daily or weekly buckets. |
| Source details | POST `rpc/financial_source_record`, `rpc/financial_source_transaction_lookup` | Exact source row and version or paged exact native transaction ID. |
| Fees | POST `rpc/sku_configuration`, `rpc/publish_sku_configuration` · GET `assignment_versions`, `sku_fee_periods` | Current ownership and rates, whole-batch edits with expected versions, historical versions and the rate periods for the displayed version IDs. |
| Inventory | GET `latest_inventory_captures`, `latest_inventory_items`, `rpc/workspace_revisions` | Capture references and full paged item lists. Revision reads bracket the item list, including the caller's current account. |
| Payout list and search | GET and HEAD `latest_company_payout_reports` · POST `rpc/payout_search_months` | Search matches visible month labels, marketplace and currency. The page and exact HEAD count carry the same company and date filters. |
| Payout history and drawer | GET `company_payout_reports` · POST `rpc/payout_report_records`, `rpc/payout_report_totals` | History page and exact selected version use the saved company, month, marketplace and currency. Records support a type filter. The drawer requests grouped type totals. Grand totals come from the saved header. |
| Readiness and blockers | GET `rpc/payout_readiness`, `rpc/payout_setup_blockers` | Readiness pages select a month and optionally companies. Setup details require one company, month and administrator access. |
| Financial review and assignments | GET `rpc/financial_outcome_page`, `rpc/financial_review_month_page`, `assignment_status` · POST `rpc/set_reference_assignment` | The administrator filters company amounts, differences and SelBox items by month and marketplace. Assignment kind and warnings filter the list. Changes and clears name the expected version. |
| Accounts and companies | GET and HEAD `rpc/account_directory` · POST `rpc/set_company_membership`, `rpc/create_company`, `rpc/delete_company` | Ordered directory pages and exact counts support company and email filters. Membership changes carry the last seen role and company. Administrator updates take effect on existing sessions. |

The disposable test exercises every configured sort column in both directions, separate and combined counts, both members' allowed data, cross-company payout denial, administrator-only reads, and the five administrator writes. It signs up and signs out a separate synthetic account to exercise Auth. The recovery test uses the public acknowledgement for an unknown address. Email delivery is outside the query test.

## Reproduce

With Docker and the local Supabase CLI available, run from the repository root.

```sh
conda run --no-capture-output -n A-SelBox python -m unittest services.db.supabase.tests.e2e.test_frontend_client
```

The suite provisions its synthetic data and passes ordinary tokens to the client on stdin. No preview accounts or Amazon credentials are required. The broader API unit tests cover malformed responses, pagination retries, cancellations and sort/filter combinations. The performance benchmarks exercise populated data independently of the disposable functional test. [Benchmark commands](../services/db/supabase/benchmarks/README.md) · [Performance measurements](database_performance.md)
