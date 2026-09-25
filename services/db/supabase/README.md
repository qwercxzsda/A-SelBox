# Supabase database

PostgreSQL 17 schema for immutable archived Settlement/Data Kiosk inputs, versioned company/SKU
terms, live financial reads, and frozen payout reports. The migrations form a fresh-install baseline
with one current definition per object. Obsolete intermediate query definitions and upgrade steps
have been consolidated. Tables, constraints, access rules, and financial behavior remain; optional
read indexes are tuned separately without changing those contracts.

The [transaction query contracts](../../../docs/transaction_query_contracts.md) describe the current
transaction/source pages and counts, totals, and filter-option APIs. The
[schema design review](../../../docs/schema_design_review.md) records the implemented maintenance
changes and distinguishes them from its earlier conditional redesign proposals. The
[refactor verification](../../../docs/evidence/database_read_refactor_2026-09-25/README.md) records
fresh-install catalog comparisons, tests, and before/after performance measurements.

## Local setup

From the repository root:

```sh
supabase start --workdir services/db
```

API and Storage use `http://127.0.0.1:54321`; PostgreSQL uses port 54322. The existing seeded
database is preserved. Consolidating source files does not update an existing database: this
sequence is the canonical fresh-install definition, not an incremental upgrade chain to replay
against existing tables. Review and apply data-preserving function/view/index updates separately
when updating an existing local instance. Verification below uses disposable databases and leaves
seeded data and migration records intact.

## Schema modules

Files execute in this dependency order. Each module owns its current definitions rather than
redefining objects created by an earlier read experiment.

| Module                                                                                 | Responsibility                                                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [live_source_versions](migrations/20260912072531_live_source_versions.sql)             | Types, source and terms tables, constraints, ownership/version and selected read indexes, immutable identities, and private archive bucket. |
| [atomic_publications](migrations/20260912072703_atomic_publications.sql)               | Complete acquisition/source/fee publication, current pointers, immutable inventories, and payout-aware pruning.                             |
| [live_company_reads](migrations/20260912072704_live_company_reads.sql)                 | Current terms and financial rules, source/live views, explicit-version resolver, strict financial totals, and observation comparison.       |
| [company_payout_reports](migrations/20260914062544_company_payout_reports.sql)         | Immutable report components and manifests, publication, completeness, and retained-evidence validation.                                     |
| [application_access](migrations/20260914094640_application_access.sql)                 | Database-backed accounts, final RLS policies, current-version authorization, explicit grants, and guarded operator functions.               |
| [workspace_revision_polling](migrations/20260922162533_workspace_revision_polling.sql) | Transactional source and company-scoped terms revision tokens and the authenticated polling RPC.                                            |
| [transaction_read_rules](migrations/20260925065531_transaction_read_rules.sql)         | Shared typed read validation and current-policy eligibility rules.                                                                          |
| [transaction_count](migrations/20260925065533_transaction_count.sql)                   | Exact authorized fact counts without financial decoration.                                                                                  |
| [transaction_page](migrations/20260925065535_transaction_page.sql)                     | Date/amount-ordered source candidates and page selection before metadata and fees.                                                          |
| [transaction_totals](migrations/20260925065538_transaction_totals.sql)                 | Date-bounded, currency/type totals with fact grouping before fee lookup.                                                                    |
| [dataset_filter_options](migrations/20260925065540_dataset_filter_options.sql)         | Distinct authorized options with stable text cursors.                                                                                       |
| [rest_api_configuration](migrations/20260925065542_rest_api_configuration.sql)         | Disable generated REST aggregates and reload PostgREST configuration/schema.                                                                |
| [source_transaction_page](migrations/20260925095337_source_transaction_page.sql)       | Date/amount-ordered raw source pages with unchanged historical visibility.                                                                  |
| [source_transaction_count](migrations/20260925102039_source_transaction_count.sql)     | Exact raw source counts with shared literal-search semantics.                                                                               |

## Read path

`transaction_page` filters eligible facts before taking at most `offset + limit` candidates from
each source for Date ordering. Reported amount ordering first gathers at most 10,001 matches,
rejects an excess over 10,000, and otherwise sorts the complete matching set. It selects the page
before resolving its metadata, current ownership, and fees. Date, source and row ID reverse
together; amount ordering keeps ascending source/ID ties. An optional exact count delegates to
`transaction_count` in the same statement; the frontend requests rows first and caches a separate
count until revision invalidation. Both search and unfiltered pages use the same RPCs. Transactions
offers Date and Reported amount ordering; Company amount ordering is no longer offered.

