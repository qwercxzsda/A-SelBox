# Data workflows

Settlement Reports and Data Kiosk are the two Amazon financial sources. Download
and archive exact documents first; preprocess successful acquisitions offline in
Python; resolve current company ownership and calculate live company fees in SQL;
freeze exact inputs and amounts when publishing company payout reports.

The [sync guide](../services/sync/README.md) owns commands and retry settings, the
[database guide](../services/db/supabase/README.md) owns setup and schema operations,
the [company-fee contract](company_fees.md) owns fee publication and
reads, and the [source-allocation contract](source_allocation.md) owns economic
source authority. The [payout report contract](company_payout_reports.md) describes
report capture and retention. Approval and payment execution remain
deferred.

## Lifecycle summary

| Data                                                    | Persistence and mutation policy                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Original documents and successful acquisition manifests | Immutable, retained indefinitely; documents in private Supabase Storage and identities/hashes/locations in PostgreSQL |
| Settlement results                                      | Complete immutable versions per financial settlement, with immutable transactions                                     |
| Data Kiosk results                                      | Complete seller/marketplace/local-day versions, including empty days; controlled history retention                    |
| Seller/SKU identities                                   | Stable seller/SKU keys with an atomically selected current terms version                                              |
| Company and fee configuration                           | Immutable terms versions: nullable company assignment plus complete fee periods for all marketplaces                  |
| Current source references                               | Updated only through validated atomic publication                                                                     |
| Company payout reports                                  | Immutable saved amounts, components, and exact source/terms manifests; approval and payment execution are deferred    |

Acquisition and preprocessing tables contain successful completed results only.
Source imports do not create seller/SKU configuration, assign companies, or create
fee coverage. Running/failed attempts produce Python logs. There are no
intermediate parsed-row tables or persisted derived company, commission, rate, or
payable copies in the source facts. Original Amazon fees remain source facts.

Each source has one transaction/component table and three category views: SKU,
account level, and others. Thus there are two source fact tables and six category
views; metadata, versions, ownership, and fee configuration have separate tables.
The required `category` uses Python `AllocationCategory` and PostgreSQL
`public.allocation_category`:

| Category        | Settlement                                          | Data Kiosk                                        |
| --------------- | --------------------------------------------------- | ------------------------------------------------- |
| `SETTLEMENT`    | Company source amounts                              | Comparison counterparts                           |
| `SELBOX`        | Account reconciliation and unmatched-family default | Forbidden on the current MSKU rows                |
| `DATA_KIOSK`    | Cost reconciliation controls                        | Approved company costs                            |
| `ANALYSIS_ONLY` | Not allowed                                         | Diagnostic facts outside the three category views |

