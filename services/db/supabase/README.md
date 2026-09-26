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

## Application reads

All browser financial reads use authenticated REST/RPC with invoker security and base-table RLS.
`transaction_page` and `source_transaction_page` select filtered, authorized rows before metadata
and fee projection. `transaction_count` and `source_transaction_count` count facts independently.
`transaction_totals` combines compatible facts before fee lookup; `dataset_filter_options` returns
distinct authorized values. General REST aggregates are disabled. See the
[query contracts](../../../docs/transaction_query_contracts.md) for parameters and numeric formats.

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
history reads as well as current Transactions. The browser
checks them on its polling interval, focus, and reconnection and invalidates only dependent reads.
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
select private.compare_data_kiosk_observations(id, 'v0')
from private.data_kiosk_days
where seller_namespace = 'seller-na'
    and marketplace_name = 'Amazon.com'
    and activity_date = date '2026-08-01'
    and dataset_key = 'economics';
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
