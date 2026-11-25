# Frontend query coverage

The signed-in workspace uses the same `createApiClient` implementation for administrators and company members. The integration test runs that client in Docker against a dedicated Supabase stack containing two companies, real Auth sessions, inventory, Finances, fees and saved payouts. The current workload covers 39 client methods and 50 HTTP method and route combinations, counting password and refresh grants separately. It requires every exported client method to complete successfully at least once. The guard also compares the recorded wire requests against the entire endpoint inventory below. A missing lookup, an unexercised new method, or an unexpected HTTP route fails the test. [Client composition](../services/frontend/user-webpage/src/api/client.ts) · [Executable coverage](../services/frontend/user-webpage/tests/live/verify-client.mjs)

## Requests issued by the frontend

PostgREST paths below are relative to `/rest/v1/`. The Auth requests use `/auth/v1/`.

| Area | HTTP methods and endpoints | Request shapes |
| --- | --- | --- |
| Auth | POST `signup`, `token`, `recover`, `logout` · GET and PUT `user` | Email signup, password and refresh grants, session verification, recovery acknowledgement, password change and local sign-out. |
| Workspace and selectors | GET `rpc/workspace_revisions`, `companies`, `company_skus` · POST `rpc/sku_filter_options` | Account lookup uses an empty revision list. Polls select source tokens. Lookup catalogs support paginated responses. The administrator can request the full SKU catalog. |
| Transactions and Raw data › Finances | POST `rpc/transaction_page`, `rpc/transaction_count`, `rpc/source_transaction_page`, `rpc/source_transaction_count` | Page and count share the active filters and resolved searches. Date and amount orders, offsets, combined or separate counts and the newest single-row date anchor use these routes. Raw data › Finances requires administrator access. |
| Raw data reports | GET and HEAD `current_ad_invoices`, `current_storage_rows`, `current_aged_storage_rows`, `current_removal_order_rows` · GET `current_ad_invoice_lines` | The current version of each advertising invoice and warehouse report. Page and exact HEAD count share marketplace (`in.`), month-start or day-range (`gte.`/`lte.`) and literal `imatch` search filters, ordered by the source's date, its tiebreak columns and `id`. An invoice drawer reads its lines by `version_id` in `line_number` order, and the client checks them against the invoice's line count. Members get empty results. |
| Current totals and trends | POST `rpc/transaction_totals` | Period totals group by marketplace and currency, type totals select one currency, and trend requests select daily or weekly buckets. |
| Source details | POST `rpc/financial_source_record`, `rpc/financial_source_transaction_lookup` | Exact source row and version or paged exact native transaction ID. |
| Fees | POST `rpc/sku_configuration`, `rpc/sku_configuration_history`, `rpc/publish_sku_configuration` | Current ownership and rates, whole-batch edits with expected versions, historical versions and the rate periods for the displayed version IDs. |
| Inventory | GET `latest_inventory_captures`, `latest_inventory_items`, `rpc/workspace_revisions` | Capture references and full paged item lists. Revision reads bracket the item list, including the caller's current account. |
| Payout list and search | GET and HEAD `latest_company_payout_reports` · POST `rpc/payout_search_months` | Search matches visible month labels, marketplace and currency. The page and exact HEAD count carry the same company and date filters. |
| Payout history and drawer | GET `company_payout_reports` · POST `rpc/payout_report_records`, `rpc/payout_report_totals` | History page and exact selected version use the saved company, month, marketplace and currency. Records support a type filter. The drawer requests grouped type totals. Grand totals come from the saved header. |
| Readiness and blockers | GET `rpc/payout_readiness`, `rpc/payout_setup_blockers` | Readiness pages select a month and optionally companies. Setup details require one company, month and administrator access. |
| Financial review | GET `rpc/financial_review_months`, `rpc/financial_outcome_page` | One marketplace-year of measures; the client rejects another currency, unknown reasons or groups and any month that does not balance. Month records page 50 at a time for one outcome and optional reason or SelBox group, and the client rejects a record source it does not define; the months' record counts are their exact totals. |
| Assignments | POST `rpc/reference_assignments`, `rpc/set_reference_assignment` · GET `assignment_versions` | One JSON value holds the complete list: every known campaign, promotion and shipment ID with products and warnings for the administrator, and only the company's current assignments without them for a member. The browser searches, filters and pages it. The administrator reads one key's versions newest first. Changes and clears name the version the editor started from, so a version saved elsewhere meanwhile is refused (409); a blank reason saves a default memo. |
| Accounts and companies | GET and HEAD `rpc/account_directory` · POST `rpc/set_company_membership`, `rpc/create_company`, `rpc/delete_company` | Ordered directory pages and exact counts support company and email filters. Membership changes carry the last seen role and company. Administrator updates take effect on existing sessions. |

The disposable test exercises every configured sort column in both directions, separate and combined counts, both members' allowed data, cross-company payout denial, administrator-only reads, empty Raw data reports for members, and the five administrator writes. It signs up and signs out a separate synthetic account to exercise Auth. The recovery test uses the public acknowledgement for an unknown address. Email delivery is outside the query test.

## Reproduce

With Docker and the local Supabase CLI available, run from the repository root.

```sh
conda run --no-capture-output -n A-SelBox python -m unittest services.db.supabase.tests.e2e.test_frontend_client
```

The suite provisions its synthetic data and passes ordinary tokens to the client on stdin. No preview accounts or Amazon credentials are required. The broader API unit tests cover malformed responses, pagination retries, cancellations and sort/filter combinations. The performance benchmarks exercise populated data independently of the disposable functional test. [Benchmark commands](../services/db/supabase/benchmarks/README.md) · [Performance measurements](database_performance.md)
