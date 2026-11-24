# Frontend query performance

The 24 November 2026 workload used the populated local preview with 48,493 Finances transactions, 308,886 amount rows, 72 monthly reconciliation scopes and 63 saved report versions. Each request below used normal Supabase authentication. The administrator and both company members saw the same financial results and pagination boundaries as on the baseline commit `22921d8`.

| Request | Administrator | Company A | Company B |
| --- | ---: | ---: | ---: |
| Open Transactions | 95 → 84 ms | 68 → 80 ms | 65 → 69 ms |
| Transactions at offset 2,500 | 252 → 116 ms | 211 → 101 ms | 141 → 90 ms |
| Exact transaction count | 273 → 275 ms | 210 → 180 ms | 173 → 149 ms |
| Weekly trends | 329 → 229 ms | 257 → 186 ms | 199 → 161 ms |
| Type totals | 236 → 109 ms | 201 → 108 ms | 141 → 91 ms |
| Saved payout records, first page | 242 → 49 ms | 225 → 45 ms | 80 → 28 ms |
| Saved payout totals by type | 234 → 79 ms | 219 → 68 ms | 73 → 63 ms |
| Monthly reconciliation, all markets and months | 572 → 326 ms | Admin only | Admin only |

The times are individual HTTP measurements in milliseconds and include local transfer. The slowest of the 92 successful reads was the administrator's monthly reconciliation at 326 ms. Eight restricted reads returned the same authorization errors. Comparisons include ordered values and Content-Range. They exclude three scheduler retry and timestamp fields that can change independently. [All 100 comparisons](evidence/frontend_query_latency_2026-11-24.json)

## How the reads work

- **Scope and pagination.** A transaction RPC resolves the caller's company scope once. Date pages seek a small range of complete UTC days using the posting-time index. Sparse filters fall back to the full requested range. The raw Finances page and count share one set of date, SKU, marketplace, type and search predicates. A count with only amount filters can skip the header join. Only the returned page needs full row details.
- **Allocation and monthly totals.** Exact SKU and SelBox amounts use the direct allocation path. Reference charges match on regional seller, native key and currency before looking up ledger or order ownership. Repeated reference rows retain their individual amounts while sharing lookups. Monthly reconciliation groups native activity and attributed amounts by account, marketplace, currency and posting month. The base and tax controls include all native activity.
- **Payout reads.** The saved report header supplies the grand totals and unfiltered record count. Dense unfiltered pages can resolve the most recent day using the pinned inputs. If that day cannot fill the requested page, the reader expands to the complete report. Type-filtered counts use only matching pinned records. The new and original queries produced identical fields for all 125,747 saved records, including 21,395 records in the largest report.
- **Payout search.** One RLS-scoped query returns distinct visible report months in a single snapshot. The browser matches the user's text against its displayed date labels. A searched page or count takes two requests, down from five in each measured account.
- **Index footprint.** On identical data and equally rebuilt indexes, the application went from 94 indexes totaling 94.84 MiB to 84 totaling 70.23 MiB. The general SKU index holds the SKU alone; fee-bearing rows retain a separate covering key. The common raw type count took 26 ms versus 42 ms in interleaved trials. The running preview occupied 82.84 MiB after rollout. [Index choices, byte counts and publication measurements](index_design.md)

## Verification and reproduction

The query contract test calls every exported frontend client method and checks the complete HTTP method and route inventory. It uses two companies, an administrator and an unassigned login on a disposable stack. It exercises Auth, paged reads and counts, source detail, inventory, saved reports, filters and all five application mutations. [Coverage map and runnable test](frontend_query_coverage.md)

A supplemental run invoked 35 operations through the production client with the administrator and both company logins. It covered nested requests for month search, standalone HEAD counts, date anchors, fee history and inventory snapshots. All decoded results and terminal status/range headers matched. These operations made 65 HTTP requests in total, down from 101. All five application mutations also ran in rolled-back transactions on populated clones. A 64-SKU update took 199 ms versus 213 ms. A named assignment took 16 ms versus 11 ms. [Client operations and mutation measurements](evidence/frontend_client_operations_2026-11-24.json)

The financial comparison also checked all 158,838 current outcome rows and 126,641 rows across the 32 distinct frozen pin selections. Values, duplicate multiplicity and dependency membership matched. Use the workspace benchmark for repeated role-bound timings on a populated local project and the clone-based workloads for transaction pagination, search and aggregation. [Benchmark commands](../services/db/supabase/benchmarks/README.md)
