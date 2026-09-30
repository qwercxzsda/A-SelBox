# Supabase database

PostgreSQL 17 schema for immutable archived Settlement/Data Kiosk inputs, versioned company/SKU
terms, live financial reads, and frozen payout reports. The migrations form a fresh-install baseline
with one current definition per object.

- [Schema](../../../docs/database_schema.md): tables, relationships, publication, and retention.
- [Application access](../../../docs/access_control.md): account roles, grants, RLS, and administration.
- [Query contracts](../../../docs/transaction_query_contracts.md): exact page/count/summary/filter APIs.
- [Performance](../../../docs/database_performance.md): current access paths, measurements, and scaling limits.
- [Company fees](../../../docs/company_fees.md): current ownership, signed fees, and missing configuration.
- [Payout reports](../../../docs/company_payout_reports.md): monthly generation, snapshots, and reuse.

## Local setup

From the repository root:

```sh
supabase start --workdir services/db
```

API and Storage use `http://127.0.0.1:54321`; PostgreSQL uses port 54322. The frontend can target a
separate seeded instance through its explicit configuration; that instance currently uses ports
55421 and 55422. Read the [frontend setup guide](../../frontend/user-webpage/README.md#configuration)
for its configuration.

Starting Supabase preserves existing local data. This undeployed project's canonical migrations
install a fresh database. Verification creates disposable databases without changing development
data, migration records, or archives.

## Schema modules

The fresh-install baseline separates types and tables, publication and integrity rules,
application reads, access policies, and revision tracking. Final grants and the REST reload run
last. Each database object has one editable definition. SKU discovery and configuration reads
share one module; validation and publication share another.

Keep existing migration filenames and timestamp prefixes stable. Edit the authoritative module
while this baseline remains undeployed; do not retimestamp the migration set during cleanup.
Change an existing prefix only when a real dependency requires a different installation order.
New split modules must fit around those stable anchors. The table below follows execution order.

| Module | Responsibility |
| --- | --- |
| [schema_primitives](migrations/20260928123050_schema_primitives.sql) | Private schema, UUIDs, constrained types, and the common immutability guard. |
| [identity_schema](migrations/20260928123051_identity_schema.sql) | Companies, application accounts, globally unique SKUs, and immutable ownership/fee terms. |
| [financial_source_schema](migrations/20260928123052_financial_source_schema.sql) | Settlement and Data Kiosk acquisitions, version pointers, complete child inventories, and facts. |
| [archive_publications](migrations/20260928123056_archive_publications.sql) | Immutable archive validation and acquisition publication for Settlement and Data Kiosk. |
| [source_publications](migrations/20260928123102_source_publications.sql) | Atomic Settlement and Data Kiosk preprocessing publication. |
| [application_identity](migrations/20260928123104_application_identity.sql) | Caller-bound roles, exact-SKU ownership, and current assignment/fee-period views. |
| [financial_rules](migrations/20260928123106_financial_rules.sql) | Mature cutoff, fee arithmetic, source controls, and SelBox reconciliation for live and frozen inputs. |
| [financial_components](migrations/20260928123111_financial_components.sql) | Current and explicit-version company components with ownership and fees. |
| [financial_reads](migrations/20260928123113_financial_reads.sql) | Strict complete and partial financial reads with declared source coverage. |
| [payout_schema](migrations/20260928123115_payout_schema.sql) | Frozen payout headers, components, source manifests, and reconciliation records. |
| [publication_integrity](migrations/20260928123116_publication_integrity.sql) | Default RLS/access denial, source archive bucket, immutable evidence, complete-child guards, and selected-pointer integrity. |
| [payout_validation](migrations/20260928123117_payout_validation.sql) | Frozen-input integrity, coverage, provenance, and totals validation. |
| [payout_publication](migrations/20260928123119_payout_publication.sql) | Locked source capture, aggregation, and latest-report reuse. |
| [source_retention](migrations/20260928123121_source_retention.sql) | Payout-aware pruning, pin guards, and observation comparison. |
| [application_access](migrations/20260928123123_application_access.sql) | Account, financial, and payout RLS policies and authorized REST projections. |
| [payout_generation](migrations/20260928123125_payout_generation.sql) | Administrator company/month generation and maturity policy RPCs. |
| [workspace_revisions](migrations/20260928123127_workspace_revisions.sql) | Transactional financial, ownership, and company-label revision tokens and lightweight polling. |
| [transaction_read_rules](migrations/20260928123130_transaction_read_rules.sql) | Read indexes, shared filter/pagination validation, and current-policy eligibility. |
| [transaction_counts](migrations/20260928123132_transaction_counts.sql) | Exact authorized live and raw source counts. |
| [transaction_page](migrations/20260928123134_transaction_page.sql) | Bounded live row selection before ownership and fee projection. |
| [source_transaction_page](migrations/20260928123136_source_transaction_page.sql) | Bounded raw source pages retaining historical visibility. |
| [transaction_totals](migrations/20260928123138_transaction_totals.sql) | Currency/Type totals with grouping before fee lookup. |
| [sku_configuration_reads](migrations/20260928123140_sku_configuration_reads.sql) | Complete SKU discovery, caller-scoped assignment/fee reads, and coverage diagnostics. |
| [sku_configuration_publication](migrations/20260928123141_sku_configuration_publication.sql) | Immutable terms publication, complete payload validation, atomic operator batches, and stale-write checks. |
| [application_grants](migrations/20260928123142_application_grants.sql) | Final explicit table, column, and function allowlist for the entire application. |
| [rest_api_configuration](migrations/20260928123144_rest_api_configuration.sql) | Disable generated REST aggregation and issue the single final schema reload. |

## Application reads

All browser financial reads use authenticated REST/RPC with invoker security and base-table RLS.
`transaction_page` and `source_transaction_page` select filtered, authorized rows before metadata
and fee projection. `transaction_count` counts the live ledger, including authorized derived differences;
`source_transaction_count` counts raw facts independently.
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
per-row terms resolution. `skus` has one identity per exact SKU across all import namespaces.
Source namespace remains provenance, visible in administrator details, and is absent from
ownership joins, fee keys, and count indexes. RLS reads current database account and assignment state, accepts no
caller-selected identity, and retains the existing current-version/category boundaries. Page and
totals queries project terms only for their selected page or grouped facts. Existing indexes
support these lookups. The [performance guide](../../../docs/database_performance.md#authorization-and-current-versions)
explains the current authorization path and remaining inventory costs.

Date ordering reverses the complete date/source/ID tuple. Reported amount ordering is limited to
10,000 fully filtered matches, with no dedicated amount index. Marketplace names use constrained
text. Date, SKU, Type, marketplace, and ownership/version indexes support the measured access paths;
the [performance guide](../../../docs/database_performance.md) explains their tradeoffs.

The relational `live_company_components` view supports current reads, while the
explicit-version resolver supports captured inputs. Dashboard and strict reads apply
the same [source policy](../../../docs/source_allocation.md). Strict reads additionally
validate declared source coverage and ownership/fees. Raw source tabs preserve
comparison and analysis facts.

`workspace_revisions` reads the authenticated account and requested opaque source/fee tokens.
Source revisions are global; fee, ownership, and company-name revisions are company-scoped for
members and global for operators. Source-version publication, current-pointer changes, and
historical Data Kiosk pruning update source tokens atomically at commit. This covers administrator
history reads as well as current Transactions. Returned source tokens include the UTC mature cutoff date.
The browser checks them on its polling interval, focus, and reconnection, then invalidates dependent reads.
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
private.publish_settlement_acquisition(jsonb)
private.publish_data_kiosk_acquisition(jsonb)
private.publish_settlement_preprocess(jsonb)
private.publish_data_kiosk_preprocess(jsonb)
private.publish_sku_terms(jsonb)
private.publish_company_payout_report(jsonb)
```

Source and terms replacements validate the expected current reference, complete inventories, and
financial controls atomically. Published children cannot be extended or rewritten. Source imports
do not assign companies or create fee terms. Operators publish terms only through the guarded
`public.publish_sku_configuration` RPC. Its batch validation requires owners for all known SKUs
and fees for current commission-capable source dates, while preserving older incomplete terms.
`public.sku_configuration` exposes all known settings to operators and only owned settings to
members. Source publication remains trusted Python/SQL work.
Operators call `public.generate_company_payout_reports(p_company_id, p_month)` for all
scopes of one eligible company/month. It returns `(report_id uuid, created boolean)`
per scope. The trusted publisher returns one saved UUID. Both aggregate empty inputs
as zero and reuse the latest report when its scope and exact versions match. Snapshots
are created only on request. See the [payout contract](../../../docs/company_payout_reports.md),
[workflow](../../../docs/data_workflows.md), and [sync API](../../sync/README.md).

DB administrators create companies and bootstrap operators. Application accounts live
in the database; user-editable Auth metadata cannot grant access. Company members read
permitted current facts and terms plus their own saved payout headers, components,
and marketplace totals. Payout manifests and seller reconciliation are administrator-only.
The [permission matrix](../../../docs/access_control.md#permission-matrix) defines all access.

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

### Full seed configuration verification

Opt-in source verification commands live under `services.db.supabase.tests.verification`:
`configuration` and `payouts`. Each exposes `--help` without contacting services.
They share output-file validation and exclusive creation, so a seed, symlink, or existing evidence
file cannot be overwritten. Financial seed imports and source replay share the same helpers.

To verify a trusted seed matching the current global-SKU schema, run:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.tests.verification.configuration \
  --seed /path/to/seed.real.local.sql \
  --output /private/tmp/aselbox-real-configuration.json
```

This opt-in check needs the Supabase CLI, Docker, a complete SKU configuration, and at least two
fixture companies. It restores the full dump, including its Auth fixtures, into a newly created
disposable Supabase stack. It creates verification logins through actual Auth and uses their tokens
with PostgREST to check administrator and member configuration reads, global rejection and atomic
rollback, assignment and exact fee changes, denied member writes, and stale-version rejection.
Independent SQL checks verify source authority and daily reconciliation.

Test publications change only the disposable database. The verifier checks that source facts and
the supplied seed file remain unchanged, removes the temporary stack, and writes a sanitized JSON
report to a new output file; it refuses to overwrite the seed or existing evidence.
Existing development databases are untouched. It does not load the service `.env`, call
SP-API, or replay archives. The local seed's company assignments and fees are synthetic fixture
data; this check does not establish real business ownership or approved payout rates.
The [recorded fixture verification](../../../docs/evidence/global_sku_identity/configuration_seed.json)
covers 63 global SKUs, 192 fee periods, and all 103,244 retained source facts.

See the [workflow contract](../../../docs/data_workflows.md),
[live-fee contract](../../../docs/company_fees.md), and [sync commands](../../sync/README.md) for
the application workflows.
