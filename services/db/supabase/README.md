# Supabase database

PostgreSQL 17 schema for immutable archived Settlement/Data Kiosk inputs, versioned company/SKU
terms, live financial reads, and frozen payout reports. The migrations form a fresh-install baseline
with one current definition per object.

- [Schema](../../../docs/database_schema.md): tables, relationships, publication, and retention.
- [Application access](../../../docs/access_control.md): account roles, grants, RLS, and administration.
- [Query contracts](../../../docs/transaction_query_contracts.md): exact page/count/summary/filter APIs.
- [Performance](../../../docs/database_performance.md): current access paths, measurements, and scaling limits.
- [Company fees](../../../docs/company_fees.md): current ownership, signed fees, and missing configuration.

## Local setup

From the repository root:

```sh
supabase start --workdir services/db
```

API and Storage use `http://127.0.0.1:54321`; PostgreSQL uses port 54322. The frontend can target a
separate seeded instance through its explicit configuration; that instance currently uses ports
55421 and 55422. Read the [frontend setup guide](../../frontend/user-webpage/README.md#configuration)
for its configuration.

Starting Supabase preserves existing data. The canonical migrations install a fresh database;
they are not an incremental upgrade chain to replay against existing tables. Apply reviewed,
data-preserving function/view/index changes separately to an existing local instance. Verification
uses disposable databases and leaves development data and migration records intact.

## Schema modules

Files execute in dependency order. The foundation closes direct API access before publication
and read modules are created. Publication integrity precedes writers; financial relations precede
strict reads and payouts; retention follows its payout-manifest dependencies. Authorization is
explicit, exact counts precede row-page APIs, and PostgREST reloads only after the final module.
Each database object has one maintained definition.

| Module                                                                           | Responsibility                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [schema_foundation](migrations/20260927080039_schema_foundation.sql)             | Physical source and terms model, immutable identities, read indexes, RLS defaults, archive bucket. |
| [archive_publications](migrations/20260927080041_archive_publications.sql)       | Immutable archive manifests and acquisition publication.                                           |
| [publication_integrity](migrations/20260927080043_publication_integrity.sql)     | Complete child inventories, selected pointers, transaction isolation, immutable source payloads.   |
| [terms_publication](migrations/20260927080045_terms_publication.sql)             | Atomic current ownership and fee revision publication.                                             |
| [source_publications](migrations/20260927080047_source_publications.sql)         | Atomic Settlement and Data Kiosk preprocessing publication.                                        |
| [financial_relations](migrations/20260927080050_financial_relations.sql)         | Shared fee arithmetic, current terms/live relations, explicit-version resolver.                    |
| [financial_reads](migrations/20260927080052_financial_reads.sql)                 | Strict complete and partial financial reads with declared source coverage.                         |
| [company_payout_reports](migrations/20260927080054_company_payout_reports.sql)   | Frozen entitlement reports, complete manifests, validation, and publication.                       |
| [source_retention](migrations/20260927080056_source_retention.sql)               | Payout-aware pruning, pin guards, and observation comparison.                                      |
| [application_access](migrations/20260927080058_application_access.sql)           | Database accounts, RLS policies, narrow projections, operator actions, explicit API grants.        |
| [workspace_revisions](migrations/20260927080101_workspace_revisions.sql)         | Transactional source/terms revision tracking and polling.                                          |
| [transaction_read_rules](migrations/20260927080103_transaction_read_rules.sql)   | Shared transaction filter/pagination validation and current-policy eligibility.                    |
| [transaction_counts](migrations/20260927080105_transaction_counts.sql)           | Exact live and raw authorized counts.                                                              |
| [transaction_page](migrations/20260927080107_transaction_page.sql)               | Bounded live row selection before ownership and fee projection.                                    |
| [source_transaction_page](migrations/20260927080109_source_transaction_page.sql) | Bounded raw source pages retaining historical visibility.                                          |
| [transaction_totals](migrations/20260927080111_transaction_totals.sql)           | Date-bounded currency/Type totals with grouping before fee lookup.                                 |
| [sku_filter_options](migrations/20260927080113_sku_filter_options.sql)           | Administrator-only complete SKU catalog using native index seeks.                                  |
| [rest_api_configuration](migrations/20260927080115_rest_api_configuration.sql)   | Disable generated REST aggregation and reload final API schema/configuration.                      |

## Application reads

All browser financial reads use authenticated REST/RPC with invoker security and base-table RLS.
`transaction_page` and `source_transaction_page` select filtered, authorized rows before metadata
and fee projection. `transaction_count` and `source_transaction_count` count facts independently.
`transaction_totals` combines compatible facts before fee lookup. Administrator identity bootstrap
preloads `sku_filter_options`, including unregistered, unassigned, historical, and registered-only
SKUs in one request. The no-argument RPC derives distinct names once per load rather than once per
cursor page. Company members reuse their current assignments. Source, Marketplace, and Type menus
use static catalogs. The frontend resolves table search to exact OR sets; Currency is not searchable.
General REST aggregates are disabled. See the
[query contracts](../../../docs/transaction_query_contracts.md) for parameters and numeric formats.

Administrator catalog discovery uses the existing SKU/date indexes to seek between distinct source
SKU values, avoiding repeated transaction entries. The RPC checks the stored application-operator
role before discovery and rejects other callers with SQLSTATE `42501`. It includes the registry,
returns exact strings in `C` order, and retains invoker security. Company-user filters use loaded
assignments and make no discovery request.

Ownership RLS uses the private caller-bound `current_owned_sku_terms()` set rather than repeated
per-row terms resolution. It reads current database account and assignment state, accepts no
caller-selected identity, and retains the existing current-version/category boundaries. Page and
totals queries project terms only for their selected page or grouped facts. Existing indexes
support these lookups. The [performance guide](../../../docs/database_performance.md#authorization-and-current-versions)
explains the current authorization path and remaining inventory costs.

Date ordering reverses the complete date/source/ID tuple. Reported amount ordering is limited to
10,000 fully filtered matches, with no dedicated amount index. Marketplace names use constrained
text. Date, SKU, Type, marketplace, and ownership/version indexes support the measured access paths;
the [performance guide](../../../docs/database_performance.md) explains their tradeoffs.

The relational `live_company_components` view supports complete current reads. The explicit-version
resolver and strict financial functions are active backend functionality: they validate declared
source coverage and use authoritative allocation rules for exact financial reads and payouts.
Dashboard estimates instead combine all eligible Transactions sources, excluding zero Data Kiosk
amounts, and identify unresolved company amounts. These are separate product contracts.

`workspace_revisions` reads the authenticated account and requested opaque source/fee tokens.
Source revisions are global; fee, ownership, and company-name revisions are company-scoped for
members and global for operators. Source-version publication, current-pointer changes, and
historical Data Kiosk pruning update source tokens atomically at commit. This covers administrator
history reads as well as current Transactions. The browser checks them on its polling interval, focus, and reconnection and invalidates only dependent reads.
The [frontend lifecycle](../../frontend/user-webpage/README.md#requests-and-session-lifecycle)
defines cache behavior.

## Archives and publication

The private `source-archives` Storage bucket retains content-addressed XZ archives indefinitely.
The archive service receives `SUPABASE_SERVICE_ROLE_KEY` through its process environment; application
operators and company members cannot read those archives. Storage uploads finish before PostgreSQL
publication and do not share its transaction. A failed metadata publication may leave an orphaned
upload for reconciliation.

The trusted Python repositories publish complete JSON payloads through these private functions:

```text
publish_settlement_acquisition(jsonb)
publish_data_kiosk_acquisition(jsonb)
publish_settlement_preprocess(jsonb)
publish_data_kiosk_preprocess(jsonb)
publish_sku_terms(jsonb)
publish_company_payout_report(jsonb)
```

Source and terms replacements validate the expected current reference, complete inventories, and
financial controls atomically. Published children cannot be extended or rewritten. Source imports
do not assign companies or create fee terms. Operators publish terms only through the guarded
`public.publish_sku_terms` RPC; source/payout publication remains trusted Python/SQL work.
See the [workflow contract](../../../docs/data_workflows.md) and
[sync commands](../../sync/README.md).

DB administrators create companies and bootstrap operators. Application accounts live in the
database; user-editable Auth metadata cannot grant access. Company members see permitted current
facts and selected terms for their company, plus narrow current source references shared across
companies. Full metadata and saved payouts are operator-only. The
[permission matrix](../../../docs/access_control.md#permission-matrix) is the access contract.

## Observation comparison and retention

```sql
select private.compare_data_kiosk_observations(d.id, v.preprocess_version)
from private.data_kiosk_days as d
join private.data_kiosk_preprocess_versions as v on v.id = d.current_version_id
where d.seller_namespace = 'seller-na'
    and d.marketplace_name = 'Amazon.com'
    and d.activity_date = date '2026-08-01'
    and d.dataset_key = 'economics';
select private.prune_data_kiosk_preprocess(3);
```

Comparison uses the latest three independent observations with compatible preprocessing and
normalized-content digests. Missing or pruned comparable results are unavailable; equal observations
do not establish financial finality.

Pruning retains at least three independent observations per day, every current version, and every
payout-referenced version. It removes eligible fact payloads while preserving original counts,
headers, acquisitions, and archives. Increasing retention cannot restore removed rows; archived
inputs can be explicitly reprocessed into new versions.

Publication, payout capture, and pruning acquire day locks in stable natural order. Capture and
pruning require `READ COMMITTED`. Typed immutable payout references protect whole versions,
including empty days. See the [payout contract](../../../docs/company_payout_reports.md) and
[known limitations](../../../docs/known_issues.md).

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
