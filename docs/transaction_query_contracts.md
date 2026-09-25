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

Current transaction reads combine Settlement rows classified `SETTLEMENT` and nonzero Data Kiosk
rows from selected current versions. Settlement zero rows remain visible. Dashboard estimates sum
these eligible rows; strict financial and payout functions retain their separate completeness and
source-scope contracts. Reassignment and fee revisions affect live reads without changing source
facts or saved payouts.

Date bounds are inclusive, finite calendar dates. If both are supplied, the start cannot exceed the
end. Selection arrays are one-dimensional and cannot contain null members. Omitted, null, or empty
arrays mean no selection restriction. Marketplace arguments use `amazon_marketplace_name[]`; clients
send JSON string arrays and unknown enum labels are rejected.

Row amounts, quantities, rates, aggregate sums, and counts are exact decimal strings in RPC JSON.
Unknown financial amounts remain null. Explicit zero amounts and rates remain zero. Currency groups
are always separate; database calculations do not convert currencies.

## Transaction pages

[`public.transaction_page`](../services/db/supabase/migrations/20260925065535_transaction_page.sql)
accepts:

| Parameter                  | Default | Meaning                                                           |
| -------------------------- | ------- | ----------------------------------------------------------------- |
| `p_limit`                  | `25`    | Integer page size, 1–1,000.                                       |
| `p_offset`                 | `0`     | Nonnegative safe integer, at most 9,007,199,254,740,991.          |
| `p_search`                 | `null`  | Literal case-insensitive substring search; empty means no search. |
| `p_order_by`               | `date`  | Sort key: `date` or `amount` (stored reported amount).            |
| `p_direction`              | `desc`  | Ordering direction: `asc` or `desc`.                              |
| `p_date_from`, `p_date_to` | `null`  | Optional inclusive date bounds.                                   |
| `p_company_ids`            | `null`  | Current company UUID selection.                                   |
| `p_skus`                   | `null`  | Exact SKU text selection.                                         |
| `p_marketplaces`           | `null`  | Native marketplace enum selection.                                |
| `p_sources`                | `null`  | Source text selection.                                            |
| `p_types`                  | `null`  | Raw component-type selection.                                     |
| `p_include_count`          | `true`  | Whether to include an exact matching-row count.                   |
| `p_fee_applicable`         | `null`  | `true`: applicable source Type; `false`: other Types; null: both. |

Response: `{ "rows": [...], "total_count": "123" }`. With counting disabled, `total_count` is null.
An empty page still receives the full matching count when requested. Rows retain source identity,
metadata, current terms and fee references, quantities, amounts, and resolution diagnostics.

Filters, text search, and RLS apply before candidate selection. For date ordering the database takes
at most `offset + limit` eligible candidates per source, merges them, selects the page, and only
then resolves metadata and fees. Date ordering reverses the full
`(activity_date, source, source_row_id)` tuple: all ascending for oldest-first, all descending for
newest-first. Dates use `NULLS LAST` for ascending and `NULLS FIRST` for descending, matching
forward/backward scans of one ascending date/ID index per source; source dates are non-null. Amount
ordering keeps ascending source/ID ties and `NULLS LAST` in both directions. A combined page/count
response uses one statement and snapshot.

Date and Reported amount ordering, with or without text search, use this RPC. Reported amount is the
stored numeric source amount, ordered with its sign; values are not converted between currencies.
The frontend no longer offers Company amount ordering for Transactions. Text predicates apply before
each source candidate limit; fee calculation still follows global page selection.

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

The fee-applicability filter uses raw source Type codes before paging/counting: Settlement
`PRODUCT_SALES` and `PRODUCT_REFUNDS`, and Data Kiosk `NET_PRODUCT_SALES`. The negative filter
selects the other Types within each source. Explicit Type selections intersect this filter; they
do not replace it. These direct comparisons expose the existing `(component_type, date)` indexes.

