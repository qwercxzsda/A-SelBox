# Frontend query performance

## Measurements

On 24 November 2026, 100 requests were run against the local PostgREST preview before and after changing the queries. One administrator and members of two different companies signed in through Supabase Auth. The database held 48,493 Finances transactions, 308,886 amount rows and 158,838 current financial outcomes. The largest saved payout had 21,395 records.

Each cell shows elapsed milliseconds for one authenticated HTTP request before and after the changes. The figures include local HTTP transfer and exclude login, browser rendering and tunnel latency.

| Frontend request | Administrator | Company A | Company B |
| --- | ---: | ---: | ---: |
| Transactions, newest 25 | 3,554 → 93 | 4,027 → 75 | 3,860 → 90 |
| Transactions, offset 2,500 | 3,593 → 260 | 3,881 → 223 | 3,895 → 146 |
| Exact transaction count | 3,553 → 254 | 4,031 → 224 | 3,817 → 171 |
| Weekly transaction trends | 1,421 → 333 | 1,543 → 271 | 1,562 → 216 |
| Fee configuration | 340 → 55 | 120 → 27 | 136 → 22 |
| Saved payout grand totals | 215 → 3 | 205 → 2 | 70 → 3 |
| Saved payout records, first page | 231 → 244 | 222 → 234 | 79 → 83 |

The slowest successful request was the administrator’s unfiltered monthly reconciliation at 545 ms. All 92 authorized reads matched their baseline results and pagination ranges. Eight restricted reads returned the expected authorization errors. The comparison excluded scheduler timestamps and the retry count from readiness payloads, because the background worker can update those fields between requests. The full results include review filters, native source reads, assignments, inventory and historical payouts. [Per-request measurements](evidence/frontend_query_latency_2026-11-24.json)

## Join and index choices

- **Transaction lists, counts and totals.** Each RPC resolves the caller’s permitted company scope once. PostgreSQL can push date, marketplace, currency and company filters into the allocation query before sorting or aggregating. A date page that requests rows alone uses the posting-time index to find a small range of complete UTC days at the requested end. If that range yields too few authorized rows after filtering, the query searches the entire requested range. Exact counts use the full filters. Amount ordering reads up to 10,001 candidates to verify the existing 10,000-row limit.
- **Direct and reference allocations.** Sales, refunds and account-level amounts join their transaction headers directly. SKU fees join the selected assignment version, marketplace and valid date range. A partial index on `finances_amounts(version_id)` covers the remaining routes. The reference calculation matches charges to source units by seller, regional account, source and native key before joining invoice or warehouse amounts in their currency. Distinct product and month lookups resolve ledger or order ownership once per key. Each original reference row still contributes its own amount, including duplicates. In the measured plan, resolving the native key first avoided a currency-first join that produced 167,799 candidates for 6,575 matches.
- **SKU catalog and fee configuration.** The catalog seeks from one distinct SKU to the next in the `(sku, version_id)` index and checks the transaction header for activity. A second partial index with the same keys covers rows with a fee base. It supplies the editor’s required dates. Periods, requirements and issues are grouped by SKU before joining the response. On the populated clone, 29 index seeks enumerated the 28 historical Finances SKU keys and 32 transaction headers were checked.
- **Financial review.** The administrator RPCs apply the selected outcome, marketplace, month and page bounds inside the permission check. A company-outcome page can start with the latest posting day when that day alone supplies the requested prefix. Monthly reconciliation combines the signed base and tax contributions by account, marketplace and currency.
- **Payouts.** The saved header supplies grand totals. Record pages and type breakdowns resolve the report’s pinned versions, with a plan chosen for the actual pin lists. Payout setup checks inspect the direct SKU amounts eligible for a service fee. Replaying the largest reports still costs more than reading their headers, as the measurements show.

A separate last-page test on the populated clone took 480 ms for the administrator and 236–367 ms for members, down from about 3.5 seconds. All three accounts also returned an empty page when asked for an offset beyond their visible rows.

The complete current calculation and all distinct saved pin selections were also compared with the original SQL on a populated clone. All 285,479 compared results matched in values, multiplicity and dependency membership. Use the clone-based benchmarks for repeated warm measurements or to rerun on a larger representative seed. [Benchmark commands and fixture setup](../services/db/supabase/benchmarks/README.md)
