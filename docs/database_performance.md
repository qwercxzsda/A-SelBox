# Database performance

This guide describes the current read design. [Query contracts](transaction_query_contracts.md)
define API behavior; [access control](access_control.md) defines visibility. Historical measurements
are kept with their source snapshots under [evidence](evidence/README.md).

## Request paths

| Request | Work performed |
| --- | --- |
| Date-ordered page | Filter authorized facts, select bounded candidates in date/ID order, merge sources, then resolve metadata and fees for the page. |
| Reported-amount page | Stop after 10,001 fully filtered matches; reject scopes above 10,000, otherwise sort and calculate the selected page. |
| Exact count | Count authorized source facts and reconciliation groups without fee calculation. The browser renders rows first and caches counts independently of page and order. |
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

### Reconciliation work

For mature dates, administrator reads aggregate Settlement controls and Data Kiosk costs by seller, day,
marketplace, and currency. These derived groups join the live ledger; member reads exclude them.
Date and marketplace predicates can restrict grouping, while broad administrator counts and totals
still pay for the matching source aggregation. Company and SKU selections omit account groups.

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

## Measurement evidence

The [September 27 source-index snapshot](evidence/date_bounded_indexes_2026-09-27/README.md)
records authenticated local request timings, exact-response checks, plans, and insertion costs on
a synthetic million-row history fixture. It predates the current source-authority
rules, so its counts and timings describe that historical schema. Use the maintained
runners below to measure the current ledger.

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