Applicability is independent of configuration: a zero base, zero rate, missing ownership, or missing
configured rate does not change a transaction's Type. Current preprocessing maps these Types to the
existing fee-base rules. Calculations still use Settlement Order/Refund + ItemPrice + Principal and
Data Kiosk's stored fee base. The filter treats Type as authoritative if trusted direct SQL supplies
inconsistent fields; it does not rewrite a base or fabricate a configured rate.

## Raw source pages

[`public.source_transaction_page`](../services/db/supabase/migrations/20260925095337_source_transaction_page.sql)
serves the Settlements and Data Kiosk tabs. Its required `p_dataset` is `settlement` or
`data_kiosk`. Optional parameters are `p_limit` (25), `p_offset` (0), `p_order_by` (`date`),
`p_direction` (`desc`), `p_date_from`, `p_date_to`, `p_skus`, `p_marketplaces`, `p_types`,
`p_search` (all null), and `p_include_count` (true). Sort keys, direction, bounds, date and array
validation follow the transaction page contract.

Response: `{ "rows": [...], "total_count": "123" }`, with a null count when disabled. Rows contain
the corresponding source-view fields selected by the frontend, including exact numeric strings.
Settlement orders by `posted_date` or `amount`; Data Kiosk uses `activity_date` or `amount`. Date
ordering reverses both date and row ID together, with the same null placement as Transactions.
Amount ordering keeps ascending row-ID ties and nulls last. Data Kiosk zero amounts are excluded
before pagination and counting; Settlement zero amounts remain.

This endpoint preserves the raw source views' visibility, including historical versions and every
source category available to the caller. It does not impose Transactions' current-version or
Settlement-category restriction. Existing fact and metadata RLS still apply; choosing a dataset
cannot expand access. The UI exposes these tabs to administrators.

The same 10,000-match amount-ordering limit applies to each raw source tab, after its filters,
search, and RLS. Overflow is checked before sorting or metadata projection; exactly 10,000 matches
are allowed. Date ordering and source counts remain uncapped.

All source pages use this RPC, including text search. The frontend loads their exact counts
separately through `source_transaction_count`, using identical date, SKU, marketplace, Type, and
search arguments.

## Exact transaction counts

[`public.transaction_count`](../services/db/supabase/migrations/20260925065533_transaction_count.sql)
accepts the same date, company, SKU, marketplace, source, Type, and fee-applicability filters as the
page RPC, including `p_search`. It returns one exact count string, such as `"123"`, including `"0"`
for no matching rows. There are no paging or ordering parameters.

The function counts eligible source facts without calculating financial amounts or resolving fees.
Search is an ordinary predicate over the same visible text fields used by the page request. The
frontend can show rows before this separate request finishes, and reuses counts across page/order
changes until the relevant revision invalidates them.

[`public.source_transaction_count`](../services/db/supabase/migrations/20260925102039_source_transaction_count.sql)
accepts required `p_dataset` and optional `p_date_from`, `p_date_to`, `p_skus`, `p_marketplaces`,
`p_types`, and `p_search` (all null by default). It returns the same exact count string and shares
raw source visibility/search rules with `source_transaction_page`. No page, ordering, or financial
calculation is needed.

## Text search

Search is a case-insensitive literal substring within the supported visible fields. The frontend
trims input and debounces it by 250 ms; the database applies the same whitespace normalization.
Null, empty, and whitespace-only input disables search. Characters such as `*`, `%`, `_`, brackets,
quotes, and backslashes stay literal. A nonempty term with no matches returns zero rows and count
zero; it never becomes an empty selection array that means no filter.

| Dataset                  | Searchable fields                        |
| ------------------------ | ---------------------------------------- |
| Transactions             | SKU, Type, Source, Marketplace, Currency |
| Settlements / Data Kiosk | SKU, Type, Marketplace, Currency         |