Page/count fee applicability filters raw source Types: Settlement `PRODUCT_SALES`/`PRODUCT_REFUNDS`
and Data Kiosk `NET_PRODUCT_SALES`. This exposes the existing Type/date indexes. Zero bases, zero
rates, and missing configuration remain applicable. Actual fee calculations keep Settlement's
Order/Refund ItemPrice Principal rule and Data Kiosk's stored fee base. Typed marketplace arrays
compare native enum values without casting the stored column. Index use still depends on the plan
and RLS ordering. The
[API contract](../../../docs/transaction_query_contracts.md) records exact parameters, validation,
filters, and response shapes.

`transaction_totals` requires a date bound and combines facts sharing seller/SKU, marketplace, date,
currency, optional Type, and fee applicability before resolving fees. It preserves exact numeric
arithmetic, partial/null sums, and row/known-company counts. `dataset_filter_options` reads distinct
eligible values without fees or occurrence counts. Both use scalar JSON envelopes with one lookahead
result and explicit continuation, rather than an additional exact source-row count.

All application reads retain invoker security and existing RLS. A duplicate current-pointer lookup
is omitted only when an authenticated non-operator already has active fact RLS enforcing that check.
Other contexts keep the explicit pointer check. This depends on the current policy contract. The
complete live view and explicit-version payout resolver remain active financial functionality.

Each source has one full `(date ASC NULLS LAST, id ASC)` index, scanned forward for oldest-first and
backward for newest-first. Both also have compact `(sku, date)` and `(component_type, date)` indexes
without ID tails, allowing repeated key/date pairs to benefit from B-tree deduplication. Only Data
Kiosk retains `(marketplace_name, date)`, for privileged backend financial reads. Native enum
equality is not leakproof in PostgreSQL 17, so authenticated UI marketplace filters may remain above
the RLS-protected fact scan instead of using that index as a restriction.

