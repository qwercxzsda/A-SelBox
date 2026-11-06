# Database performance

This guide describes the current read design. [Query contracts](transaction_query_contracts.md)
define API behavior; [access control](access_control.md) defines visibility.

## Request paths

| Request              | Work performed                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date-ordered page    | Filter authorized facts, select bounded candidates in date/ID order, merge sources, then resolve metadata and fees for the page.                                   |
| Reported-amount page | Stop after 10,001 fully filtered matches; reject scopes above 10,000, otherwise sort and calculate the selected page.                                              |
| Exact count          | Count authorized source facts without fee calculation. The browser renders rows first and caches counts independently of page and order. |
| Period total         | Filter dates and scope, combine facts sharing fee inputs, resolve relevant terms and fees, then aggregate by currency and optional Type.                           |
| Filter options       | Source, Marketplace, and Type use static catalogs. Members reuse loaded assignments; administrators preload one complete SKU catalog.                              |
| Assignments and fees | Load the caller's complete SKU configuration, deduplicate required source dates, and return compressed coverage ranges and setup gaps in one response.             |
| Revision polling     | Read the current account and requested revision-token rows, then refresh only dependent queries when a revision changes.                                           |
| Financial review     | Apply the requested marketplace, category, and date bounds to current source facts before monthly/type grouping; page exact source records separately.       |

### Authorization and current versions

Finance identities select immutable transaction versions; Data Kiosk day headers select complete
day versions. Fact RLS checks current selection, category and SKU ownership. Finance parent and
batch metadata follows owned current activity, with parent totals and inventory/hash fields excluded
from member column grants. Data Kiosk references likewise follow current owned components. Full
source metadata is administrator-only.

`private.current_owned_sku_terms()` obtains the member's current permitted identities and terms
IDs as a set. It uses stored account state and selected pointers; it is not a persisted permission
cache. Page and total queries materialize terms only for selected rows or grouped facts. Missing
ownership and fee periods retain the financial contract's explicit NULL behavior.

Exact SKU is the single ownership key. An import through another namespace reuses the same
assignment and fee revision. The registry has one `UNIQUE (sku)` index; ownership joins and
count indexes carry no namespace term. Totals also omit namespace from their intermediate groups,
so compatible facts from every namespace share one fee lookup. Raw rows retain their identities.

### Indexes

Finance indexes follow the normalized model: date and marketplace/date indexes are on
`finances_transaction_versions`; SKU/version and Type/version indexes are on
`finances_transaction_components`. Stable identities have seller/scope/native-ID uniqueness, native-ID
lookup and current-pointer indexes. Membership keys connect successful batches to immutable
versions without copying unchanged components. Filtering a Finance date page therefore joins
transaction metadata to components.

Data Kiosk indexes date/ID and marketplace/date on stable days, with compact SKU/version and
Type/version keys on components. Membership and current-pointer indexes identify the exact
observation without duplicating day metadata or component contents.
The [index map](transaction_query_contracts.md#index-access-paths) lists the exact current keys.

Finance publication uploads prepared rows in batches and switches pointers atomically after Python
source validation. Component totals and Summary controls are not queried repeatedly by the payout
worker. Payout selection checks successful batch membership against current transaction versions.
New versions add storage only for changed normalized state; each observation still adds compact
membership records.

Predicate selectivity, parent/component joins, RLS and row visibility determine actual plans.
Index-only behavior is not promised by the schema. Measure the installed model with representative
data before using its timings or storage estimates for capacity planning.

### Diagnostic source aggregation

Two administrator read functions return source/category sums and counts: current selected facts for
an explicit range, or the immutable inputs already referenced by one report. Whole-scope and monthly
responses are complete aggregates across sellers. Daily pages keep every source/category for a
seller/day/marketplace/currency bucket together. The backend never calculates diagnostic differences.

The frontend computes comparisons with exact decimals, loads details lazily, and uses complete
headline aggregates rather than totaling a page. Current responses include source revision tokens
for cache consistency; saved report aggregates are cached by report ID and authorization identity.
Successful retrieval coverage comes from existing acquisition/batch/day metadata, not row counts.
Finance coverage selects acquisitions with accepted batches, so repeated preprocessing does not
expand the coverage query once per batch.
The [Financial review contract](financial_review.md#read-contract) defines the native RPC payloads.

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

The [benchmark runners](../services/db/supabase/benchmarks/README.md) exercise authenticated reads
against current-schema seeds and synthetic transaction fixtures. Verify exact results, authorization
and chosen plans together with timing. These local checks do not establish sustained production
throughput or latency. The [source evidence](evidence/README.md) records Amazon observations, not
performance targets for the application.

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

Keep ANALYZE and vacuum maintenance appropriate for imports. Before production, measure
realistic company skew, sustained concurrent reads, imports, and cold data, then set latency and
throughput targets. Import costs and revision-token writer contention are separate from
these frontend read measurements.