Type searches match the stored type code/keywords. Source accepts both its canonical code and the
fixed displayed names, `Settlements` and `Data Kiosk`. Marketplace enum values are cast to text only
for substring search; selected marketplace filters continue comparing the native enum type. Fee
status, processing version, seller identifiers, and other hidden metadata are not searchable. The
Source field is omitted for raw tabs, where every row comes from the same source.

One shared inlinable predicate keeps page/count matching identical. The database applies it directly
with the existing filters before date pagination or the amount-sort cap. It does not fetch filter
option lists, join fee metadata, interpret fuzzy queries, or calculate fees to determine a search
match. The frontend sends plain `p_search`; it never constructs SQL or financial REST-view
predicates.

## Period totals and Type breakdowns

[`public.transaction_totals`](../services/db/supabase/migrations/20260925065538_transaction_totals.sql)
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

`row_count` includes every eligible source row. `known_company_count` counts rows with a known
company amount, allowing the UI to identify incomplete fee coverage. Monetary sums retain SQL sum
semantics: known amounts contribute; an entirely unknown sum is null. No matching facts produce an
empty `rows` array, not a fabricated zero-currency group.

Facts are filtered first and combined by seller/SKU, marketplace, date, currency, optional Type, and
fee applicability before resolving ownership and fee periods. Exact sums remain equivalent to
individual row calculations. Groups sort by currency and raw Type using database `C` collation; one
extra group determines continuation without another exact source-row count.

Only company, SKU, and marketplace selections scope every summary card. Date selection scopes the
Selected dates card; Latest day and Latest month use their independently chosen periods. Source,
Type, fee-applicability, and search selections do not change these summary contracts. Period
discovery and the Latest month rule belong to the frontend; this RPC calculates the supplied range.

## Filter options

[`public.dataset_filter_options`](../services/db/supabase/migrations/20260925065540_dataset_filter_options.sql)
requires `p_dataset` and `p_field`. It accepts `p_limit` (default 1,000, range 1–1,000) and
`p_after` (default null, otherwise nonempty text).

| Dataset      | Allowed fields                                        |
| ------------ | ----------------------------------------------------- |
| `live`       | `sku`, `marketplace_name`, `source`, `component_type` |
| `settlement` | `sku`, `marketplace_name`, `component_type`           |
| `data_kiosk` | `sku`, `marketplace_name`, `component_type`           |
| `fees`       | `marketplace_name`                                    |

Response: `{ "values": ["A", "B"], "next_cursor": "B" }`. Values are unique, non-null strings in `C`
collation order. The next cursor is the last returned value only when another value exists;
otherwise it is null. Clients pass that exact value as `p_after` for the next page. One lookahead
value detects continuation; occurrence counts are not calculated.

Live options read eligible current facts without fee joins. Raw source options and fee options
retain the matching existing view/RLS visibility. Zero Data Kiosk rows remain excluded. The RPC
rejects unsupported dataset/field combinations rather than accepting arbitrary SQL identifiers.

## Index access paths

The source tables use the following optional read indexes in the
[canonical baseline](../services/db/supabase/migrations/20260912072531_live_source_versions.sql).
Here `date` means Settlement `posted_date` or Data Kiosk `activity_date`.

| Key shape                       | Settlement    | Data Kiosk    | Intended access                                              |
| ------------------------------- | ------------- | ------------- | ------------------------------------------------------------ |
| `(date, id)`                    | Full index    | Full index    | Both date directions, including raw historical/account rows. |
| `(sku, date)`                   | Compact index | Compact index | Exact single/multiple SKU selections and date ranges.        |
| `(component_type, date)`        | Compact index | Compact index | Type selections, fee-applicable Types, and date ranges.      |
| `(marketplace_name, date)`      | Not retained  | Compact index | Privileged backend Data Kiosk financial reads.               |
| Existing ownership/version keys | Unchanged     | Unchanged     | Current ownership and source-version eligibility.            |

