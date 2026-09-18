# Frontend table loading investigation, September 19, 2026

## Finding

The main measured delay is database work behind `live_company_components`. A
25-row Transactions page took about **2.0 seconds for a company member** and
**1.3 seconds for an administrator** on the existing local seeded database.
Almost all HTTP time elapsed before the first response byte.

The live view constructs a complete permitted transaction result through a
PL/pgSQL function before applying the outer filters, ordering, and page limit.
The frontend also requests an exact count on every page. PostgREST performs a
separate read of the same view for that count, approximately doubling the work.
The complete filter-option lists repeat this expensive operation several times.

This investigation changed documentation only. It did not change database
functions, indexes, policies, settings, migrations, or frontend loading behavior.

## Scope and method

- Observed September 19, 2026 in Asia/Seoul; HTTP measurements ran September 18,
  15:58–16:01 UTC.
- Existing `aselbox_frontend_seed` Docker stack: PostgreSQL 17.6.1.167,
  PostgREST 16.2, API on loopback port 55421. This is a local seeded workload,
  not a production capacity test.
- Used the documented dummy company-member and administrator accounts and their
  normal authenticated access. No service-role bypass was used for HTTP reads.
- Every core case had one separately recorded initial observation and three
  subsequent requests. Tables below use the median of those three repeats.
  Connections were serial HTTP/1.1 keep-alive requests. Database and OS caches
  were not flushed, so the initial observation is not a proven cold-cache test.
- HTTP and database-plan measurement phases were separate. The existing browser
  remained open and could issue its usual once-per-minute refresh; this is a
  possible source of timing variation.
- All 80 core HTTP requests succeeded. Requests accepted gzip, but the local
  responses used identity encoding.
- [Sanitized HTTP measurements](frontend_table_loading_2026-09-19_http.json)
  preserve each sample. No financial rows, SKU values, credentials, or tokens
  are included.

## HTTP results

All cases request 25 rows. The normal Transactions projection has 24 columns;
the narrow projection has four. Counts and filters are calculated server-side.

| Request                                                   | Company member, median ms | Administrator, median ms |
| --------------------------------------------------------- | ------------------------: | -----------------------: |
| Transactions, normal request with exact count             |                     2,002 |                    1,315 |
| Same request without exact count                          |                       987 |                      674 |
| Transactions, four columns with exact count               |                     2,068 |                    1,330 |
| Transactions, one day with exact count                    |                     2,124 |                    1,324 |
| Transactions, one SKU with exact count                    |                     2,005 |                    1,293 |
| Transactions, offset 25 with exact count                  |                     2,257 |                    1,337 |
| Transactions, offset 1,000 with exact count               |                     2,315 |                    1,308 |
| Transactions, reported amount descending with exact count |                     2,314 |                    1,316 |
| Settlement source endpoint with exact count               |                       337 |                       66 |
| Data Kiosk source endpoint with exact count               |                       810 |                       23 |

The exact count adds approximately another complete live-query execution. Even
without counting, the live page still takes about one second for the member.

Returning fewer columns reduced the member response from 9,940 to 1,693 bytes
without improving latency. Across the core requests, median transfer time after
the first body byte was 0.019 ms. Median decode/CSV parsing in the Python timing
harness was 0.205 ms. This rules out response size as the explanation for the
observed multi-second HTTP wait; it is not a measurement of browser parsing or
React rendering.

The full member query matched 41,132 rows; the administrator query matched
87,530. Restricting the member to one day reduced the matching count to just
51, but still took 2.1 seconds. Outer filtering does not reduce the resolver's
input scope. Offset and alternative ordering are not the main explanation for
the baseline delay in these measurements.

Direct source endpoints perform different work and are not substitutes for the
combined fee-calculated view. Their timings help localize the cost to the live
calculation path. The member/administrator difference also matters: fewer
visible rows do not necessarily produce a faster request because authorization
has a cost.

## Database plan evidence

Read-only `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` used the authenticated
company-member role and caller claims, with bounded statement/lock timeouts.
The page query preserved the frontend's zero-Data-Kiosk exclusion and ordering.
The [sanitized plan summary](frontend_table_loading_2026-09-19_plans.json)
retains node timings, row counts, buffers, existing index checks, and query
conditions. Each plan was measured once after the HTTP benchmark; EXPLAIN's
instrumentation overhead and the warmed cache limit comparisons with raw HTTP.

| Plan                     | Execution time, ms | Result                                              |
| ------------------------ | -----------------: | --------------------------------------------------- |
| Page only                |            972.542 | 25 rows returned after scanning the resolved result |
| September 1–10 page      |            981.417 | 3,335 matching rows considered before returning 25  |
| Exact count only         |            969.113 | Counted the 41,132 matching rows                    |
| Page plus separate count |          1,892.313 | Two independent resolver function scans             |

The page-plus-count plan is a diagnostic equivalent of the two reads, not the
entire PostgREST CSV/response wrapper. Existing `pg_stat_statements` contained
the actual normalized PostgREST statement and confirmed a separate
`pgrst_source_count` reading `live_company_components`.

The plans show:

1. **Broad work precedes the page limit.** Each resolver scan produces 48,540
   company-visible rows. In the default query, 41,132 survive and 7,408 are
   discarded by the outer filter. In the September 1–10 query, 3,335 survive and
   45,205 are discarded. The function still builds the same 48,540-row result.
2. **Authorization contributes before the main result is available.** In the
   page plan, enumerating permitted Settlement versions took about 80 ms and
   permitted Data Kiosk day versions about 189 ms. These scans invoke
   `can_read_current_source_version` under RLS. Further authorization work inside
   the resolver is included in its cost and was not separately profiled.
