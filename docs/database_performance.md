# Frontend query performance

The 24 November 2026 comparison used the same 48,493 Finances transactions, 308,886 amounts and 63 saved payout reports on both revisions. Times below are milliseconds for the public database functions used by the frontend. Each pair shows the median of five calls on populated clones under the same authenticated role, comparing `ca353da` with this revision. The execution order alternated after a warmup.

| Request | Administrator | Company A | Company B |
| --- | ---: | ---: | ---: |
| First transaction page | 69 → 64 | 70 → 66 | 68 → 65 |
| Transaction page at offset 2,500 | 98 → 92 | 91 → 79 | 98 → 88 |
| Exact transaction count, all dates | 224 → 123 | 158 → 116 | 196 → 124 |
| Exact transaction count, 60 days | 194 → 97 | 170 → 96 | 185 → 99 |
| Marketplace totals, 60 days | 234 → 129 | 177 → 118 | 225 → 125 |
| Type totals, 60 days | 239 → 124 | 182 → 109 | 234 → 126 |
| Weekly trends, 60 days | 295 → 146 | 200 → 124 | 263 → 134 |
| Monthly reconciliation, all months and markets | 352 → 242 | Admin only | Admin only |
| Reconciliation for one month and market | 66 → 43 | Admin only | Admin only |
| Exact raw Finances count | 46 → 7 | Admin only | Admin only |

A separate HTTP run exercised GoTrue and PostgREST on the running preview. All 100 comparisons matched on returned values, row order, status and Content-Range, including eight denied requests. The slowest successful response in that run was the unfiltered monthly reconciliation at 246 ms. Single HTTP samples include transfer and scheduling variability. The paired database measurements above are more useful for comparing execution costs. [Request timings and comparison methods](evidence/frontend_query_latency_2026-11-24.json)

## Joins and indexes

- **Transaction counts and totals.** The shared predicate applies the company, UTC date, currency, SKU, marketplace, source, type, fee and resolved-search filters. Counts read the fields needed to identify qualifying amounts. A partial B-tree on `(version_id, sku, route)` supports index-only ownership checks for direct amounts. Totals combine fee bases by schedule, marketplace and local posting day before applying the exact percentage. Missing rates retain the original unknown amounts and counts.
- **Reference allocations and monthly reconciliation.** The requested scope identifies relevant reference keys before joining invoices, ledger entries and orders. All charges associated with each selected key participate in allocation, including charges in other markets or months. The monthly query groups native activity by header, route and SKU before summing amounts for each account, market, currency and month.
- **Raw Finances.** Date and marketplace counts sum the immutable, verified child counts on the transaction headers. Type and SKU filters use the amount rows. Widening the type key to `(amount_type, sku)` cost 104 KiB. The common SKU/type count through PostgREST took 33.4 → 10.2 ms.
- **Saved payouts.** Report headers supply unfiltered counts and grand totals. Ordered record pages and type-filtered reads use the source and assignment versions pinned to the selected report. The database comparison matched all 125,747 records across 63 saved reports, plus all 158,838 current outcomes and 126,641 outcomes across 32 distinct frozen input selections. All 72 monthly reconciliation scopes balanced.
- **Index cost.** Fresh application indexes totaled 70.23 → 72.86 MiB. A fresh publication of 654 transactions and 3,567 amounts took 395 → 414 ms. Replaying that capture took 243 → 248 ms. [Per-index sizes, query plans and write measurements](index_design.md)

## Frontend requests and verification

Fee history returns each page of ten visible versions and their complete fee schedules in one database snapshot. An inventory read requests the exact count with its first page. The client continues across smaller server pages and checks the caller’s account and workspace revisions on both sides of an item snapshot.

| Completed frontend operation | HTTP requests before | HTTP requests after |
| --- | ---: | ---: |
| Open saved fee history | 4 | 1 |
| Read latest inventory captures | 2 | 1 |
| Load inventory items and verify scope | 4 | 3 |

Each of the three accounts saw these request counts on the populated preview. Across 38 client operations the number of HTTP requests fell from 71 to 56. All decoded results matched, including decimal strings, saved timestamps and page boundaries. Five administrator mutation RPCs were also exercised across nine scenarios. The 64-SKU update took 222 → 220 ms. Returned and stored changes matched, and all 108 rollbacks restored the original contents of seven affected tables. [Client timings and mutation results](evidence/frontend_client_operations_2026-11-24.json)

The disposable query contract exercises all 37 exported client methods, including all 40 HTTP method and route combinations. It uses an administrator, two company members and an unassigned login. Run the contract suite to check access and behavior, or the workspace benchmark to measure authenticated reads on populated data. [Query coverage and contract command](frontend_query_coverage.md) · [Benchmark commands](../services/db/supabase/benchmarks/README.md)