The full date/ID indexes have no category or nonzero-amount predicate. Filtering and existing RLS
still determine which rows qualify. Forward and backward scans serve the complete ascending and
descending date/ID order; Transactions also reverses its source tie-breaker. SKU and Type indexes
omit the row ID so repeated key/date pairs can use B-tree deduplication. Adding a unique ID tail
would prevent sharing those repeated keys and increase storage. Compact indexes can still require
sorting within a date or merging selected values; they are not a promise of a sort-free plan.
[B-tree deduplication](https://www.postgresql.org/docs/17/btree.html#BTREE-DEDUPLICATION)

Native enum parameters remove the earlier cast mismatch, but do not guarantee that a marketplace
filter becomes an index condition under RLS. PostgreSQL 17's `enum_eq` is not marked leakproof;
security-policy ordering can therefore prevent the comparison from reaching the fact scan as an
index restriction. The retained Data Kiosk marketplace/date index serves privileged backend
financial reads. Its usefulness there does not imply the same plan for authenticated UI requests.
[PostgreSQL 17 enum catalog](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/catalog/pg_proc.dat),
[RLS and leakproof predicates](https://www.postgresql.org/docs/17/sql-createfunction.html)

The former `(seller_namespace, sku, date)` indexes and Settlement marketplace/date index are
removed. The ownership/version indexes, current-pointer indexes, primary/unique constraints,
and fee-period GiST exclusion remain. No amount-ordering index is
retained. This index selection changes access paths only: function contracts, tables, authorization,
financial results, and the 10,000-match amount-sort limit stay the same.

Plans remain dependent on role, filter selectivity, dates, and requested page depth. Exact counts
and sums still process their matching rows, and multi-value filters may choose a different plan from
singleton filters. Historical evidence describes the index definitions at its recorded checkpoint;
the module map identifies the current definitions. The
[balanced-index experiment](evidence/balanced_read_indexes_2026-09-25/README.md) records the
selected workload, repeated comparisons, footprint and write-cost tradeoffs.

The [fee-applicability benchmark](evidence/fee_type_filter_2026-09-26/README.md) confirms these Type
indexes also narrow applicable-only counts; ordinary date pages continue using date/ID scans.

The [other-table audit](evidence/other_table_indexes_2026-09-25/README.md) covers source metadata,
accounts, terms/fees, revision tokens, and frozen payouts. It removes redundant or unused secondary
indexes and adds the payout list's creation-order index without changing these transaction paths.

## Shared rules and API configuration

[Financial read rules](../services/db/supabase/migrations/20260912072704_live_company_reads.sql)
provide `private.settlement_fee_applicable`, `private.calculate_service_fee`, and the invoker view
`private.current_sku_terms`. The exact formula remains `-(fee_base * fee_rate_percent * 0.01)`;
callers retain the existing missing/non-applicable branches. Current terms include explicit
unassignment, while the explicit-version payout resolver retains its captured version scope.

[Transaction read rules](../services/db/supabase/migrations/20260925065531_transaction_read_rules.sql)
provide `private.validate_transaction_filters`, `private.validate_page_bounds`, and
`private.member_policy_covers_current_version`. Validation runs once before query execution;
source-specific fact selection and candidate limits remain in each optimized query. The same module
provides literal search normalization and one inlinable visible-field predicate. Caller search
strings are bound parameters and are never interpolated into SQL.

The current-pointer shortcut applies only to authenticated non-operators with active fact RLS that
already requires current versions. Operators, owners, and bypass contexts retain explicit pointer
checks. These helpers preserve the existing access rules and financial results.

[REST configuration](../services/db/supabase/migrations/20260925065542_rest_api_configuration.sql)
sets `pgrst.db_aggregates_enabled=false`. General REST aggregate selections fail with `PGRST123`;
ordinary row reads, pagination counts, and these dedicated RPCs remain available.
