# Transaction query contracts

The browser uses authenticated Supabase REST/RPC requests. The database owns filtering,
authorization, pagination, exact source aggregation, and authoritative payout calculation. The
frontend owns diagnostic comparisons and differences. Current definitions are listed in the
[database module map](../services/db/supabase/README.md#schema-modules); each RPC has one signature.

## Shared behavior

The transaction RPCs are stable, security-invoker functions with an empty search path and custom
query plans. Execution is granted to `authenticated`, with grants revoked from `PUBLIC`, `anon`, and
`service_role`. Existing table RLS determines actual access: authentication alone does not grant
company data. Company ownership and account access come from database state. An explicit company
filter can narrow the caller's visible data but cannot expand it.

The SKU discovery RPC additionally requires a current stored Administrator account. Members use
their assigned SKUs and cannot call that administrator endpoint.

The main transaction list uses eligible Finances activity in the `FINANCES` and `SELBOX` categories
and Data Kiosk components in the `DATA_KIOSK` category at every date. Current totals and their
contributing-record drawers use the same filtered row set. There is no age-based source switch or
substitute sales source when Finances is absent. Transaction rows represent normalized source
components; diagnostic comparisons and analysis rows never enter pages, counts or totals. Members
see only their assigned company amounts. Actual SelBox rows have zero company contribution and
remain administrator-only; company and SKU filters also omit them. Strict reads validate required
coverage, selected preprocessing labels, ownership and fees for the requested dates. The
two-calendar-month cutoff governs monthly payout eligibility and the default Finance refresh
lookback; it does not hide older imported rows. Source changes and reassignment affect current reads
without changing saved reports.

Date bounds are inclusive, finite calendar dates in the RPC's declared date basis. If both are
supplied, the start cannot exceed the end. Selection arrays are one-dimensional and cannot contain
null members. Omitted, null, or empty arrays mean no ordinary selection restriction. Search arrays
have separate NULL/empty semantics described below. Marketplace arguments use `text[]`; clients send
JSON string arrays. The database validates array structure; unrecognized names simply match no
stored rows. The frontend owns the supported filter catalog, while stored marketplace names have
`CHECK` constraints preserving the vocabulary validated by preprocessing. Optional scalar nulls
retain their existing meaning.

Row amounts, quantities, rates, aggregate sums, and counts are exact decimal strings in RPC JSON.
Unknown financial amounts remain null. Explicit zero amounts and rates remain zero. Currency groups
are always separate; database calculations do not convert currencies. Zero amounts remain eligible
under the same source, category, ownership, and date rules as other amounts. They count as records
and retain applicable fee requirements; zero alone never makes a row supporting detail.

## Transaction pages

[`public.transaction_page`](../services/db/supabase/migrations/20260928123134_transaction_page.sql)
accepts:

| Parameter                                                                      | Default | Meaning                                                                                                           |
| ------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `p_limit`                                                                      | `25`    | Integer page size, 1–1,000.                                                                                       |
| `p_offset`                                                                     | `0`     | Nonnegative safe integer, at most 9,007,199,254,740,991.                                                          |
| `p_search_skus`, `p_search_types`, `p_search_marketplaces`, `p_search_sources` | `null`  | Exact frontend-resolved search sets, combined with OR. All null disables search; empty active sets match nothing. |
| `p_order_by`                                                                   | `date`  | Sort key: `date` or `amount` (reported amount).                                                                   |
| `p_direction`                                                                  | `desc`  | Ordering direction: `asc` or `desc`.                                                                              |
| `p_date_from`, `p_date_to`                                                     | `null`  | Optional inclusive date bounds.                                                                                   |
| `p_company_ids`                                                                | `null`  | Current company UUID selection.                                                                                   |
| `p_skus`                                                                       | `null`  | Exact SKU text selection.                                                                                         |
| `p_marketplaces`                                                               | `null`  | Exact supported marketplace text selection.                                                                       |
| `p_sources`                                                                    | `null`  | Source text selection.                                                                                            |
| `p_types`                                                                      | `null`  | Native component-type selection.                                                                                  |
| `p_include_count`                                                              | `true`  | Whether to include an exact matching-row count.                                                                   |
| `p_fee_applicable`                                                             | `null`  | `true`: applicable source Type; `false`: other Types; null: both.                                                 |
| `p_currency`                                                                   | `null`  | Optional three-letter uppercase currency code, applied before pagination and counting.                            |

Response: `{ "rows": [...], "total_count": "123" }`. With counting disabled, `total_count` is null.
An empty page still receives the full matching count when requested. Rows retain source identity,
metadata, current terms and fee references, quantities, amounts, and resolution diagnostics.
`activity_date` remains the original marketplace-local accounting date. `activity_at` is a UTC ISO
timestamp: Finances uses its exact `posted_at`; Data Kiosk is booked at the last microsecond before
the next marketplace-local midnight. This Data Kiosk instant is an explicit reporting convention,
not an Amazon event timestamp. Preprocessing calculates and versions this instant using named IANA
zones to account for daylight-saving changes; the database reads the stored value. Source dates
continue to select fee periods and payout months.

UTC bounds include the start day's UTC midnight and exclude midnight after the end day. Every
Transactions total, record drawer, and main-list date filter uses this interval and the same
reporting timestamp. There is no alternative date basis.

Filters, text search, and RLS apply before candidate selection. For date ordering the database takes
at most `offset + limit` eligible candidates per source, merges them, selects the page, and only
then resolves metadata and fees. Date ordering reverses the full
`(activity_at, source, source_row_id)` tuple: all ascending for oldest-first, all descending for
newest-first. Dates use `NULLS LAST` for ascending and `NULLS FIRST` for descending, matching
forward/backward scans of ascending instant/ID indexes; reporting instants are non-null. Amount
ordering keeps ascending source/ID ties and `NULLS LAST` in both directions. A combined page/count
response uses one statement and snapshot.

The materialized terms projection includes only SKU keys present on that selected page. It reads the
existing invoker-security current-terms view and retains left joins, including unassigned or
unregistered administrator-visible facts. Member RLS independently checks membership in the caller's
current ownership set before candidate selection; page limits cannot bypass it.

Date and Reported amount ordering, with or without text search, use this RPC. Reported amount is the
numeric source amount, ordered with its sign; values are not converted between currencies. Exact
search-set predicates apply before each source candidate limit; fee calculation still follows global
page selection.

A single marketplace uses scalar text equality so its index prefix is fixed for date ordering.
Multiple selected marketplaces use distinct, date-ordered candidate reads per marketplace, each
bounded by `offset + limit`, before the normal source/global merge. All filters and RLS apply inside
those reads. A 4,096-candidate budget per source keeps this strategy bounded: if the selected array
length times `offset + limit` would exceed it, the query retains the direct array-filter path. The
budget only chooses an execution strategy; it does not restrict dates, results, or valid offsets.
Raw-source pages preserve an unbounded matching relation for exact counts. Reported amount ordering
retains its separate 10,000-match contract.

Amount ordering is available only when the full filtered result contains **at most 10,000 rows**.
The function gathers at most 10,001 matching candidates without ordering, checks that count, and
rejects an excess before sorting or calculating fees. With 10,000 or fewer matches, it sorts the
complete matching set, selects the page, and resolves its fees. Pagination offsets cannot bypass the
limit. When requested, the amount page's exact count reuses the bounded candidate count. Date
ordering and the separate count RPC remain uncapped. No amount-ordering indexes are needed.

Overflow raises SQLSTATE `22023` (HTTP 400), with JSON `DETAIL`
`{"code":"AMOUNT_ORDER_LIMIT","limit":10000}`. The frontend recognizes that structured code, owns
the user-facing explanation, and offers Date ordering. A known exact count above the limit disables
amount choices; the server remains responsible for enforcing the cap when the count is unknown or
stale.

Preprocessing determines fee applicability and stores its exact signed `fee_base`. Transaction
pages, counts, and totals use `fee_base IS NOT NULL`; they do not reclassify source Type names. The
negative filter includes non-applicable account rows. Explicit Type selections intersect this
filter. A zero base is applicable, while a null base is not. Missing ownership or a missing
configured rate affects resolution, not applicability. Finances preprocessing derives the base from
reviewed native product principal paths before publication.

## Raw source pages

Raw source pages, exact counts and preprocessing-entry projections are administrator-only.
Authenticated members cannot call the source page/count RPCs and receive no rows from the public
source-entry views. Main Transactions and its company-scoped details remain available.

[`public.source_transaction_page`](../services/db/supabase/migrations/20260928123136_source_transaction_page.sql)
serves the Finances and Data Kiosk tabs. Its required `p_dataset` is `finances` or `data_kiosk`.
Optional parameters are `p_limit` (25), `p_offset` (0), `p_order_by` (`date`), `p_direction`
(`desc`), `p_date_from`, `p_date_to`, `p_skus`, `p_marketplaces`, `p_types`, `p_search_skus`,
`p_search_types`, `p_search_marketplaces` (all null), and `p_include_count` (true). Sort keys,
direction, bounds, date and array validation follow the transaction page contract.

Response: `{ "rows": [...], "total_count": "123" }`, with a null count when disabled. Rows contain
the normalized source-view fields, including exact numeric strings. The frontend selects its
supported display fields from that response. Both source pages add `activity_at`, using the same UTC
instant as Transactions: Finances uses `posted_at`, and Data Kiosk uses its assumed
marketplace-local day end. Date filters select UTC calendar days and date ordering uses that
instant; original local dates remain in the source fields. Date ordering reverses both timestamp and
row ID together, with the same null placement as Transactions. Amount ordering keeps ascending
row-ID ties and nulls last. Pagination and counting include retained zero-amount components; Data
Kiosk's all-zero calculation inputs are filtered during preprocessing.

Finances rows expose native transaction IDs, account type, lifecycle status, original/release
references, source page and record ordinals, component number, breakdown path and activity
eligibility. Numeric fields and the boolean/path projections are text in the RPC JSON so the browser
retains its exact row-value contract. Raw administrator pages include excluded release/transfer
components and retained historical versions for audit. Their amounts must not be summed as an
activity ledger. Both source entry views contain one row per immutable component, so repeated
unchanged captures do not duplicate source entries. Main Transactions reads only current
activity-eligible facts.

Source pages and `financial_source_record` preserve the exact normalized row/version. Displayed
batch and preprocessing metadata comes from its current observation when that version is selected,
or its latest associated preprocessing batch otherwise. It is not an originating batch and is not
claimed to be a payout input. Frozen payout manifests independently retain the exact normalized
versions. Data Kiosk source detail is recoverable through an associated acquisition's compressed
archives using the day, SKU and component key.

Administrators can inspect historical versions and every retained source category. The endpoint does
not impose Transactions' current-version or category restrictions. Stored account checks enforce
administrator access independently of tab visibility, and existing fact/metadata RLS remains active.

The same 10,000-match amount-ordering limit applies to each raw source tab, after its filters,
search, and RLS. Overflow is checked before sorting or metadata projection; exactly 10,000 matches
are allowed. Date ordering and source counts remain uncapped.

All source pages use this RPC, including text search. The frontend loads their exact counts
separately through `source_transaction_count`, using identical date, SKU, marketplace, Type, and
search arguments.

## Exact transaction counts

[`public.transaction_count`](../services/db/supabase/migrations/20260928123132_transaction_counts.sql)
accepts the same date, company, SKU, marketplace, source, Type, fee-applicability, currency, and
search filters as the page RPC, including all four `p_search_*` arrays. It returns one exact count
string, such as `"123"`, including `"0"` for no matching rows. There are no paging or ordering
parameters.

The function counts eligible source facts without resolving company fees. Search uses the same exact
OR-set predicates as the page request. The frontend can show rows before this separate request
finishes, and reuses counts across page/order changes until the relevant revision invalidates them.

[`public.source_transaction_count`](../services/db/supabase/migrations/20260928123132_transaction_counts.sql)
accepts required `p_dataset` and optional `p_date_from`, `p_date_to`, `p_skus`, `p_marketplaces`,
`p_types`, `p_search_skus`, `p_search_types`, and `p_search_marketplaces` (all null by default). It
returns the same exact count string and shares raw source visibility/search rules with
`source_transaction_page`. No page, ordering, or financial calculation is needed.

## Text search

The frontend trims the search text, debounces it by 250 ms, and performs literal substring matching
against its complete option catalogs with JavaScript `toLowerCase()`. It matches raw values and
formatted Type/Source labels. Characters such as `*`, `%`, `_`, brackets, quotes, and backslashes
remain literal. Currency is not a searchable field on any transaction tab.

| Dataset               | Searchable fields              |
| --------------------- | ------------------------------ |
| Transactions          | SKU, Type, Source, Marketplace |
| Finances / Data Kiosk | SKU, Type, Marketplace         |

The frontend sends matching exact strings in `p_search_skus`, `p_search_types`, and
`p_search_marketplaces`, plus `p_search_sources` for Transactions. Search matches any supplied field
(OR). Ordinary column filters, dates, fee applicability, and RLS still intersect that result (AND).
A SKU match does not require a Type match. Source is not searchable on raw tabs.

All search arrays null or omitted means no search. Supplying any search array activates search;
empty arrays contribute no matches. Thus an active search with all empty arrays returns zero rows
and count zero, not an unrestricted read. Page and count requests use identical resolved arrays. The
API client rejects unresolved active searches and malformed arrays before sending a request. The
database validates array shape and nonnull members, then performs exact comparisons before paging or
the amount-sort cap.

Company SKUs come from loaded current assignments. Administrators preload the complete SKU catalog
before the workspace is shown, including historical, unassigned, unregistered, and registered-only
values. Source/fee revision changes reload that catalog before dependent search queries refresh.
Resolved sets are part of page/count cache keys. Catalogs are not authorization: the backend
enforces the same RLS even if a caller sends arbitrary values. Account searches use literal REST
text filters. Payout search loads complete authorized report date references and matches the
month/year formatted from `start_date` and the ISO month in the frontend. It sends the exact
matching dates alongside literal marketplace/currency alternatives for database filtering and
paging. Account and payout-revision checks bracket date-reference loading, rejecting a mixed
snapshot if scheduled report publication changes it mid-read. Display labels and generated report
names are not database fields.

## Period totals and Type breakdowns

[`public.transaction_totals`](../services/db/supabase/migrations/20260928123138_transaction_totals.sql)
accepts:

| Parameter                                                                      | Default | Meaning                                                              |
| ------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------- |
| `p_date_from`, `p_date_to`                                                     | `null`  | At least one inclusive date bound is required.                       |
| `p_company_ids`, `p_skus`, `p_marketplaces`                                    | `null`  | Same current-owner and typed selection semantics as pages.           |
| `p_sources`, `p_types`                                                         | `null`  | Same exact source and component-type selections as pages.            |
| `p_fee_applicable`                                                             | `null`  | Same fee-base applicability selection as pages.                      |
| `p_search_skus`, `p_search_types`, `p_search_marketplaces`, `p_search_sources` | `null`  | Same exact OR search sets as pages; active empty sets match nothing. |
| `p_currency`                                                                   | `null`  | Optional three-letter uppercase currency code.                       |
| `p_group_by_type`                                                              | `false` | Use currency/Type groups instead of marketplace/currency groups.     |
| `p_limit`                                                                      | `1000`  | Integer group-page size, 1–1,000.                                    |
| `p_offset`                                                                     | `0`     | Same safe-integer bound as page offsets.                             |

Response: `{ "rows": [...], "next_offset": 1000 }`; the continuation is null on the last page. Each
row contains `marketplace_name`, `currency`, `component_type`, `reported_amount`, `service_fee`,
`company_amount`, `row_count`, and `known_company_count`. Period totals group by marketplace and
currency, with null `component_type`. Type breakdowns group by currency and raw component type
within the requested marketplace scope, with null `marketplace_name`. All five numeric fields are
strings or, for unknown monetary sums, null.

Totals include the same authorized current rows as Transactions: eligible `FINANCES` and `SELBOX`
components from Finances and `DATA_KIOSK` costs from Data Kiosk. `SELBOX` contributes reported
amounts and row counts while retaining zero service fees and company amounts. Company and SKU
selections exclude it, matching the list. `row_count` counts the filtered transaction rows.
`known_company_count` counts rows with a known company amount, allowing the UI to identify
incomplete fee coverage. Monetary sums retain SQL sum semantics: known amounts contribute; an
entirely unknown sum is null. No matching facts produce an empty `rows` array, not a fabricated
zero-currency group.

Facts are filtered first and combined by SKU, marketplace, category, date, currency, optional Type,
and fee applicability before resolving ownership and fee periods. Exact sums remain equivalent to
individual row calculations. Groups sort by marketplace, currency, and raw Type using database `C`
collation, with null grouping fields first; one extra group determines continuation without another
exact source-row count.

The materialized current-terms projection includes only SKU keys in those filtered fact groups. It
preserves invoker RLS and left joins, including missing-ownership and missing-rate diagnostics; it
does not materialize unrelated assignments for financial projection.

All selected non-date filters, including source, Type, fee applicability, and search, scope every
current total and its Type breakdown. Selected dates also applies the selected UTC date range. Last
day and Last month replace only the date selection with their shared UTC calendar period. Period
discovery reads `public.transaction_page` with `p_limit = 1`, descending date ordering,
`p_include_count = false`, and no company, SKU, marketplace, date, source, type, fee, or search
filters. The latest row visible under the authenticated account's RLS has an `activity_at` that
determines the UTC anchor date; its source-local `activity_date` does not. Last day uses the
preceding UTC calendar day, even when that day has no transactions. An empty page means no latest
period. This reuses the page RPC's current-source eligibility, ownership, and RLS rules. Last month
always uses the calendar month preceding the latest UTC transaction's month, including when the
anchor date is month-end. Neither rule certifies complete source coverage. The totals RPC calculates
the supplied UTC range once for all selected marketplaces. A marketplace without transactions in
that common range is empty; it does not fall back to an older local period. The browser displays all
marketplace/currency totals together, and opening a Type breakdown retains the selected group's
exact marketplace and currency along with all other filters. Record drilldowns retain that scope and
intersect it with the selected exact type or broad group, so rows, counts, and amounts agree. Broad
groups derive their exact types from the
[shared taxonomy](transaction_type_registry.md#shared-type-hierarchy); the totals RPC returns raw
component types and does not maintain a separate display classification.

For fully calculated company activity, exact `reported_amount + service_fee = company_amount`.
SelBox reported activity is kept outside company allocations. Incomplete ownership or fee
configuration retains the reported amounts but leaves the affected company amounts unknown; the UI
identifies the known subtotal. Independently rounded display values can differ by a cent.

Transactions uses UTC calendar periods, while saved payouts preserve source-local accounting months.
The amounts of a UTC month can therefore differ at its boundaries from the same named payout month.
Current source allocations for a complete marketplace-local month match its refreshed report when
source and terms versions are identical. A narrowed SKU selection represents only part of the
report; an unfiltered administrator total spans all companies and may include unresolved
company-financial rows. The browser presents amount types and contributing records for both current
totals and saved reports.

## Saved payout totals

`public.payout_report_totals` uses the same `{ "rows": [...], "next_offset": ... }` response and
exact numeric strings as `transaction_totals`. It accepts required `p_report_id` plus
`p_group_by_type` (default `false`), `p_limit` (default `1000`), and `p_offset` (default `0`). Group
paging uses the same bounds and the currency/Type ordering of live Type breakdowns. It is stable,
uses invoker security and an empty search path, and is executable only by authenticated application
users with access to the saved report under RLS.

Ungrouped monetary totals use the frozen header. Counts and Type groups are calculated from its
saved source and terms versions, including authoritative zero-amount rows as live totals do.
Supporting comparisons and seller reconciliation never enter these totals. Missing or inaccessible
reports raise `42501` with the generic report-access error. A report without contributing records
returns no Type groups; its saved header still records the exact totals.

`public.payout_report_records(p_report_id, p_authoritative, p_limit, p_offset, p_types)` returns
`{ "rows": [...], "total_count": "..." }` with exact numeric strings. It uses the same saved inputs
and formula as the Type totals. The default is authoritative records, 50 rows at offset zero, with
no Type filter. Record identity is `(report_id, source, source_row_id)`. Pages order by date, source
and source-row ID descending. Members can read only their own company's authoritative records;
administrators may select supporting records. Pagination and Type filtering do not change the frozen
header totals. An accessible report with no matching records returns an empty page and
`total_count: "0"`. Inaccessible reports and member requests for supporting records raise `42501`.

## Filter options

Source, Marketplace, and Type menus use static application catalogs. All SKU menus use an already
loaded catalog: members reuse their current `company_skus` assignments; administrators preload
[`public.sku_filter_options`](../services/db/supabase/migrations/20260928123140_sku_configuration_reads.sql)
during identity bootstrap. Opening a menu makes no database request. Options may return zero rows
under the selected dataset and other filters.

Transactions offers Finances Types in category `FINANCES`, plus `SELBOX` for administrators, and
Data Kiosk Types in category `DATA_KIOSK`. Raw administrator tabs and Financial review keep the full
source Type catalogs. Members have no raw-source Type catalog. Literal search uses the same
dataset/role-filtered Type catalog. These are local registry choices, not occurrence-based database
discovery. After selection, page/count RPCs still query matching transaction rows for the table and
exact pagination; knowing valid Type names does not establish their transaction counts.

The SKU RPC takes no arguments and returns `{ "values": ["A", "B"] }`. SKUs are distinct, non-null
strings in `C` collation order. One scalar JSON response contains the complete list from one
database snapshot; REST row limits do not paginate the nested array. There is no cursor, occurrence
count, or client loop repeating discovery. An empty catalog returns an empty array. The client
validates the complete response before using it for filters or search.

The function checks `private.is_administrator()` before executing discovery. Members, unregistered
users, and callers without an application administrator identity receive SQLSTATE `42501`
(`Administrator access required`; HTTP 403 for authenticated requests). Administrators and members
share Supabase's `authenticated` database role, so its execution grant remains while the function
enforces the application-role restriction. Invoker RLS still applies to the permitted query.

Administrator identity refreshes may reuse the in-memory catalog after checking the current account
and all three source/fee revision tokens. Changed scope or revisions and an explicit workspace retry
reload it. A page reload or new sign-in starts a fresh catalog load; catalogs are not persisted
alongside session credentials. The response and browser memory still grow with distinct SKU count.

The catalog unions both fact tables and `skus` under caller RLS. For administrators this includes
all source history and categories, zero-amount rows, unregistered imports, and registered SKUs
without transactions or company assignments. It is a superset for all three transaction tabs; it
intentionally has no dataset, current-version, or occurrence filter. SKU strings remain exact,
including case, punctuation, Unicode, and surrounding whitespace.

Administrator discovery seeks to the first nonnull source SKU and then repeatedly seeks to the next
greater value in the existing SKU indexes. These seeks use the SKU columns' native deterministic
collation; the final combined catalog is deduplicated and ordered with `C` collation. The recursive
work stays inside one SQL statement and snapshot. Every lookup retains caller RLS, and
registered-only SKUs still come from the ordinary registry read.

## Index access paths

The
[transaction read module](../services/db/supabase/migrations/20260928123130_transaction_read_rules.sql)
indexes Finance parent metadata separately from its compact component values.

| Source/table                 | Key                                                            | Purpose                                                             |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Finance transaction versions | `(posted_at, id)`; `(marketplace_name, posted_at)`             | UTC instant filtering and chronological list candidates.            |
| Finance transaction versions | `(posted_date, id)`                                            | Posting-date candidates across retained versions.                   |
| Finance transaction versions | `(marketplace_name, posted_date)`                              | Native-marketplace/date selection.                                  |
| Finance components           | `(sku, version_id)`                                            | Exact SKU selection and joining its version metadata.               |
| Finance components           | `(component_type, version_id)`                                 | Type/fee-applicability candidates.                                  |
| Finance stable transactions  | `(native_transaction_id, id)`                                  | Native-ID source lookup.                                            |
| Finance stable transactions  | Unique seller/scope/native ID; current version/batch keys      | Identity and current selection.                                     |
| Finance batch membership     | Primary `(batch_id, transaction_id)`; version/batch index      | Exact observed input sets and observation lookup.                   |
| Data Kiosk days              | `(activity_date, id)`; `(marketplace_name, activity_date, id)` | Date and marketplace candidates shared by all versions.             |
| Data Kiosk day versions      | `(activity_at, id)`                                            | Preprocessed end-of-day UTC filtering and chronological candidates. |
| Data Kiosk components        | `(sku, version_id)`; `(component_type, version_id)`            | Exact SKU/Type selection and joining its day metadata.              |
| Data Kiosk batch membership  | Unique `(batch_id, day_id)`; version/day indexes               | Exact observed day contents and historical interpretation.          |

Both source projections join components, immutable versions and stable identities. Metadata and
amounts occupy separate relations, so no source index covers all date, SKU, category, ownership and
currentness conditions. Query plans must be measured against the installed schema and representative
data.

Data Kiosk component indexes include every retained category, without an amount key or predicate.
Compact SKU/Type keys retain B-tree deduplication opportunities. They can still require sorting or
merging for multi-value filters. Index-only scans depend on visibility maps maintained by vacuum.
[PostgreSQL deduplication](https://www.postgresql.org/docs/17/btree.html#BTREE-DEDUPLICATION),
[index-only scans](https://www.postgresql.org/docs/17/indexes-index-only-scans.html).

There is no amount-ordering index. Sorting uses at most the validated 10,000 matching rows. Date
bounds remain optional, and exact counts/sums still process matching facts. Primary/unique keys and
fee-period exclusion constraints preserve identities and fee coverage; they are not substitutes for
query-specific measurement. See the [performance guide](database_performance.md).

Finance batch links preserve exact observed transaction versions; Data Kiosk membership uses
`UNIQUE(batch_id, day_id)` and identifies the batch's complete day version. Payout listings retain
their creation-time/ID order and company index. Payout references identify exact transaction and day
versions directly; observation membership remains source-processing history.

## Shared rules and API configuration

[Financial read rules](../services/db/supabase/migrations/20260928123106_financial_rules.sql)
provide `private.calculate_service_fee`; Finances stores fee applicability as an explicit `fee_base`
after native preprocessing. The
[application identity module](../services/db/supabase/migrations/20260928123104_application_identity.sql)
defines the invoker view `private.current_sku_terms`. The exact fee formula remains
`-(fee_base * fee_rate_percent * 0.01)`; callers retain the missing/non-applicable branches. Current
terms include explicit unassignment, while the explicit-version payout resolver retains its captured
version scope.

[Transaction read rules](../services/db/supabase/migrations/20260928123130_transaction_read_rules.sql)
provide `private.validate_transaction_filters`, `private.validate_page_bounds`, and
`private.member_policy_covers_current_version`. Validation runs once before query execution;
source-specific fact selection and candidate limits remain in each optimized query. The frontend
normalizes search text and resolves exact catalog values. SQL receives those values as bound arrays,
not raw search text; caller values are never interpolated into SQL.

The current-pointer shortcut applies only to authenticated non-administrators with active fact RLS
that already requires current versions. Administrators, owners, and bypass contexts retain explicit
pointer checks. These helpers preserve the existing access rules and financial results.

[Application access](../services/db/supabase/migrations/20260928123123_application_access.sql)
separates transaction authorization from reference visibility. Fact policies match current source
pointers directly and still enforce each row's category and current SKU ownership. Metadata policies
keep both sources' references tied to owned current activity. Normalized parent columns exclude
account totals, hashes and component counts from member grants. Administrators retain historical
reference access. Column grants continue to exclude full report metadata, and its administrator-only
functions remain guarded. The private member helper has a fixed search path and authenticated-only
application execution.

Public RPCs use invoker security. The
[application grants](../services/db/supabase/migrations/20260928123142_application_grants.sql)
module defines the complete application allowlist after the
[SKU configuration reads](../services/db/supabase/migrations/20260928123140_sku_configuration_reads.sql)
and
[publication](../services/db/supabase/migrations/20260928123141_sku_configuration_publication.sql)
modules define their caller-checked entry points. Reference visibility does not grant transaction
access. See the [access contract](access_control.md#how-rls-enforces-this).

[REST configuration](../services/db/supabase/migrations/20260928123144_rest_api_configuration.sql)
sets `pgrst.db_aggregates_enabled=false`. General REST aggregate selections fail with `PGRST123`;
ordinary row reads, pagination counts, and these dedicated RPCs remain available.

## Diagnostic source aggregates

Administrator comparisons use `current_source_totals` or `report_source_totals`. These JSON RPCs
return only exact source/category sums, counts, coverage and revision metadata. The frontend owns
all differences and charts. They do not participate in transaction row counts or payout
calculations. The [Financial review read contract](financial_review.md#read-contract) defines
grouping and complete comparison-bucket pagination.