The former namespace/SKU/date indexes and Settlement marketplace/date index are removed. Existing
ownership/version and current-pointer indexes remain, including Settlement's trailing
category/marketplace keys for exact counts. Primary/unique constraints and fee-period GiST
exclusion remain unchanged. Amount sorting is bounded to 10,000
filtered/search-matched/authorized rows; there are no dedicated amount, fee-rate, service-fee, or
company-amount ordering indexes. See the
[index access paths](../../../docs/transaction_query_contracts.md#index-access-paths) for the
selected layout and its limits, and the
[balanced-index evidence](../../../docs/evidence/balanced_read_indexes_2026-09-25/README.md) for
measured reads, storage, and insert cost.

The other application tables retain 44 indexes, including all 35 constraint-backed indexes.
The payout report list uses `(created_at DESC NULLS LAST, id ASC)`; a separate narrow `company_id`
index supports company FK checks. Batch lookups reuse `UNIQUE(batch_id, day_id)`. Unused reverse
lookups into immutable acquisitions, payout terms/fees, and Settlement pins are removed; the active
Data Kiosk retention-pin index remains. The
[other-table audit](../../../docs/evidence/other_table_indexes_2026-09-25/README.md) documents
every index, its callers, the benchmark tradeoffs, and integrity checks.

`source_transaction_page` provides Date and Reported amount ordering for the Settlements and Data
Kiosk tabs. It preserves the raw views' historical-version and category visibility under existing
RLS, and excludes zero Data Kiosk amounts before pagination. It returns exact numeric strings. The
raw tabs use the same 10,000-match amount-sort cap; Date ordering and exact counts remain uncapped.
Raw source counts use `source_transaction_count`; pages and counts both support `p_search`. See the
[reported-amount ordering evidence](../../../docs/evidence/reported_amount_ordering_2026-09-25/README.md).

Text search is an ordinary literal, case-insensitive predicate over SKU, Type, Marketplace,
Currency, and (for Transactions) Source. It runs alongside existing filters before page selection
and the amount-sort cap. No fee-status, processing-version, or hidden metadata search joins remain.
An unknown nonempty term returns zero matches. The database handles matching without downloading
option lists or relying on their freshness. See
[text-search verification](../../../docs/evidence/text_search_2026-09-25/README.md).

`pgrst.db_aggregates_enabled` is `false`. Generated `.sum()`/`.count()` selections are rejected;
aggregation inside dedicated RPCs and ordinary pagination counts remain available. There is no
frontend fallback to generated aggregates. See the
[maintained benchmark guide](benchmarks/README.md),
[date-page evidence](../../../docs/evidence/ordered_pages_2026-09-25/README.md),
[million-row REST measurements](../../../docs/evidence/current_transaction_queries_2026-09-25/README.md),
and
[dedicated aggregation measurements](../../../docs/evidence/dedicated_aggregation_2026-09-25/README.md).
Historical measurements retain their observation date and query checkpoint; the module map above
identifies current source definitions.

Revision polling reads account access and up to three private token records. Source tokens are
global; fee/ownership/label tokens are company-scoped for members and global for operators. Current
pointer changes rotate tokens at commit, including backdated reprocessing and empty replacements.
The RPC derives account scope from `auth.uid()` and exposes no private source rows. See
[polling evidence](../../../docs/evidence/workspace_revision_polling_2026-09-23.md).

DB administrators create companies and bootstrap operators through trusted SQL. Complete seller/SKU
terms are published through Python/SQL or the guarded operator RPC. A revision selects a company or
explicit unassignment and the complete fee inventory across marketplaces. Source imports do not
register or assign SKUs. UUIDv7 IDs and audit timestamps are generated when omitted; timestamps do
not select current financial results.

## Archives and publication

The private `source-archives` Storage bucket retains complete decoded documents under immutable
content-addressed `.xz` keys. The service checks that the bucket is private and uses
`SUPABASE_SERVICE_ROLE_KEY` from its process environment. Operators and company members have no
archive access. XZ settings are `FORMAT_XZ`, preset `2 | PRESET_EXTREME`, and `CHECK_CRC64`.

Successful acquisition manifests retain document/archive digests and lengths, compression
declarations, API provenance, query coverage, and ordered complete page inventories. They exclude
compressed bytes and temporary signed URLs. Archives and successful acquisitions are retained
indefinitely.

Storage uploads cannot participate in a PostgreSQL transaction. Upload and verification finish
before a successful acquisition is published; a database failure may leave an orphaned upload
available for retry or reconciliation.

The private JSON publication functions return UUIDs:

```text
publish_settlement_acquisition(jsonb)
publish_data_kiosk_acquisition(jsonb)
publish_settlement_preprocess(jsonb)
publish_data_kiosk_preprocess(jsonb)
publish_sku_terms(jsonb)
publish_company_payout_report(jsonb)
```

The Python repositories publish each complete payload in one transaction. Source and fee
replacements check the expected current reference; stale or incomplete writes roll back. Published
child sets cannot be extended or rewritten. These private publishers are restricted to trusted
database writers, independently of Storage service-role access. Operators reach terms publication
only through the caller-checked public RPC. Python validates and normalizes archived inputs; the
database enforces ownership, inventory, amount, category, and current-version constraints at
publication.

## Source model

Both preprocessors publish `PREPROCESS_VERSION = "v0"`. Each result retains its version name;
combining required inputs with different names fails. Source facts contain no copied company,
applied rate, or derived company fee.

Each source fact stores one required `public.allocation_category`: `SETTLEMENT`, `SELBOX`,
`DATA_KIOSK`, or `ANALYSIS_ONLY`. Settlement permits the first three; Data Kiosk permits all four.
Every fact requires a monetary amount. Unknown or incomplete Data Kiosk components fail
preprocessing before any day is published, preserving archived inputs and current results for
review.

Settlement `SETTLEMENT` facts require SKU. Recognized Settlement account families use `SELBOX` and
require blank SKU; unmatched `SELBOX` rows preserve any raw SKU. Data Kiosk `DATA_KIOSK` facts
require SKU and `SELBOX` facts require blank SKU. Marketplace names use
`public.amazon_marketplace_name`, including distinct `Non-Amazon US`; Amazon API IDs remain
acquisition provenance.

Report aliases sharing seller, Amazon scope, TSV settlement ID, and decoded bytes share one
canonical settlement. Conflicting bytes fail preprocessing while the archives remain retained. Data
Kiosk source freshness uses root query creation time and acquisition UUID. Reprocessing older
archives cannot advance the source observation. Complete empty days replace previous facts;
unqueried days stay intact.

## Live calculations and access

The current source category views are:

- Settlement: `settlement_sku_entries`, `settlement_account_entries`, `settlement_others_entries`.
- Data Kiosk: `data_kiosk_sku_entries`, `data_kiosk_account_entries`, `data_kiosk_others_entries`.

Each resolves one complete current version with no rolling date window. `ANALYSIS_ONLY` remains
available in diagnostic reads outside these category views. `public.live_company_components` joins
source facts to selected seller/SKU terms, exposes source/fee references, and identifies which
components are authoritative. Strict financial totals include Settlement `SETTLEMENT` and Data Kiosk
`DATA_KIOSK` facts. Dashboard estimates instead combine all visible transaction sources, excluding
zero-amount Data Kiosk rows, as defined in the
[transaction query contracts](../../../docs/transaction_query_contracts.md).

The live view uses relational current-source joins so outer date and SKU filters can reach source
facts. It evaluates selected terms once per query. Current source pointers already enforce identity
through composite foreign keys; the view joins each pointer once. The explicit-version resolver used
by frozen payout reports remains unchanged, including its exact fee and company-amount formulas.

Member header/version policies use the private `current_company_source_versions(text)` helper to
derive permitted current version IDs from the caller's current SKU ownership once per policy
evaluation. It is a caller-bound, ID-only authorization helper with authenticated execution, not a
public financial or aggregate RPC. Operator access and source-row RLS remain unchanged. Partial
owner/version indexes and current-pointer indexes support eligibility checks. The obsolete Boolean
`can_read_current_source_version` wrapper has been removed; policies call the set-returning helper
directly. One date/identity index per source supports both newest-first and oldest-first ordering
through backward and forward scans. Both date indexes cover every source category, so raw
history/account pages can use them too. Partial ownership/version eligibility indexes keep their
existing predicates. SKU/Type prefixes provide additional selective paths; the planner chooses
between them according to the query and authorized scope.

Exact counts and whole-history aggregates still process their matching rows. See the
[optimization evidence](../../../docs/evidence/live_read_optimization_2026-09-19.md) for
measurements, regression checks, and scale-test limitations.

`seller_skus` stores stable identity and the selected terms pointer; `sku_terms_versions` stores
nullable company assignment and complete revision inventories; `sku_fee_periods` stores
marketplace/date rates. `company_skus` and `current_sku_fee_periods` are current projection views.
Reassignment restates all live history; explicit unassignment preserves identity and version
history.

Terms contain nonoverlapping `[start, end)` periods per marketplace with an optional unbounded end.
Exact percentages range from 0 through 100 with at most six fractional digits; excess precision is
rejected without rounding. Empty inventories withdraw coverage. Historical periods do not become
active again.

Fee calculations preserve `MISSING_OWNERSHIP` and `MISSING_FEE` diagnostics. Source constraints
already require the dates and marketplaces used by fees. `APPLIED` includes explicit zero rates;
`NOT_APPLICABLE` identifies noncommission components. Required unresolved amounts remain null rather
than being ignored in a complete total.

Privileged totals require an explicit source scope:

```text
private.company_financial_totals(
  seller_namespace, start_date, end_date, preprocess_version,
  settlement_ids uuid[], marketplaces amazon_marketplace_name[], dataset_key
)
```

Dates are inclusive. Every declared settlement and marketplace/day must have a compatible current
result. Missing required ownership, fees, or source coverage raises an error. Currencies remain
separate, and the Python financial reader preserves SQL aggregates as exact `Decimal` values.

`private.company_financial_progress(...)` accepts the same scope, permits missing fees, and returns
known sums plus missing-fee details. Source coverage and ownership remain required. See the
[partial-summary contract](../../../docs/company_fees.md#partial-live-summaries).

All application tables enable RLS. `public.app_accounts` holds one row per authorized Auth user:
`operator` with no company, or `company_member` with one required company. Operators list all
application accounts and add/remove members or change their company through REST. Only the DB
administrator manages operators; Auth identities are not created or deleted by application-access
changes.

Public views use `security_invoker = true`. Company members see their permitted current source facts
and selected fee terms; raw-table RLS also excludes historical versions. Operators see all retained
source/terms history and publish complete terms through `public.publish_sku_terms(...)`. Full
historical preprocessing metadata uses guarded operator-only read functions behind public views,
preserving narrow member grants on source headers. Archives and privileged completeness functions
remain unavailable through application REST access.

See the [application-access contract](../../../docs/access_control.md) for the permission matrix,
account lifecycle, bootstrap SQL, and exact REST endpoints.

## Frozen payout reports

`private.publish_company_payout_report(jsonb)` captures current source and terms versions for an
explicit scope and saves exact report totals and components. It rejects unresolved authoritative
rows before selecting the requested company and currency. Typed private manifests retain every
required source version, including empty Data Kiosk days, and all authoritative scoped SKU terms
needed to explain inclusion and exclusion. Later live changes cannot rewrite a report.

Report/component RLS requires an operator. Company members cannot read saved payouts, including
their own company's reports. Operators can also read complete input manifests through public
invoker-security views. See the
[payout report API and guarantees](../../../docs/company_payout_reports.md). Operator REST reads
allow `select=*`, including all source/terms inventory counts. The trusted Python repository retains
full access and is the payout publication interface; application operators cannot publish reports.
Approval, payment execution, currency rounding, and the refund commission over-credit policy are not
implemented by report publication.

## Observation comparison and retention

```sql
select private.compare_data_kiosk_observations(id, 'v0')
from private.data_kiosk_days
where seller_namespace = 'seller-na'
    and marketplace_name = 'Amazon.com'
    and activity_date = date '2026-08-01'
    and dataset_key = 'economics';
select private.prune_data_kiosk_preprocess(3);
```

Comparison uses the latest three independent observations with compatible preprocessing and their
normalized-content digests. Missing or pruned comparable results are unavailable. Equal observations
do not establish financial finality.

Explicit pruning retains at least three independent observations per day, every current version, and
every payout-referenced version. It deletes eligible fact payloads while retaining original counts
and audit identities. Acquisitions, document inventories, and archives remain intact. Increasing
retention does not restore pruned payloads; archived inputs can be reprocessed explicitly.

Source publication, payout capture, and pruning acquire day locks in stable natural identity order.
Report dependency inserts validate retained evidence under the same day lock. Report capture and
pruning require `READ COMMITTED`. Report dependencies are immutable; there is no independent
pin/unpin API. Reprocessing pruned evidence creates a new version. Python does not automatically
retry stale publication failures.

## Verification

With local Supabase running:

```sh
conda run -n A-SelBox python -m services.db.supabase.tests.run_schema_contract
conda run -n A-SelBox python -m unittest discover -s services/db/supabase/tests
```

The loopback-only harness creates disposable databases with minimal Auth/Storage interfaces,
installs the baseline, and drops each database afterward. It never rebuilds existing development
schemas or changes their migration records and archives. Tests cover complete publication and
rollback, real XZ parsing through repositories, fee corrections, empty days, source ordering, exact
filtered tenant totals, cross-company access, frozen reports, and concurrent publication, payout
capture, and pruning. Live-view regressions compare all 24 output columns against the
explicit-version resolver across roles, ownership changes, historical versions, fee diagnostics, and
filtered reads; plan checks verify that date predicates reach both fact scans. These PostgreSQL
checks do not exercise hosted Storage or SP-API transport.

Run the separate, opt-in end-to-end suite from the repository root:

```sh
conda run -n A-SelBox python -m unittest discover -s services/db/supabase/tests/e2e -v
```

This suite requires the Supabase CLI and Docker running through a local Unix socket. It creates a
fresh disposable Supabase stack with a copied baseline, an independent project ID, and allocated
local ports, then removes it after the run. Test clients use validated loopback URLs. The first
startup may need to pull Docker images. It does not load `.env`, use cloud credentials, or contact
production databases; existing local development data is left intact.

The workflow uses synthetic Amazon documents with real Storage uploads and downloads, acquisition
publication, preprocessing, Auth-issued user tokens, and company reads through PostgREST. Amazon
transport remains synthetic, so this suite does not establish live SP-API or production deployment
readiness.

See the [workflow contract](../../../docs/data_workflows.md),
[live-fee contract](../../../docs/company_fees.md), and [sync commands](../../sync/README.md) for
the application workflows.
