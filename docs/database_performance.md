# Database performance

This guide describes the current read design. [Query contracts](transaction_query_contracts.md)
define API behavior; [access control](access_control.md) defines visibility.

## Request paths

| Request | Work performed |
| --- | --- |
| Date-ordered page | Filter authorized facts, select bounded candidates in date/ID order, merge sources, then resolve metadata and fees for the page. |
| Reported-amount page | Stop after 10,001 fully filtered matches; reject scopes above 10,000, otherwise sort and calculate the selected page. |
| Exact count | Count authorized source facts and reconciliation groups without fee calculation. The browser renders rows first and caches counts independently of page and order. |
| Period total | Filter dates and scope, combine facts sharing fee inputs, resolve relevant terms and fees, then aggregate by currency and optional Type. |
| Filter options | Source, Marketplace, and Type use static catalogs. Members reuse loaded assignments; administrators preload one complete SKU catalog. |
| Assignments and fees | Load the caller's complete SKU configuration, deduplicate required source dates, and return compressed coverage ranges and setup gaps in one response. |
| Revision polling | Read the current account and requested revision-token rows, then refresh only dependent queries when a revision changes. |
| Financial review | Apply category and fully mature month bounds to current source facts before monthly/type grouping; page exact source records separately. |

### Authorization and current versions

Source headers select complete current versions. Fact RLS checks that selection, source category,
and current SKU ownership. Metadata policies use registered membership and current pointers;
they do not scan facts to establish metadata ownership. Full metadata is administrator-only, while
members share narrow current references.

`private.current_owned_sku_terms()` obtains the member's current permitted identities and terms
IDs as a set. It uses stored account state and selected pointers; it is not a persisted permission
cache. Page and total queries materialize terms only for selected rows or grouped facts. Missing
ownership and fee periods retain the financial contract's explicit NULL behavior.

Exact SKU is the single ownership key. An import through another namespace reuses the same
assignment and fee revision. The registry has one `UNIQUE (sku)` index; ownership joins and
count indexes carry no namespace term. Totals also omit namespace from their intermediate groups,
so compatible facts from every namespace share one fee lookup. Raw rows retain their identities.

### Indexes

Each source has one reversible `(date, id)` index and compact `(sku, date)`, `(component_type, date)`,
and `(marketplace_name, date)` indexes. Date-leading covering indexes support counts:
Finances uses a partial index for category `FINANCES`; Data Kiosk includes all
amounts across categories, including zero.
Finances also has a compact ownership/version index for unbounded and marketplace counts.
The [index map](transaction_query_contracts.md#index-access-paths) lists exact keys and consumers.

Finances native parents have an indexed seller/native-ID lookup for current
identity conflicts and a release-reference index for lifecycle validation.
Components have a parent-ID index for complete partition checks. Publication
inserts whole parent/component day inventories in bulk. Summary checks use
exact version manifests; they are performed for pending company/month work,
not by scanning every completed payout every five minutes.

Date bounds are applied to facts before counting, grouping, or fee lookup. Leading with date limits
the covering index's range even without a selected SKU or Type. Index-only counts depend on the
visibility map maintained by vacuum. Totals still fetch amounts and fee inputs from source rows.

A single selected marketplace uses scalar text equality. Small multi-marketplace date pages obtain
bounded candidates per marketplace before merging. Larger candidate budgets use the ordinary
array-filter path. This strategy changes execution, not the result limit or visible rows.

### Reconciliation work

For mature dates, administrator reads aggregate Finances controls and Data Kiosk costs by seller, day,
marketplace, and currency. These derived groups join the live ledger; member reads exclude them.
Date and marketplace predicates can restrict grouping, while broad administrator counts and totals
still pay for the matching source aggregation. Company and SKU selections omit account groups.

[Financial review](financial_review.md#read-contract) compares each monetary category directly from
current source facts, without company ownership or fee joins. Single-row date anchors identify the
available years; a bounded calendar-year aggregation supplies the currency menu and up to twelve
monthly rows for the selected currency. Only fully mature months participate. The selected month's
type totals and source rows have their own bounded, currency-filtered queries. Date discovery can
still examine many eligible rows; it is not a constant-time lookup or a full-history rollup cache.

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

The maintained runners below exercise authenticated reads across namespaces and different
workload shapes using native Finances fixtures. Current verification includes live/native/Data
Kiosk EXPLAIN paths for date and amount ordering, plus independent result comparisons.
The [dated verification records](evidence/README.md) distinguish these regression checks from
real API and HTTP pipeline checks. They do not establish a throughput
or latency target for production data; measure the intended workload before capacity planning.

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
- Current fees loads one role-scoped configuration with periods and source-derived coverage.
  The administrator editor keeps complete state for global setup diagnostics and validates each
  staged SKU's full configuration when publishing; unrelated gaps do not block that batch.
  The list renders a local page at a time. Source or terms revisions invalidate that configuration.

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
