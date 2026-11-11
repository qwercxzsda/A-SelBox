# Supabase database

PostgreSQL 17 schema for immutable archived Finances/Data Kiosk inputs, versioned company/SKU
terms, live financial reads, and frozen payout reports. The migrations form a fresh-install baseline
with one current definition per object.

- [Schema](../../../docs/database_schema.md): tables, relationships, publication, and history.
- [Application access](../../../docs/access_control.md): account roles, grants, RLS, and administration.
- [Query contracts](../../../docs/transaction_query_contracts.md): exact page/count/summary/filter APIs.
- [Performance](../../../docs/database_performance.md): current access paths, measurements, and scaling limits.
- [Company fees](../../../docs/company_fees.md): current ownership, signed fees, and missing configuration.
- [Payout reports](../../../docs/company_payout_reports.md): monthly generation, snapshots, and reuse.
- [Financial review](../../../docs/financial_review.md): current source comparisons and saved report diagnostics.

## Local setup

From the repository root:

```sh
supabase start --workdir services/db
```

The default API and Storage URL is `http://127.0.0.1:54321`; PostgreSQL uses port 54322. Additional
local stacks can use different ports. The frontend must use the explicit public API URL for the
intended stack, as described in the [frontend setup guide](../../frontend/user-webpage/README.md#configuration).

Local analytics is disabled in `config.toml`; the application does not use Logflare. This avoids
keeping a second database copy of development logs. Source archives and preprocessing logs are
independent of that service.

Starting Supabase preserves existing local data. This undeployed project's canonical migrations
install a fresh database. Verification creates disposable databases without changing development
data, migration records, or archives.

## Schema modules

The fresh-install baseline separates types and tables, publication and integrity rules,
application reads, access policies, and revision tracking. Final grants and the REST reload run
last. Inventory shares integrity, access, and revision modules with the financial
sources, while keeping its own daily-capture tables. Each database object has one editable
definition. SKU discovery and configuration reads share one module; validation and publication
share another.

The [responsibility contract](../../../README.md#responsibility-boundaries) keeps source
interpretation in preprocessing and presentation in the frontend. Inventory stores constrained
health/recommendation source values. Its read views select authorized latest facts without UI
ranks, colors, or option catalogs. Payout headers store dates and audit provenance; the browser
derives their display names. All source archive, page, and complete-day validation runs in Python.
Typed Python repositories drive source writes; database constraints, locks, and deferred guards
protect their atomicity and relational integrity. SQL does not repeat JSON manifest validation.

The migrations define a fresh installation of the financial source models, with no upgrade or
conversion path for existing deployments. Verification installs these definitions only in
disposable databases.

The module review separates deliberate database safeguards from source validation. Column
constraints and deferred cross-row checks protect stored facts. Public write RPCs validate
untrusted client commands and authorize each mutation. Read queries use persisted source
classification and return facts; browser code owns labels, status presentation, and display order.
Private financial readers validate their scalar request contract in Python and use SQL only for
current-source relationships, coverage, and aggregation.

Frontend database writes use four narrow RPCs: `create_company`, `delete_company`,
`set_company_membership`, and `publish_sku_configuration`. These handlers authorize callers,
validate the allowed request shape, and perform atomic changes with stale-write protection.
Column types, foreign keys, `CHECK`, and exclusion constraints enforce field values. The SKU
endpoint replaces complete ownership/fee terms; it does not expose a generic table-write API.

| Module                                                                                       | Responsibility                                                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [schema_primitives](migrations/20260928123050_schema_primitives.sql)                         | Private schema, UUIDs, constrained types, and the common immutability guard.                                                 |
| [identity_schema](migrations/20260928123051_identity_schema.sql)                             | Companies, application accounts, globally unique SKUs, and immutable ownership/fee terms.                                    |
| [financial_source_schema](migrations/20260928123052_financial_source_schema.sql)             | Six tables per financial source: stable identities, reusable immutable versions/components and exact successful batch membership. |
| [inventory_schema](migrations/20260928123055_inventory_schema.sql)                           | Daily inventory acquisitions, captures, items, constraints, and indexes.                                                     |
| [application_identity](migrations/20260928123104_application_identity.sql)                   | Caller-bound roles, exact-SKU ownership, and current assignment/fee-period views.                                            |
| [financial_rules](migrations/20260928123106_financial_rules.sql)                             | Mature cutoff, account visibility, and service-fee arithmetic.                        |
| [financial_components](migrations/20260928123111_financial_components.sql)                   | Current and explicit-version company components with ownership and fees.                                                     |
| [financial_reads](migrations/20260928123113_financial_reads.sql)                             | Relational selected-version and coverage checks for strict/partial totals; Python validates trusted request values.                                                   |
| [payout_schema](migrations/20260928123115_payout_schema.sql)                                 | Frozen payout headers, exact source/terms version manifests, derived records, and refresh state.                        |
| [publication_integrity](migrations/20260928123116_publication_integrity.sql)                 | Default RLS/access denial, source archive bucket, immutable evidence, complete-child guards, and selected-pointer integrity. |
| [payout_validation](migrations/20260928123117_payout_validation.sql)                         | Frozen-input integrity, coverage, provenance, and one shared report aggregate used by publication and integrity checks.                                                         |
| [payout_publication](migrations/20260928123119_payout_publication.sql)                       | Locked source capture across namespaces, company/marketplace/currency aggregation, and latest-report reuse.                  |
| [application_access](migrations/20260928123123_application_access.sql)                       | Account, financial, payout, and inventory RLS policies and authorized REST projections.                                      |
| [payout_generation](migrations/20260928123125_payout_generation.sql)                         | Atomic company/month generation, maturity policy, bounded operational facts, and administrator setup diagnostics.                    |
| [payout_refresh](migrations/20260928123126_payout_refresh.sql)                               | Pending requests, maturity discovery, processing, constrained failure codes, and retry backoff.                                        |
| [workspace_revisions](migrations/20260928123127_workspace_revisions.sql)                     | Transactional financial, inventory, ownership, company-label, and payout revision tokens and lightweight polling.            |
| [payout_invalidation](migrations/20260928123128_payout_invalidation.sql)                     | Transactional requests after source or terms changes and scope expansion.                                                    |
| [transaction_read_rules](migrations/20260928123130_transaction_read_rules.sql)               | Local-day/UTC-instant indexes, structural filter/page validation, and current-policy eligibility; source catalogs stay outside query validation.                                           |
| [transaction_counts](migrations/20260928123132_transaction_counts.sql)                       | Exact authorized live and raw source counts.                                                                                 |
| [transaction_page](migrations/20260928123134_transaction_page.sql)                           | Bounded live row selection before ownership and fee projection.                                                              |
| [source_transaction_page](migrations/20260928123136_source_transaction_page.sql)             | Bounded raw source pages, exact row/version detail, and indexed native transaction lookup retaining historical visibility.   |
| [transaction_totals](migrations/20260928123138_transaction_totals.sql)                       | UTC marketplace/currency totals and Type breakdowns.                                    |
| [payout_schedule](migrations/20260928123139_payout_schedule.sql)                             | Five-minute pg_cron registration in the configured scheduler database.                                                       |
| [sku_configuration_reads](migrations/20260928123140_sku_configuration_reads.sql)             | Complete SKU discovery, caller-scoped assignment/fee reads, and coverage diagnostics.                                        |
| [sku_configuration_publication](migrations/20260928123141_sku_configuration_publication.sql) | Narrow administrator command with closed payload shape, immutable terms publication, constraints, atomicity, and stale-write checks.              |
| [application_grants](migrations/20260928123142_application_grants.sql)                       | Final explicit table, column, and function allowlist for the entire application.                                             |
| [rest_api_configuration](migrations/20260928123144_rest_api_configuration.sql)               | Disable generated REST aggregation and issue the single final schema reload.                                                 |

## Application reads

All browser financial reads use authenticated REST/RPC with invoker security and base-table RLS.
`transaction_page` and `source_transaction_page` select filtered, authorized rows before metadata
and fee projection. `transaction_count` counts current authoritative source components;
`source_transaction_count` counts raw facts independently.
`transaction_totals` includes only Finances-category activity and Data Kiosk costs, combining
compatible facts before fee lookup. Its record drilldowns set `p_include_selbox=false`; the main
transaction list keeps SelBox activity. Administrator identity bootstrap
preloads `sku_filter_options`, including unregistered, unassigned, historical, and registered-only
SKUs in one request. The no-argument RPC derives distinct names once per load rather than once per
cursor page. Members reuse their current assignments. Source, Marketplace, and Type menus
use static catalogs. The frontend resolves table search to exact OR sets; Currency is not searchable.
General REST aggregates are disabled. See the
[query contracts](../../../docs/transaction_query_contracts.md) for parameters and numeric formats.

Administrator catalog discovery uses the existing SKU/date indexes to seek between distinct source
SKU values, avoiding repeated transaction entries. The RPC checks the stored administrator
role before discovery and rejects other callers with SQLSTATE `42501`. It includes the registry,
returns exact strings in `C` order, and retains invoker security. Member filters use loaded
assignments and make no discovery request.

Ownership RLS uses the private caller-bound `current_owned_sku_terms()` set rather than repeated
per-row terms resolution. `skus` has one identity per exact SKU across all import namespaces.
Source namespace remains provenance, visible in administrator details, and is absent from
ownership joins, fee keys, and count indexes. RLS reads current database account and assignment state, accepts no
caller-selected identity, and retains the existing current-version/category boundaries. Page and
totals queries project terms only for their selected page or grouped facts. Existing indexes
support these lookups. The [performance guide](../../../docs/database_performance.md#authorization-and-current-versions)
explains the current authorization path and remaining inventory costs.

Transactions date ordering reverses the complete UTC instant/source/ID tuple. Finances uses its posting instant; Data Kiosk preprocessing stores the last microsecond of its local day on each immutable day version. Source dates still govern fees and payout months. Reported amount ordering is limited to
10,000 fully filtered matches, with no dedicated amount index. Marketplace names use constrained
text. Date, SKU, Type, marketplace, and ownership/version indexes support the measured access paths;
the [performance guide](../../../docs/database_performance.md) explains their tradeoffs.

The relational `live_company_components` view supports current reads, while the
explicit-version resolver supports captured inputs. Dashboard and strict reads apply
the same [source policy](../../../docs/source_allocation.md). Strict reads additionally
validate declared source coverage and ownership/fees. Administrator-only raw source tabs preserve
comparison and analysis facts; public source pages/counts reject members and source-entry views
return no member rows. Transactions and its direct live view contain only authoritative categories.

Inventory transport pages return complete authorized latest facts. The browser assembles and
caches them, then applies inventory search, filters, display priorities, and pagination locally.
Fixed health/recommendation options never require a database request. Financial page/count RPCs
remain appropriate for large factual queries; their ordering does not prescribe UI labels or colors.

`workspace_revisions` reads the authenticated account and requested opaque tokens from the small
`workspace_revision_tokens` table, without scanning source facts or inventory captures. Financial
source and inventory revisions are global; fee, ownership, company-name, and payout revisions are
company-scoped for members and global for administrators. Source-version publication, current-pointer
changes and successful Finance/Data Kiosk batch membership update financial source tokens atomically at commit.
This covers administrator history reads as well as current Transactions. Changed daily inventory
captures rotate the separate `inventory` token in the publication transaction; raw acquisitions,
idempotent replays, and rolled-back publications do not. New payout headers rotate `payouts` tokens
for their company and the global administrator scope; refresh-state changes rotate the same token
so a blocked attempt is visible even without a report. Unchanged report reuse does not rotate it
unless refresh state changes. Financial
source tokens are independent of date and payout maturity. The browser checks relevant tokens on its polling interval, focus, and
reconnection, then invalidates dependent reads when a token changes. Unchanged inventory and
ownership tokens retain successful cached inventory reads; failed reads can retry. The
[frontend lifecycle](../../frontend/user-webpage/README.md#requests-and-session-lifecycle) defines
cache behavior.

## Archives and publication

The private `source-archives` Storage bucket retains content-addressed XZ archives indefinitely.
The archive service receives `SUPABASE_SERVICE_ROLE_KEY` through its process environment; application
administrators and members cannot read those archives. Storage uploads finish before PostgreSQL
publication and do not share its transaction. A failed metadata publication may leave an orphaned
upload for reconciliation.

Finance downloads retain local acquisition manifests. Python performs all Finance source checks, then
inserts acquisition metadata, a successful preprocessing batch, new transaction versions/components
and exact membership, and switches current pointers in one transaction. Failed preprocessing writes
local logs only. Parent metadata is normalized; raw transaction JSON stays in archived pages.

Data Kiosk and Inventory repositories likewise use typed models and direct SQL writes within
Python-managed transactions. Acquisition retries lock their natural identity and reuse unchanged
metadata. Data Kiosk day writes lock identities in date order, preserve exact batch membership,
reuse unchanged versions, and switch current pointers by observation order. Inventory locks one
source/day and replaces its complete capture atomically. No source publisher parses JSON in SQL.

Configuration and payout commands use these private functions:

```text
private.publish_sku_terms(jsonb)
private.publish_company_payout_report(jsonb)
```

Source validation runs in Python; the database enforces structural references and immutable
inventories. Source imports do
not assign companies or create fees. Administrators publish configuration through
`public.publish_sku_configuration`; its validation and authorization are defined in the
[company-fee](../../../docs/company_fees.md) and [access](../../../docs/access_control.md) contracts.

The private payout worker registers in `cron.database_name`, normally `postgres`. Auxiliary test
databases install the worker without a schedule. It processes pending mature company months and
stores retry state in `payout_report_refresh_state`. Application users cannot invoke the worker or
read raw errors. The [payout contract](../../../docs/company_payout_reports.md) owns generation,
locking, reuse and scheduler operations; the [permission matrix](../../../docs/access_control.md#permission-matrix)
owns report and source visibility.

## Immutable source contents and observation history

Both financial sources retain immutable versions and record each successful batch's exact
membership. Current identities select a version and its observing batch. Payout manifests reference
normalized transaction/day versions directly and preserve validated coverage intervals. The
[data workflow](../../../docs/data_workflows.md)
defines version reuse, empty coverage, source-detail archives and permanent history. The
[Finances contract](../../../docs/finances_transactions.md) defines transaction lifecycle and Summary
validation; the [payout contract](../../../docs/company_payout_reports.md) defines input selection.

Publication and payout capture use `READ COMMITTED` and coordinate through the payout-input guard.
Data Kiosk locks day identities in stable order; Finance locks seller/credential scope. Current
pointers, new immutable contents and batch membership commit together. Acquisition downloads do
not select financial source versions.

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
capture, and reusable-version publication. Live-view regressions compare all 24 output columns against the
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

### Source verification commands

Opt-in source verification commands live under `services.db.supabase.tests.verification`:
`configuration` and `inventory`. Each exposes `--help` without contacting services.
They share output-file validation and exclusive creation, so a seed, symlink, or existing evidence
file cannot be overwritten. Current-schema seed checks and live inventory verification exercise different contracts.
Historical Finance replay tooling is removed; normal preprocessing uses the local manifest API.

#### Full seed configuration verification

To verify a trusted seed matching the current global-SKU schema, run:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.tests.verification.configuration \
  --seed /path/to/seed.real.local.sql \
  --output /private/tmp/aselbox-real-configuration.json
```

This opt-in check needs the Supabase CLI, Docker, a complete SKU configuration, and at least two
fixture companies. It restores the full dump, including its Auth fixtures, into a newly created
disposable Supabase stack. It creates verification logins through actual Auth and uses their tokens
with PostgREST to check administrator and member configuration reads, changed-SKU rejection and atomic
rollback, assignment and exact fee changes, denied member writes, and stale-version rejection.
Independent SQL checks verify source authority and frozen company amounts.

Test publications change only the disposable database. The verifier checks that source facts and
the supplied seed file remain unchanged, removes the temporary stack, and writes a sanitized JSON
report to a new output file; it refuses to overwrite the seed or existing evidence.
Existing development databases are untouched. It does not load the service `.env`, call
SP-API, or replay archives. The local seed's company assignments and fees are synthetic fixture
data; this check does not establish real business ownership or approved payout rates.
Use a newly generated Finances seed for this baseline. Dumps from an earlier schema are not
compatible inputs. The [verification evidence index](../../../docs/evidence/README.md) identifies
the dates and scope of the recorded checks.

#### Live inventory verification

From the repository root, using Amazon access in the service dotenv and Docker:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.tests.verification.inventory \
  --env-file services/sync/.env \
  --private-output output/real-inventory-review \
  --output output/real-inventory-review/new-evidence.json
```

For Japan, add `--scope JAPAN --marketplace-id A1VC38T7YXB528`. To use an already completed report,
add `--report-reference <private-getReport-response.json>`. Its ID is read in memory; the report and
document still come from Amazon. Choose a new evidence JSON path for each run.

The verifier uses a disposable database and supplies ephemeral browser credentials through standard
input. It never loads application DB/storage endpoints from the service dotenv and never prints
source rows or vendor error bodies. Raw documents and screenshots belong in private, gitignored
output directories. [Recorded inventory checks](../../../docs/evidence/inventory/README.md) describe
the source observations and UI results from their stated dates.

See the [workflow contract](../../../docs/data_workflows.md),
[live-fee contract](../../../docs/company_fees.md), and [sync commands](../../sync/README.md) for
the application workflows.
