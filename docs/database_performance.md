# Database performance

This guide describes the current read design. [Query contracts](transaction_query_contracts.md)
define API behavior; [access control](access_control.md) defines visibility. The
[measurement snapshot](evidence/date_bounded_indexes_2026-09-27/README.md) records the active
implementation on a synthetic million-row history fixture.

## Request paths

| Request | Work performed |
| --- | --- |
| Date-ordered page | Filter authorized facts, select bounded candidates in date/ID order, merge sources, then resolve metadata and fees for the page. |
| Reported-amount page | Stop after 10,001 fully filtered matches; reject scopes above 10,000, otherwise sort and calculate the selected page. |
| Exact count | Count authorized matching facts without fee calculation. The browser renders rows first and caches counts independently of page and order. |
| Period total | Filter dates and scope, combine facts sharing fee inputs, resolve relevant terms and fees, then aggregate by currency and optional Type. |
| Filter options | Source, Marketplace, and Type use static catalogs. Members reuse loaded assignments; administrators preload one complete SKU catalog. |
| Revision polling | Read the current account and at most three revision-token rows, then refresh only dependent queries when a revision changes. |

### Authorization and current versions

Source headers select complete current versions. Fact RLS checks that selection, source category,
and current seller/SKU ownership. Metadata policies use registered membership and current pointers;
they do not scan facts to establish metadata ownership. Full metadata is operator-only, while
members share narrow current references.

`private.current_owned_sku_terms()` obtains the member's current permitted identities and terms
IDs as a set. It uses stored account state and selected pointers; it is not a persisted permission
cache. Page and total queries materialize terms only for selected rows or grouped facts. Missing
ownership and fee periods retain the financial contract's explicit NULL behavior.

### Indexes

Each source has one reversible `(date, id)` index and compact `(sku, date)`, `(component_type, date)`,
and `(marketplace_name, date)` indexes. Date-leading partial covering indexes support counts:
Settlement includes category `SETTLEMENT`; Data Kiosk includes nonzero amounts across categories.
Settlement also has a compact ownership/version index for unbounded and marketplace counts.
The [index map](transaction_query_contracts.md#index-access-paths) lists exact keys and consumers.

Date bounds are applied to facts before counting, grouping, or fee lookup. Leading with date limits
the covering index's range even without a selected SKU or Type. Index-only counts depend on the
visibility map maintained by vacuum. Totals still fetch amounts and fee inputs from source rows.

A single selected marketplace uses scalar text equality. Small multi-marketplace date pages obtain
bounded candidates per marketplace before merging. Larger candidate budgets use the ordinary
array-filter path. This strategy changes execution, not the result limit or visible rows.

### Search and SKU discovery

The frontend matches literal, case-insensitive search text against complete local catalogs and sends
exact SKU/Type/Marketplace/Source alternatives. Other column selections combine with search using
AND. Currency is excluded. Empty matches return no rows; a broad search can still require many
candidate checks and a different count plan from a direct Type filter.

Administrator-only `sku_filter_options()` returns exact distinct source and registered SKU strings
in one JSON response. It seeks between distinct names in the existing SKU/date indexes, then merges
and sorts the catalog in `C` order. It includes retained history, unregistered imports, zero rows,
and registered-only SKUs. Members use their loaded assignments and cannot call this RPC.

The administrator catalog can be reused after fresh account and source/fee revision checks.
Account changes, changed revisions, explicit retry, and a new page load require the appropriate
reload. Company names and assignments are independently refreshed. None of these caches replaces
request-time authorization.

## Measured current workload

The September 27 snapshot uses PostgreSQL 17, 1,032,440 source facts, 129 seller/SKU registrations,
580 Settlement headers, and 16,200 Data Kiosk day headers. Ten shifted seasonal cohorts retain the
real seed's value distributions. Measurements are authenticated local HTTP medians after one warmup
and three measured repetitions. Pages exclude their separately fetched exact count.

The 60-day window is July 16–September 13, 2026, inclusive. It contains 35,631 member and 67,411
administrator Transactions rows. Date parameters remain optional; the frontend does not yet apply
an automatic default range.

| Request | Company member | Administrator |
| --- | ---: | ---: |
| 60-day newest page | 11.2 ms | 8.6 ms |
| 60-day count | 16.6 ms | 12.9 ms |
| 60-day direct Type count | 13.3 ms | 11.7 ms |
| 60-day all-currency total | 52.3 ms | 126.9 ms |
| No-DATE newest page | 9.7 ms | 8.7 ms |
| No-DATE count | 134.0 ms | 101.6 ms |
| No-DATE direct Type count | 106.5 ms | 82.7 ms |
| No-DATE broad `fee` search count | 136.9 ms | 341.8 ms |

The unbounded count covers 463,980 member or 875,300 administrator rows. An explicitly requested
full available-date-range administrator total processes 875,300 rows across nine currencies in
about 2.3 seconds. This is separate from the ordinary page/count request and is not automatically
requested by an empty Selected Dates card.

The ordinary bounded count uses index-only scans with zero heap fetches on the vacuumed fixture.
Its source scans report 227 Settlement and 141 Data Kiosk shared buffer read blocks. These counters
exclude shared-buffer hits and do not establish physical disk I/O. Current-version and ownership
inventories still have their own work outside the fact date range.

The [snapshot](evidence/date_bounded_indexes_2026-09-27/README.md) includes complete request scopes,
response hashes, plans, and isolated insertion measurements. Warm local results and repeated seed
distributions do not establish cold-cache latency, production concurrency, or a universal bound.

## Scaling limits

- Exact counts and sums still process their qualifying data. A narrower date range does not bound
  current ownership or current-version header inventories.
- Broad free-text matches can choose bitmap heap scans even when direct Type selection uses an
  index-only path. Both preserve the same matching-row semantics.
- Wide selected-date totals and Type details add aggregation work. Details use one selected
  currency; their timings are not comparable to all-currency totals as if scopes were equal.
- Reported-amount ordering is deliberately limited to 10,000 matches. Deep offset jumps remain a
  supported and accepted cost; they are not equivalent to fetching the first page.
- Identity refresh reads complete assignments and company labels. Administrator catalog work grows
  with distinct SKU count, and the browser retains the complete searchable list.
- Current fees load only visible expanded groups, with one cached request per seller/SKU assignment.
  Large SKU menus render their matching checkboxes. Further fee/menu optimization is deferred until
  a measured usability issue warrants it.

The current design has no financial rollup cache, materialized serving projection, or realtime
subscription. Ownership remains a live decision: reassignment changes live historical visibility
without rewriting immutable facts, while saved payout reports retain captured versions.

## Verification and operations

Use the [maintained benchmark runners](../services/db/supabase/benchmarks/README.md) on owned
disposable clones. Compare exact amounts, ordering, visibility, response completeness, index size,
and publication cost as well as latency. Measure actual caller roles rather than substituting
privileged query plans. Inspect selectivity, rows visited, shared buffers, and temporary writes.

Keep ANALYZE and vacuum maintenance appropriate for imports and pruning. Before production, measure
realistic company skew, sustained concurrent reads, imports, and cold data, then set latency and
throughput targets. Import/pruning costs and revision-token writer contention are separate from
these frontend read measurements.