Unknown Data Kiosk monetary components fail preprocessing. There is no stored
unresolved category. The [family rules](settlement_component_categories.md) and
[payout component policy](source_allocation.md#4-select-data-kiosk-components-without-counting-costs-twice)
define classification; view membership alone does not establish complete source coverage.

### Naming conventions

A **version** is one complete immutable snapshot for a logical identity, including
its children. An **acquisition** is successfully archived Amazon input. An
**attempt** is a Python execution and has no database status/log table.

| Version table                    | Identity covered                                  | Children                |
| -------------------------------- | ------------------------------------------------- | ----------------------- |
| `settlement_preprocess_versions` | One financial settlement                          | Transactions            |
| `data_kiosk_preprocess_versions` | One seller/marketplace/local day                  | Transactions/components |
| `sku_terms_versions`             | One seller/SKU's company and all marketplace fees | Fee periods             |

Source children use `version_id`, and source selections use `current_version_id`.
`seller_skus.current_terms_version_id` selects one `sku_terms_versions` row;
`sku_fee_periods.terms_version_id` attaches its complete fee inventory. Terms have
a seller/SKU-local `version_number`. Data Kiosk groups one successful
publication in `data_kiosk_preprocess_batches`; day versions reference `batch_id`,
and the batch references its acquisition. Settlement versions reference their
acquisition directly. Days can later select different batches, but children
within one selected day stay together. Fee periods have no separate current selection.

Both sources use parallel view names: `settlement_sku_entries`,
`settlement_account_entries`, `settlement_others_entries`, and corresponding
`data_kiosk_*` names. “Others” means `DATA_KIOSK`.

### Marketplace names

Preprocessed facts and fee periods share the `amazon_marketplace_name` enum,
with readable canonical values such as `Amazon.com`. Each fee period requires a
name; source facts keep their category-specific requirements. Optional absent
names remain null. Python's fixed API-ID mapping is part of the preprocessor definition.
Settlement validates its explicit row name; Data Kiosk validates the returned ID
against archived query scope before mapping it. Preprocessing never calls Sellers.

`Non-Amazon US` is a separate allowed settlement literal. It is not an alias for
`Amazon.com` and has no API ID mapping. Required unknown
marketplaces fail. Keep the Python mapping and SQL enum consistent when names change.
See the [marketplace evidence](evidence/settlement_classification_audit_2026-09-08.md#marketplace-evidence)
for the observed row names and the limits of Reports API hints.

Original API IDs remain in acquisition/query provenance. Reports marketplace IDs
are unmodified hints, unconstrained by the canonical-name enum; never use them,
currency, endpoint, or another row to fill a missing required settlement name.

### Shared preprocessor version

One Python `PREPROCESS_VERSION = "v0"` applies to both sources. Successful result
headers store the actual nonblank `preprocess_version`; children reference their
result UUID. The UUID identifies an execution's result, while the version string
identifies its parsing, normalization, marketplace mapping, classification, and
source-selection definition. There is no release registry table or version-name enum.

Retained results keep their processor names immutable: a changed interpretation
requires a new definition and explicit offline reprocessing, not retagging
historical rows. Ownership and fee configuration are live business data
and do not change the processor definition.

Authoritative combined calculations require one exact version name across every
required selected source result. Missing coverage or mixed versions fail; filtering
incompatible inputs out cannot produce a complete total. Version names establish
compatibility, not ordering. Three-observation comparisons also require the same
processor definition; missing comparable results mean unavailable comparison.

### Identifiers and result ordering

Trusted write paths generate UUIDv7 IDs at publication. PostgreSQL 17 administrator
inserts use `private.uuid7()`; Python uses `uuid.uuid7()`. Audit `created_at` is not
the local result ordering key. Compare UUID values descending only among eligible
results with the same source identity and processor definition.

UUID order describes ID generation, not commit order or chronology across independent
generators. Publication still needs complete-result validation, locking,
expected-current checks, and atomic references. Reject a backward ordered local
source selection. SKU terms instead advance a per-SKU revision number under the
identity lock; UUID or timestamp order does not select those terms.

Data Kiosk source freshness is separately ordered by
`root_query_created_at DESC, acquisition_id DESC`. Retrying/paginating/reprocessing
one root query preserves that observation identity. A later processing UUID cannot
make an older observation newer. The latest three means independent source
observations, not result UUIDs. Amazon exposes query creation time, not an internal
economics snapshot version; this is SelBox's selection policy, not a finality guarantee.

## A. Download and archive

Download performs Amazon discovery, submission, polling, pagination, metadata
validation, and document transfer. Document-body work is limited to lossless
compression/decompression and integrity checks. It does not parse TSV/JSONL,
rewrite text, split days, classify money, resolve companies, or look up fees.
Download success establishes a complete acquisition, not valid financial contents.
There are no FBA-report or Finances dependencies.

### Compression and integrity

For each document/page:

1. Remove Amazon compression and verify integrity; preserve the resulting encoding,
   BOM, line endings, whitespace, and row order exactly.
1. Record decoded byte length and SHA-256 before text decoding.
1. Compress with `lzma.FORMAT_XZ`, preset `2 | lzma.PRESET_EXTREME` (2e), and
   `lzma.CHECK_CRC64`. Verify an exact round trip and record archive SHA-256 and length.
1. Upload the complete private Storage object before publishing its successful
   acquisition and full document inventory in one PostgreSQL transaction.

Keep Amazon's compression declaration separate from the archive codec. Archive
original decoded document bytes, not parsed serialization or a second gzip copy.
CRC64 checks corruption; independent document/archive hashes establish byte identity.
See Python's [XZ documentation](https://docs.python.org/3.14/library/lzma.html).

Acquisitions retain seller/scope, source IDs, acquisition time, and stable object
locations. Data Kiosk additionally retains root/page query and document IDs,
query/schema definition, marketplace/date request scope, successful terminal API
provenance, and complete ordered inventory. Do not retain credentials or temporary
signed URLs as object locations. Actual day coverage is validated offline.

Archive whole Data Kiosk pages, including overlapping windows, indefinitely with
their successful manifests. Latest-three retention applies only to preprocessed
results. A fresh query is a new observation even when bytes are unchanged.

A changed decoded digest for a known settlement document fails integrity review.
Identical bytes may share an object while retaining acquisition identities.
Offline preprocessing resolves financial settlement identity as
`(seller_namespace, amazon_scope, TSV settlement-id)`: identical decoded bodies
under different API IDs are acquisition aliases counted once. Different bodies
for that identity fail; preserve both archives for investigation. Object
deduplication does not replace financial-settlement identity checks.
The [classification audit](evidence/settlement_classification_audit_2026-09-08.md)
records identical Australian reports returned under different API references.

Storage and PostgreSQL have no shared transaction. A metadata failure can leave
an uploaded orphan; log it and retain it for retry/reconciliation. Never publish
a successful acquisition with missing pages or files.

### Parse and preprocess from archives

Both preprocessors accept a successful acquisition ID and read its PostgreSQL
manifest and private Storage objects. Verify archive hash/length, XZ CRC64, and
decoded hash/length before parsing in memory. Publish only a complete validated
result. No SP-API calls, refreshes, marketplace lookups, or download fallbacks
occur here. Missing/corrupt input fails locally. Failed preprocessing retains
its acquisition and logs diagnostics without publishing partial children.

### Why retain the originals

Hashes cannot recover contents. Amazon's [report-type guide](https://developer-docs.amazon.com/sp-api/docs/report-type-values)
states a default 90-day retention, and [Settlement reports](https://developer-docs.amazon.com/sp-api/docs/report-type-values-settlement)
cannot be requested or scheduled. These rules do not prove that every known
document ID expires on day 91, but indefinite retrieval is not an established
recovery mechanism. Data Kiosk's [Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)
permits a two-year historical query window; a new query can return revised data
and does not reproduce an earlier observation on demand.

### Metadata and transaction rows

The TSV column header, first metadata data row, and monetary transaction rows
have distinct roles:

| Source fields                                            | Authority                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Reports `marketplaceIds`, `dataStartTime`, `dataEndTime` | Discovery/planning hints, never row-level financial authority                |
| Reports `reportId`, `reportDocumentId`, seller           | Required retrieval/provenance identity                                       |
| TSV metadata `settlement-id`, `currency`, `total-amount` | Matching row identity and exact signed control-total reconciliation          |
| TSV metadata start/end dates                             | Valid ordered declared period; row containment is diagnostic                 |
| TSV metadata `deposit-date`                              | Separate source date, not the company fee-period selector                    |
| TSV transaction fields                                   | Classification and live-calculation facts, with row-specific required fields |

Keep hint order/duplicates and raw `api_metadata`. Absent/null/empty marketplace
hints normalize to an empty typed tuple while raw metadata retains the distinction.
Present hints must have valid types and ordered dates. Hint differences, including
lack of overlap with a requested marketplace chunk, do not invalidate identity.
Repeated identity retains the first original summary; conflicting required identity
quarantines that report. Different report IDs may share a document ID.

Settlement membership comes from the document and matching settlement ID, not
reconstructed date filters. For valid postings outside the declared timestamp or
calendar period, retain rows and record source reference, original dates, direction,
difference, and signed amount as nonblocking diagnostics. Keep observed posting
bounds separate from the declared period. Date analysis and fees use validated
row posting dates; complete-settlement reads include all its current-version rows.

Do not clamp dates, invent tolerances, or add reserve-only exceptions. Malformed or
inconsistent posting dates, reversed metadata endpoints, identity conflicts, failed
family rules, and unreconciled amounts still fail. The [Reports model](https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json)
and [Settlement reference](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement)
provide no row-containment guarantee. Accepting validated outliers with diagnostics
is SelBox policy, not Amazon assurance that every outlier is correct.

## B. Settlement preprocessing

Parse one complete archived report, validate its structure and financial controls,
and retain typed source facts with document/physical-line provenance, raw SKU,
marketplace, component labels, signs, and references. The archive preserves every
original cell; successful tables store the facts needed for analysis and fees.

### Trailing empty fields

Require the complete supported column-name header and map cells using its actual
order. A short data row supplies a prefix; pad only its missing suffix with empty
values and convert them to null only where allowed. This also applies to the first
metadata row. Required identity, amount, date, SKU, and ordinary Order/Refund
marketplace checks still apply. Optional quantity remains unknown, never zero.
Reject excess cells; never shift cells or guess an interior omission.

Record physical line, original width, and omitted column names. Padding is in memory
and leaves archive hashes unchanged. Accepting an omitted optional suffix is a
SelBox parsing convention, not a documented Amazon format guarantee. Width and
semantic checks cannot detect every upstream delimiter loss, including an interior
omission that leaves plausible values in the remaining columns.
The [trailing-column evidence](evidence/settlement_trailing_columns_investigation_2026-09-11.md)
records the observed shortened rows and acquisition controls behind this convention.

### Classification and publication

Apply the [family rules](settlement_component_categories.md) before validation:
`SETTLEMENT` requires its known SKU family, explicit cost families use `DATA_KIOSK`,
and recognized account families or unmatched families use `SELBOX`. Failed known
checks never fall through to the default. Unmatched families preserve raw SKU and
emit a nonblocking review signal without an invented accounting subtype.

Every F1 `Order`/`Refund` row requires an explicit usable marketplace, including
noncommission and zero-valued rows. Other families may retain null where permitted.
Every nonblank SKU remains verbatim, including surrounding whitespace. Preprocessing
does not resolve ownership or require fee configuration.

Publish the successful version, typed metadata, and complete category partition
atomically after all child inventories and control totals pass. Published versions
cannot acquire children later. Select one complete version per financial settlement
across acquisition aliases. Reruns preserve older results and record the actual
processor definition; expected-current and UUID ordering checks prevent stale
publication from silently replacing an accepted selection.

## C. Data Kiosk preprocessing

Process the complete archived acquisition into seller/marketplace/local-day versions
using validated request scope and returned rows. A batch publishes every covered day
and all its children atomically; any invalid row/component aborts the entire batch.
The frontend supplies database date predicates; views have no fixed 30-day window.

Coverage includes every required SKU and component. A restricted query, missing page,
error, or unqueried day cannot replace a complete day. Empty successful days have
headers and zero children: selecting one removes prior amounts. A SKU absent from a
new complete observation remains absent, rather than surviving from an older row.
Establish empty coverage from archived query provenance and complete documents.
Only days before the root query's marketplace-local creation date qualify as complete;
an observation cannot establish a finished current or future local day.

Keep native fee subperiods, SKU, currency, component dimensions, quantities, and
source references. `(SKU, marketplace, day)` alone is not a component key. Preserve
sales/refunds, bases, taxes, promotions, and credits separately; never sum a parent
and its children. Missing monetary values and unknown quantities are not zero.

Unknown fee/advertising types and missing required amounts/collections fail before
publication. Preserve acquisition, archives, diagnostics, and prior selections for
review and rerun. Null list-element handling is a documented
[contract limitation](known_issues.md#nullable-data-kiosk-list-entries).
Validate exact signed sales equations, including
`netProductSales = orderedProductSales - refundedProductSales` and
`netUnitsSold = unitsOrdered - unitsRefunded`. Negative refunds remain signed;
do not take their absolute values before validating or calculating net sales.
Nonblank MSKU text remains verbatim.
The [signed-refund observation](evidence/category3_country_evidence_2026-09-13.md#germany-signed-refund-observation)
documents a valid negative refund in retained source data.

Publication changes only covered days and checks expected prior selections. An old
acquisition processed later cannot displace a fresher observation. Never combine
newest individual component rows from different complete versions.

### Data Kiosk component selection

Classify each component, not its entire SKU row. `SETTLEMENT` counterparts remain
for comparison; approved `DATA_KIOSK` costs supply company amounts. Current DAY/MSKU
rows require MSKU, so their account view is empty: a known account component with
MSKU fails rather than becoming `SELBOX`. Explicitly understood `ANALYSIS_ONLY`
facts remain diagnostic and do not block totals; unknown components cannot use
that category as a fallback.

Exclude Data Kiosk sales and other `SETTLEMENT` counterparts, including related
taxes/reversals, from authoritative company totals. Keep approved costs even when
the SKU also has settlement activity or its settlement counterpart defaults to
`SELBOX`. Classification does not prove required coverage. The
[payout policy](source_allocation.md) defines source authority;
frontend windows and same-day counterpart presence do not switch it.

### Retention and comparison

Retain complete day results for the latest three independent successful source
observations, including empty days, plus required referenced history. Different
preprocess results of one observation count once. Raw archives/manifests remain
indefinite regardless of result retention.

Compare complete normalized component contents and coverage under one processor
definition, excluding query IDs, processing timestamps, and row order. Equal net
totals can hide changes. Divergence is diagnostic; agreement does not establish
finality or prove separate Amazon refreshes.

Cleanup is explicit and reference-aware. Never prune current versions or versions
in `private.payout_report_data_kiosk_versions`. A saved report references every
required complete day, including empty days, and protects its entire version
payload. These immutable report dependencies are the only historical retention
pins, with no independent pin/unpin API.

Preserve version identity and original counts when deleting eligible children so
pruning cannot appear as successful empty coverage. Report capture and pruning
require READ COMMITTED transactions and lock days in the same natural order before
rechecking selections and references. Already-pruned evidence cannot be attached
to a report. Increasing a limit does not restore rows automatically; retained
archives support explicit reprocessing into a new result.

## D. Company terms and payout reports

Source imports never register or assign SKUs. An administrator publishes a complete
company assignment and all marketplace fee periods for one seller/SKU through
`publish_sku_terms()`. The stable identity selects that immutable revision.
Explicit unassignment and empty fee inventories are valid; 0% means known coverage.
Reassignment restates all live history. See the [company-fee contract](company_fees.md)
for exact rates, fee eligibility, current-only access, and partial summaries.

`publish_company_payout_report()` declares one company, seller, currency, inclusive
date range, processor definition, required settlements and marketplace/day coverage.
It captures current source and terms versions, validates all authoritative scoped
rows, and then saves that company's exact amounts and components atomically.
Missing ownership, fee coverage, or source versions reject publication.

Private typed manifests retain every required source version, including empty
Data Kiosk days, and terms used to explain both included and excluded rows.
Later source replacement, fee changes, reassignment, and retention cannot rewrite
a saved report. Read its stored values through `load_company_payout_report()` and
`load_company_payout_report_components()`. The [payout report contract](company_payout_reports.md)
owns the schema, permissions, locking, and integrity checks.

The [refund commission over-credit policy](known_issues.md#deferred-refund-commission-over-credit-risk)
remains deferred. Reports use the same posting-date fee formula as live reads;
approval, payment execution, and currency rounding remain separate work.

## Financial values

Python `Numeric` stores finite `Decimal` with `NUMERIC_PRECISION_BOUND = 1000`
fixed-point digits, including implied and trailing zeros. Addition, subtraction,
and multiplication are exact independently of decimal context. Over-bound source
results raise `NumericBoundError`; never round to fit. PostgreSQL source `numeric`
uses an exact-value domain without a fixed scale.

Fee percentages remain 0–100 inclusive with at most six fractional digits,
including trailing zeros; reject excess precision. Live fees and aggregates use
exact decimal arithmetic without reapplying the per-source bound. Payout currency
rounding remains a separate future decision.

### Quantities and readers

Settlement quantities use the nonnegative `bigint` range. Aggregates use exact
decimal arithmetic; a required unknown component quantity leaves its aggregate
unknown. Keep sales, refund, and fee quantities distinct instead of counting the
same units across principal/tax/fee components. Select complete current versions
and keep currencies/economic components separate.

Drivers return `Decimal`; serialization must preserve precision, such as decimal
strings. Display approximations are not source truth. Apply date filters in database
queries rather than fetching all history for client filtering.

## Access and query behavior

Application accounts and current seller/SKU assignment determine live company
visibility without repeating company IDs on source transactions. Public views
use `security_invoker = true`, underlying grants, and RLS. Company members see
only permitted current source versions and selected terms for their own company.
Operators manage member access, publish complete terms, and read all retained
source/terms history and all payout reports, components, and input references.
Company members have no payout access. Original archives, source/payout
publication, and pruning remain direct-database/archive-service operations.
See the [application-access contract](access_control.md).

Index and measure representative authenticated account, ownership,
marketplace/date, and fee-period reads before adding caches. A materialized view is
a performance cache, not payout history. The [database guide](../services/db/supabase/README.md)
owns the concrete grants and views.

## Installation and verification

The migrations install acquisitions, complete source versions, current selections,
company terms, saved payout reports, publication functions, and access policies
into a fresh database. They do not provide an upgrade or backfill path for an
existing deployment. The [database guide](../services/db/supabase/README.md)
documents installation and verification commands.

Implementation checks belong alongside the behavior they exercise: archive integrity
and offline replay; complete/stale publication; ownership/rate coverage and exact
calculations; fresh schema and authenticated access; and reference-aware retention.
The [live-fee acceptance cases](company_fees.md#implementation-and-acceptance)
and service test commands provide executable checks. Documented invariants alone
are not proof of live Amazon or database verification.

## Failure boundaries

| Failure                                              | Required outcome                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Download/inventory failure                           | Log; publish no incomplete acquisition; keep independently completed acquisitions and uploaded evidence                   |
| Preprocessing failure                                | Retain archives/diagnostics; publish no partial successful result; preserve current selection                             |
| Stale or failed publication                          | Preserve prior complete selection and retry with explicit source/local ordering                                           |
| Missing business ownership/rate or required coverage | Expose the gap and reject authoritative totals; valid source preprocessing remains possible                               |
| Payout report publication                            | Reject incomplete scope or unresolved terms; publish saved amounts and complete typed manifests atomically                |
| Retention cleanup                                    | Preserve archives/manifests, current and payout-referenced versions, and the distinction between pruned and empty results |
