# Transaction query contracts

The browser uses authenticated Supabase REST/RPC requests. The database owns filtering,
authorization, pagination, and exact financial calculation. Current definitions are listed in the
[database module map](../services/db/supabase/README.md#schema-modules); each RPC has one signature.

## Shared behavior

All six RPCs are stable, security-invoker functions with an empty search path and custom query
plans. Execution is granted to `authenticated`, with grants revoked from `PUBLIC`, `anon`, and
`service_role`. Existing table RLS determines actual access: authentication alone does not grant
company data. Company ownership and account access come from database state. An explicit company
filter can narrow the caller's visible data but cannot expand it.

The SKU discovery RPC additionally requires a current stored application-operator account. Company
members use their assigned SKUs and cannot call that administrator endpoint.

Current transaction reads use PostgreSQL's current UTC date minus the mature cutoff
period of two calendar months as the mature cutoff date. Dates before it are mature;
the mature cutoff date and later are recent.
Recent dates use Data Kiosk amounts in all three monetary categories. Mature dates use
Settlement report amounts in the Settlement and SelBox categories, Data Kiosk amounts in the
Data Kiosk category, and administrator-only `RECONCILIATION` rows. Each derived row is the
Settlement report control minus the Data Kiosk amount in the Data Kiosk category, grouped by
day/marketplace/seller/currency with a nonzero subtotal in at least one source.
Matching nonzero controls retain a zero difference row; groups with both subtotals zero have no
derived transaction row. These choices use the unchanged preprocessing categories. For mature dates,
the complete account total equals the Settlement report total. Members see only their assigned amounts
in the Settlement and Data Kiosk categories. Rows in the SelBox category and difference rows have
zero company contribution and remain administrator-only. Company/SKU
filters omit these account controls rather than apportioning them. Comparison and
analysis rows do not count toward pages, counts, or totals. Strict reads additionally
validate complete required coverage and ownership/fees. Monthly reports require
month end strictly before the mature cutoff date. Source changes and reassignment affect live
reads but cannot change saved reports.

Date bounds are inclusive, finite calendar dates. If both are supplied, the start cannot exceed the
end. Selection arrays are one-dimensional and cannot contain null members. Omitted, null, or empty
arrays mean no ordinary selection restriction. Search arrays have separate NULL/empty semantics
described below. Marketplace arguments use `text[]`; clients send JSON string
arrays. The shared validator rejects unsupported names, including mixed valid/invalid selections,
with SQLSTATE `22023`. Stored marketplace names have `CHECK` constraints preserving the same
24-name vocabulary validated by Python. Optional scalar nulls retain their existing meaning.

Row amounts, quantities, rates, aggregate sums, and counts are exact decimal strings in RPC JSON.
Unknown financial amounts remain null. Explicit zero amounts and rates remain zero. Currency groups
are always separate; database calculations do not convert currencies.

## Transaction pages

[`public.transaction_page`](../services/db/supabase/migrations/20260928123134_transaction_page.sql)
accepts:

| Parameter                  | Default | Meaning                                                           |
| -------------------------- | ------- | ----------------------------------------------------------------- |
| `p_limit`                  | `25`    | Integer page size, 1–1,000.                                       |
| `p_offset`                 | `0`     | Nonnegative safe integer, at most 9,007,199,254,740,991.          |
| `p_search_skus`, `p_search_types`, `p_search_marketplaces`, `p_search_sources` | `null` | Exact frontend-resolved search sets, combined with OR. All null disables search; empty active sets match nothing. |
| `p_order_by`               | `date`  | Sort key: `date` or `amount` (reported amount).            |
| `p_direction`              | `desc`  | Ordering direction: `asc` or `desc`.                              |
| `p_date_from`, `p_date_to` | `null`  | Optional inclusive date bounds.                                   |
| `p_company_ids`            | `null`  | Current company UUID selection.                                   |
| `p_skus`                   | `null`  | Exact SKU text selection.                                         |
| `p_marketplaces`           | `null`  | Exact supported marketplace text selection.                       |
| `p_sources`                | `null`  | Source text selection.                                            |
| `p_types`                  | `null`  | Component-type selection, including the derived administrator difference.                                     |
| `p_include_count`          | `true`  | Whether to include an exact matching-row count.                   |
| `p_fee_applicable`         | `null`  | `true`: applicable source Type; `false`: other Types; null: both. |

Response: `{ "rows": [...], "total_count": "123" }`. With counting disabled, `total_count` is null.
An empty page still receives the full matching count when requested. Rows retain source identity,
metadata, current terms and fee references, quantities, amounts, and resolution diagnostics.
Derived differences use deterministic group UUIDs and do not identify a raw source transaction.

Filters, text search, and RLS apply before candidate selection. For date ordering the database takes
at most `offset + limit` eligible candidates per source, merges them, selects the page, and only
then resolves metadata and fees. Date ordering reverses the full
`(activity_date, source, source_row_id)` tuple: all ascending for oldest-first, all descending for
newest-first. Dates use `NULLS LAST` for ascending and `NULLS FIRST` for descending, matching
forward/backward scans of one ascending date/ID index per source; source dates are non-null. Amount
ordering keeps ascending source/ID ties and `NULLS LAST` in both directions. A combined page/count
response uses one statement and snapshot.

The materialized terms projection includes only seller/SKU keys present on that selected page.
It reads the existing invoker-security current-terms view and retains left joins, including
unassigned or unregistered operator-visible facts. Member RLS independently checks membership in
the caller's current ownership set before candidate selection; page limits cannot bypass it.

Date and Reported amount ordering, with or without text search, use this RPC. Reported amount is the
numeric source amount or derived difference, ordered with its sign; values are not converted between currencies.
Exact search-set predicates apply before
each source candidate limit; fee calculation still follows global page selection.

A single marketplace uses scalar text equality so its index prefix is fixed for date ordering.
Multiple selected marketplaces use distinct, date-ordered candidate reads per marketplace, each
bounded by `offset + limit`, before the normal source/global merge. All filters and RLS apply inside
those reads. A 4,096-candidate budget per source keeps this strategy bounded: if the selected array
length times `offset + limit` would exceed it, the query retains the direct array-filter path.
The budget only chooses an execution strategy; it does not restrict dates, results, or valid offsets.
Raw-source pages preserve an unbounded matching relation for exact counts. Reported amount ordering
retains its separate 10,000-match contract.

Amount ordering is available only when the full filtered result contains **at most 10,000 rows**.
The function gathers at most 10,001 matching candidates without ordering, checks that count, and
rejects an excess before sorting or calculating fees. With 10,000 or fewer matches, it sorts the
complete matching set, selects the page, and resolves its fees. Pagination offsets cannot bypass the
limit. When requested, the amount page's exact count reuses the bounded candidate count. Date
ordering and the separate count RPC remain uncapped. No amount-ordering indexes are needed.

Overflow raises SQLSTATE `22023` (HTTP 400), with the fixed message:
`Amount ordering is limited to 10,000 matching transactions. Narrow your filters or order by date.`
The frontend recognizes only that allowlisted error, explains how to narrow the result, and offers
Date ordering. A known exact count above the limit disables amount choices; the server remains
responsible for enforcing the cap when the count is unknown or stale.

The fee-applicability filter uses source Type codes before paging/counting: Settlement report rows
in the Settlement category with type
`PRODUCT_SALES` and `PRODUCT_REFUNDS`, and Data Kiosk `NET_PRODUCT_SALES`. The negative filter
also includes retained account and reconciliation rows. Explicit Type selections intersect this filter; they
do not replace it. These direct comparisons expose the existing `(component_type, date)` indexes.

Applicability is independent of configuration: a zero base, zero rate, missing ownership, or missing
configured rate does not change a transaction's Type. Current preprocessing maps these Types to the
existing fee-base rules. Calculations still use Settlement Order/Refund + ItemPrice + Principal and
Data Kiosk's stored fee base. The filter treats Type as authoritative if trusted direct SQL supplies
inconsistent fields; it does not rewrite a base or fabricate a configured rate.

## Raw source pages

[`public.source_transaction_page`](../services/db/supabase/migrations/20260928123136_source_transaction_page.sql)
serves the Settlements and Data Kiosk tabs. Its required `p_dataset` is `settlement` or
`data_kiosk`. Optional parameters are `p_limit` (25), `p_offset` (0), `p_order_by` (`date`),
`p_direction` (`desc`), `p_date_from`, `p_date_to`, `p_skus`, `p_marketplaces`, `p_types`,
`p_search_skus`, `p_search_types`, `p_search_marketplaces` (all null), and `p_include_count` (true). Sort keys, direction, bounds, date and array
validation follow the transaction page contract.

Response: `{ "rows": [...], "total_count": "123" }`, with a null count when disabled. Rows contain
the corresponding source-view fields selected by the frontend, including exact numeric strings.
Settlement orders by `posted_date` or `amount`; Data Kiosk uses `activity_date` or `amount`. Date
ordering reverses both date and row ID together, with the same null placement as Transactions.
Amount ordering keeps ascending row-ID ties and nulls last. Data Kiosk zero amounts are excluded
before pagination and counting; Settlement zero amounts remain.

This endpoint preserves the raw source views' visibility, including historical versions and every
source category available to the caller. It does not impose Transactions' current-version or
category and source-authority restrictions. Existing fact and metadata RLS still apply; choosing a dataset
cannot expand access. The UI exposes these tabs to administrators.

The same 10,000-match amount-ordering limit applies to each raw source tab, after its filters,
search, and RLS. Overflow is checked before sorting or metadata projection; exactly 10,000 matches
are allowed. Date ordering and source counts remain uncapped.

All source pages use this RPC, including text search. The frontend loads their exact counts
separately through `source_transaction_count`, using identical date, SKU, marketplace, Type, and
search arguments.

## Exact transaction counts

[`public.transaction_count`](../services/db/supabase/migrations/20260928123132_transaction_counts.sql)
accepts the same date, company, SKU, marketplace, source, Type, and fee-applicability filters as the
page RPC, including all four `p_search_*` arrays. It returns one exact count string, such as `"123"`, including `"0"`
for no matching rows. There are no paging or ordering parameters.

The function counts eligible source facts and derived reconciliation groups without resolving
company fees. Reconciliation still requires grouped source subtotals.
Search uses the same exact OR-set predicates as the page request. The
frontend can show rows before this separate request finishes, and reuses counts across page/order
changes until the relevant revision invalidates them.

[`public.source_transaction_count`](../services/db/supabase/migrations/20260928123132_transaction_counts.sql)
accepts required `p_dataset` and optional `p_date_from`, `p_date_to`, `p_skus`, `p_marketplaces`,
`p_types`, `p_search_skus`, `p_search_types`, and `p_search_marketplaces` (all null by default). It returns the same exact count string and shares
raw source visibility/search rules with `source_transaction_page`. No page, ordering, or financial
calculation is needed.

## Text search

The frontend trims the search text, debounces it by 250 ms, and performs literal substring matching
against its complete option catalogs with JavaScript `toLowerCase()`. It matches raw values and
formatted Type/Source labels. Characters such as `*`, `%`, `_`, brackets, quotes, and backslashes
remain literal. Currency is not a searchable field on any transaction tab.

| Dataset | Searchable fields |
| --- | --- |
| Transactions | SKU, Type, Source, Marketplace |
| Settlements / Data Kiosk | SKU, Type, Marketplace |

The frontend sends matching exact strings in `p_search_skus`, `p_search_types`, and
`p_search_marketplaces`, plus `p_search_sources` for Transactions. Search matches any supplied field
(OR). Ordinary column filters, dates, fee applicability, and RLS still intersect that result (AND).
A SKU match does not require a Type match. Source is not searchable on raw tabs.

All search arrays null or omitted means no search. Supplying any search array activates search;
empty arrays contribute no matches. Thus an active search with all empty arrays returns zero rows
and count zero, not an unrestricted read. Page and count requests use identical resolved arrays.
The API client rejects unresolved active searches and malformed arrays before sending a request.
The database validates array shape and members, then performs exact comparisons before paging or
the amount-sort cap.

Company SKUs come from loaded current assignments. Administrators preload the complete
SKU catalog before the workspace is shown, including historical, unassigned, unregistered, and
registered-only values. Source/fee revision changes reload that catalog before dependent search
queries refresh. Resolved sets are part of page/count cache keys. Catalogs are not authorization:
the backend enforces the same RLS even if a caller sends arbitrary values. Non-transaction account
and payout searches retain their existing REST query behavior.

## Period totals and Type breakdowns

[`public.transaction_totals`](../services/db/supabase/migrations/20260928123138_transaction_totals.sql)
accepts:

| Parameter                                   | Default | Meaning                                                    |
| ------------------------------------------- | ------- | ---------------------------------------------------------- |
| `p_date_from`, `p_date_to`                  | `null`  | At least one inclusive date bound is required.             |
| `p_company_ids`, `p_skus`, `p_marketplaces` | `null`  | Same current-owner and typed selection semantics as pages. |
| `p_currency`                                | `null`  | Optional three-letter uppercase currency code.             |
| `p_group_by_type`                           | `false` | Add raw component type to currency grouping.               |
| `p_limit`                                   | `1000`  | Integer group-page size, 1–1,000.                          |
| `p_offset`                                  | `0`     | Same safe-integer bound as page offsets.                   |

Response: `{ "rows": [...], "next_offset": 1000 }`; the continuation is null on the last page. Each
row contains `currency`, `component_type`, `reported_amount`, `service_fee`, `company_amount`,
`row_count`, and `known_company_count`. `component_type` is null for currency-only grouping. All
five numeric fields are strings or, for unknown monetary sums, null.

`row_count` includes every eligible source or derived reconciliation row. Retained SelBox rows
have a known zero company amount, so they do not signal missing ownership or fees. `known_company_count` counts rows with a known
company amount, allowing the UI to identify incomplete fee coverage. Monetary sums retain SQL sum
semantics: known amounts contribute; an entirely unknown sum is null. No matching facts produce an
empty `rows` array, not a fabricated zero-currency group.

Facts are filtered first and combined by seller/SKU, marketplace, date, currency, optional Type, and
fee applicability and whether the amount is retained by SelBox before resolving ownership and
fee periods. Exact sums remain equivalent to
individual row calculations. Groups sort by currency and raw Type using database `C` collation; one
extra group determines continuation without another exact source-row count.

The materialized current-terms projection includes only seller/SKU keys in those filtered fact
groups. It preserves invoker RLS and left joins, including missing-ownership and missing-rate
diagnostics; it does not materialize unrelated assignments for financial projection.

Only company, SKU, and marketplace selections scope every summary card. Date selection scopes the
Selected dates card; Latest day and Latest month use their independently chosen periods. Source,
Type, fee-applicability, and search selections do not change these summary contracts. Period
discovery and the Latest month rule belong to the frontend; this RPC calculates the supplied range.

## Filter options

Source, Marketplace, and Type menus use static application catalogs. All SKU menus use an already
loaded catalog: company members reuse their current `company_skus` assignments; administrators
preload [`public.sku_filter_options`](../services/db/supabase/migrations/20260928123140_sku_filter_options.sql)
during identity bootstrap. Opening a menu makes no database request. Options may return zero rows
under the selected dataset and other filters.

Administrators receive every known Type for the dataset's source scope. Administrator Transactions
also offers source `RECONCILIATION` and type `SETTLEMENT_KIOSK_DIFFERENCE`, computed separately
from the unchanged preprocessing registry. Company members receive
every known Type except category `SELBOX`. These are local registry choices, not occurrence-based
database discovery. After selection, page/count RPCs still query matching transaction rows for the
table and exact pagination; knowing valid Type names does not establish their transaction counts.

The SKU RPC takes no arguments and returns `{ "values": ["A", "B"] }`. SKUs are distinct,
non-null strings in `C` collation order. One scalar JSON response contains the complete list from
one database snapshot; REST row limits do not paginate the nested array. There is no cursor,
occurrence count, or client loop repeating discovery. An empty catalog returns an empty array.
The client validates the complete response before using it for filters or search.

The function checks `private.is_operator()` before executing discovery. Company members,
unregistered users, and callers without an application operator identity receive SQLSTATE `42501`
(`Administrator access required`; HTTP 403 for authenticated requests). Operators and members
share Supabase's `authenticated` database role, so its execution grant remains while the function
enforces the application-role restriction. Invoker RLS still applies to the permitted query.

Administrator identity refreshes may reuse the in-memory catalog after checking the current account
and all three source/fee revision tokens. Changed scope or revisions and an explicit workspace
retry reload it. A page reload or new sign-in starts a fresh catalog load; catalogs are not persisted
alongside session credentials. The response and browser memory still grow with distinct SKU count.

The catalog unions both fact tables and `seller_skus` under caller RLS. For administrators this
includes all source history and categories, zero-amount rows, unregistered imports, and registered
SKUs without transactions or company assignments. It is a superset for all three transaction tabs;
it intentionally has no dataset, current-version, or occurrence filter. SKU strings remain
exact, including case, punctuation, Unicode, and surrounding whitespace.

Administrator discovery seeks to the first nonnull source SKU and then repeatedly
seeks to the next greater value in the existing `(sku, date)` indexes. These seeks use the SKU
columns' native deterministic collation; the final combined catalog is deduplicated and ordered
with `C` collation. The recursive work stays inside one SQL statement and snapshot. Every lookup
retains caller RLS, and registered-only SKUs still come from the ordinary registry read.

## Index access paths

The source tables use the following optional read indexes in the
[canonical baseline](../services/db/supabase/migrations/20260928123054_schema_foundation.sql).
Here `date` means Settlement `posted_date` or Data Kiosk `activity_date`.

| Key shape                       | Settlement    | Data Kiosk    | Intended access                                              |
| ------------------------------- | ------------- | ------------- | ------------------------------------------------------------ |
| `(date, id)`                    | Full index    | Full index    | Both date directions, including raw historical/account rows. |
| `(sku, date)`                   | Compact index | Compact index | Exact SKU selections/date ranges and distinct-SKU index seeks. |
| `(component_type, date)`        | Compact index | Compact index | Type selections, fee-applicable Types, and date ranges.      |
| `(marketplace_name, date)`      | Compact index | Compact index | Marketplace filtering and bounded date candidates.           |
| Compact ownership/version keys | Partial index | —             | Settlement's inexpensive unfiltered and marketplace counts.  |
| Covering count keys             | Date-leading  | Date-leading  | Date-bounded count predicates and authorization without reading full facts when visibility permits. |

The full date/ID indexes have no category or nonzero-amount predicate. Filtering and existing RLS
still determine which rows qualify. Forward and backward scans serve the complete ascending and
descending date/ID order; Transactions also reverses its source tie-breaker. SKU and Type indexes
omit the row ID so repeated key/date pairs can use B-tree deduplication. Adding a unique ID tail
would prevent sharing those repeated keys and increase storage. Compact indexes can still require
sorting within a date or merging selected values; they are not a promise of a sort-free plan.
[B-tree deduplication](https://www.postgresql.org/docs/17/btree.html#BTREE-DEDUPLICATION)

Marketplace columns and arguments use native text, preserving the allowed names with write
constraints and input validation. PostgreSQL 17's built-in text equality is leakproof, allowing
marketplace conditions to reach fact scans under RLS. This permits
an index condition; it does not require the planner to choose a particular index for every scope.
No equality wrapper, catalog flag change, or RLS relaxation is involved.
[PostgreSQL 17 function catalog](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/catalog/pg_proc.dat),
[RLS and leakproof predicates](https://www.postgresql.org/docs/17/sql-createfunction.html)

Settlement retains its compact ownership/version index and has a partial count index on
`(posted_date, component_type, seller_namespace, sku, version_id, category, marketplace_name)`
where `category = 'SETTLEMENT'`. Its partial predicate does not cover the expanded
administrator scope for mature dates, which also admits `SELBOX` Settlement rows.
The planner can use the existing full Type/date and other indexes for the broader scope.
Trailing keys support filters and eligibility checks where that partial index applies.

Data Kiosk uses
`(activity_date, component_type, seller_namespace, sku, version_id, category, marketplace_name)`
where `amount <> 0`. The predicate matches UI reads while covering every category, including
administrator account rows. Amount is not stored in the key. Zero-inclusive source/reference
queries retain their semantics and use the remaining full indexes or table scans.

These indexes support bounded periods and unbounded reads. API dates remain optional, and the
frontend does not apply dates by default. Date predicates apply to source facts before counting, aggregation, or page fee
calculation. Leading with date narrows the index range; later columns can filter entries but do
not generally narrow that range further.
[PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html)

Both count indexes use ordinary key columns, retaining eligibility for B-tree deduplication;
there are no `INCLUDE` columns. They do not cover financial sums or full row projections.
Index-only reads also depend on the visibility map maintained by vacuum. Broader coverage does
not guarantee an index-only plan. See the
[bounded and unbounded measurements](evidence/date_bounded_indexes_2026-09-27/README.md).
[PostgreSQL index-only scans](https://www.postgresql.org/docs/17/indexes-index-only-scans.html)

Ownership/count indexes, current-pointer indexes, primary/unique constraints, and the fee-period
GiST exclusion support eligibility and data integrity. There is no amount-ordering index;
sorting uses the bounded 10,000-match result.

Plans remain dependent on role, filter selectivity, dates, and requested page depth. Exact counts
and sums still process their matching rows, and multi-value filters may choose a different plan from
singleton filters. Type indexes also narrow applicable-only counts; ordinary date pages can use
date/ID scans. The [performance guide](database_performance.md) records measurements and scaling
limits.

Outside the fact tables, primary/unique indexes cover natural identities and version inventories.
Current-pointer indexes support currentness. The fee-period GiST constraint provides date coverage
and prevents overlap. Data Kiosk payout references have a version-leading index for retention
checks. Payout listings use `(created_at DESC NULLS LAST, id ASC)`; their separate company key
supports company references. Batch lookups reuse `UNIQUE(batch_id, day_id)`.

## Shared rules and API configuration

[Financial read rules](../services/db/supabase/migrations/20260928123106_financial_rules.sql)
provide `private.settlement_fee_applicable`, `private.calculate_service_fee`, and the invoker view
`private.current_sku_terms`. The exact formula remains `-(fee_base * fee_rate_percent * 0.01)`;
callers retain the existing missing/non-applicable branches. Current terms include explicit
unassignment, while the explicit-version payout resolver retains its captured version scope.

[Transaction read rules](../services/db/supabase/migrations/20260928123130_transaction_read_rules.sql)
provide `private.validate_transaction_filters`, `private.validate_page_bounds`, and
`private.member_policy_covers_current_version`. Validation runs once before query execution;
source-specific fact selection and candidate limits remain in each optimized query. The frontend
normalizes search text and resolves exact catalog values. SQL receives those values as bound arrays,
not raw search text; caller values are never interpolated into SQL.

The current-pointer shortcut applies only to authenticated non-operators with active fact RLS that
already requires current versions. Operators, owners, and bypass contexts retain explicit pointer
checks. These helpers preserve the existing access rules and financial results.

[Application access](../services/db/supabase/migrations/20260928123123_application_access.sql)
separates transaction authorization from reference visibility. Fact policies match current source
pointers directly and still enforce each row's category and current seller/SKU ownership. Metadata
policies do not inspect facts: `private.is_company_member()` establishes registered member access,
headers require a nonnull current pointer, and version references must match a current pointer.
Members may read current references across companies, including empty or unowned versions; operators
retain historical reference access. Existing column grants continue to exclude full report metadata,
and its operator-only functions remain guarded. The private member helper has a fixed search path and
authenticated-only application execution.

Public RPCs use invoker security. The final
[application grants](../services/db/supabase/migrations/20260928123142_application_grants.sql)
module defines their API allowlist. Reference visibility does not grant transaction access. See the
[access contract](access_control.md#how-rls-enforces-this).

[REST configuration](../services/db/supabase/migrations/20260928123144_rest_api_configuration.sql)
sets `pgrst.db_aggregates_enabled=false`. General REST aggregate selections fail with `PGRST123`;
ordinary row reads, pagination counts, and these dedicated RPCs remain available.