3. **The result spills to temporary storage.** Each pass recorded 1,455 temporary
   blocks read and written, about 11.37 MiB in each direction with 8 KiB blocks.
   The page-plus-count plan doubled this to 2,910 blocks. Temp-block counts show
   additional work; they do not quantify its share of elapsed time.
4. **Base-page cache misses and the final sort are not demonstrated bottlenecks.**
   The page plan recorded roughly 733,000 shared-buffer hits and no shared-buffer
   reads. These are accesses, not distinct pages. The final sort used a 32 KiB
   top-N heapsort. Most elapsed time preceded the first function-scan row.

The mechanism is visible in
[`live_company_components` and its resolver](../../services/db/supabase/migrations/20260912072704_live_company_reads.sql):
the view passes arrays of all permitted current versions to the PL/pgSQL
resolver; its `RETURN QUERY` generates the result before the outer predicates
and `LIMIT` can operate. PostgreSQL documents that `RETURN QUERY` buffers its
complete result and may spill it to disk.
([PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-STATEMENTS-RETURNING))

## Filter-menu loading

Menu choices are fetched only when a menu opens. They do not gate the initial
table page. However, each complete choice list performs sequential projected
queries through the same live view, advancing past duplicate values until an
empty response completes the scan. Choices are published only after all those
requests finish. Exact counting is already omitted for these requests.

Each row below is one completed scan, not a three-run median. Scans were bounded
to 20 requests or 30 seconds; all completed within the bound. Search inside the
menu is local after the choices have loaded.

| Role           | Menu        | Requests | Distinct choices | Total time, seconds |
| -------------- | ----------- | -------: | ---------------: | ------------------: |
| Company member | SKU         |        8 |               30 |                9.21 |
| Company member | Marketplace |        6 |               14 |                6.87 |
| Company member | Type        |       15 |               63 |               17.38 |
| Administrator  | SKU         |       13 |               46 |                8.71 |
| Administrator  | Marketplace |       12 |               15 |                7.79 |
| Administrator  | Type        |       20 |               70 |               13.38 |

The frontend's complete-option loading strategy therefore amplifies the
database cost. It must not be confused with slow checkbox rendering or ordinary
table-page loading.

## Frontend factors that make the delay noticeable

These are confirmed code paths, not separate browser CPU measurements:

- [`use-finance-table.tsx`](../../services/frontend/user-webpage/src/use-finance-table.tsx)
  supplies an empty row list while an uncached page/filter/sort query is pending.
  Previous rows are not retained as placeholder data, and there is no adjacent
  page prefetch. The full-height table can collapse and refill during the wait.
- [`use-auth.ts`](../../services/frontend/user-webpage/src/use-auth.ts) waits for
  sign-in and then account/company/SKU lookups before the table mounts. The three
  lookups run in parallel, but each paginated lookup finishes all its pages.
- [`use-workspace-refresh.ts`](../../services/frontend/user-webpage/src/use-workspace-refresh.ts)
  revalidates those lookups before invalidating table data on periodic/focus
  updates. Pagination is disabled for that complete update interval, even when
  cached rows remain visible.
- Text search intentionally waits 250 ms. Resetting to page zero before the
  debounce finishes can briefly request the old search's first page if it is
  not cached. This does not explain the two-second response to a single query.
- [`api/client.ts`](../../services/frontend/user-webpage/src/api/client.ts)
  requests `Prefer: count=exact` on every table page and waits for every option
  page before returning a menu's choices. These request patterns expose and
  multiply the database limitation.

No React profiler trace was collected. The in-app browser diagnostics did not
expose resource timing through the available read-only interface. The evidence
establishes substantial server-side waiting, not a precise browser-rendering
budget. Normal pages render 25–100 rows and their cells do not issue individual
API requests.

## Reproducing the comparison

Use the existing seeded stack and normal dummy-user authentication. Do not
reset the database, clear its caches, or run the reads as a service role when
comparing member timings.

The baseline is a GET to `/rest/v1/live_company_components` with:

- `select`: the `LIVE_COLUMNS` projection in frontend `src/api/config.ts`;
- `order=activity_date.desc.nullslast,source.asc,source_row_id.asc`;
- `limit=25`, `offset=0`;
- `and=(or(source.neq.DATA_KIOSK,source_amount.neq.0))`;
- `Accept: text/csv` and `Prefer: count=exact`, plus the normal API key and
  caller bearer-token headers.

Repeat without `Prefer`, then with only
`source,source_row_id,activity_date,source_amount` selected. Keep all other
parameters unchanged. Date/SKU cases in the HTTP measurements used one available
value from each role's first page; that value was not retained in the evidence.
The SQL date-range plan used September 1–10, 2026. To reproduce the query plans,
use a read-only transaction with the authenticated role and that dummy user's
claims, preserve the visibility predicate, and compare page-only, count-only,
and their separate combination.

For option scans, project just `sku`, `marketplace_name`, or `component_type`,
order ascending, request 1,000 rows, and advance with the column's `gt` cursor
until an empty page. Preserve the same visibility filter and omit the exact
count. Record every request, including the final empty one.

## Deferred work

The identified database issue remains open: the resolver cannot limit its
input to the requested scope, and exact counting repeats its work. Any future
database change needs to preserve company authorization, version selection,
fee semantics, and exact decimals. The measured result does not justify blindly
adding indexes, increasing memory, or weakening RLS.

The frontend count/option-fetch strategy and empty loading state are also
documented for later consideration. No remediation was attempted in this
investigation, as requested.
