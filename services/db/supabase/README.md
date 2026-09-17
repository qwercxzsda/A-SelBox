# Supabase database

Fresh-install PostgreSQL 17 schema for immutable archived Settlement/Data Kiosk
inputs, versioned company/SKU terms, live financial reads, and frozen payout
reports. There is no deployed-schema upgrade or backfill path.

## Local setup

From the repository root:

```sh
supabase start --workdir services/db
```

API and Storage use `http://127.0.0.1:54321`; PostgreSQL uses port 54322.
Rebuilding an existing development database requires
`supabase db reset --local --workdir services/db` and discards its contents.
The verification commands below use disposable databases instead.

The baseline has five modules:

- `20260912072531_live_source_versions.sql`: types, seller/SKU terms, source records,
  complete-version headers, constraints, indexes, and the private archive bucket.
- `20260912072703_atomic_publications.sql`: archive/source/fee publication,
  immutable inventories, current references, and payout-aware pruning.
- `20260912072704_live_company_reads.sql`: current category views, fee
  calculations, strict totals, and observation comparison.
- `20260914062544_company_payout_reports.sql`: immutable reports, saved components,
  typed source/terms manifests, and publication validation.
- `20260914094640_application_access.sql`: operator/member roles, RLS, member
  administration, guarded REST terms publication, and historical result reads.

There is no seed history. DB administrators create companies and bootstrap
operator accounts through trusted SQL. Complete seller/SKU terms can be published
through Python/SQL or the guarded operator REST RPC. A revision
selects a company or explicit unassignment and the full fee inventory across
marketplaces. Source imports do not register or assign SKUs. UUIDv7 IDs and audit timestamps are generated
when omitted; audit timestamps do not choose current financial results.

## Archives and publication

The private `source-archives` Storage bucket retains complete decoded documents
under immutable content-addressed `.xz` keys. The service checks that the bucket
is private and uses `SUPABASE_SERVICE_ROLE_KEY` from its process environment.
Operators and company members have no archive access. XZ settings are `FORMAT_XZ`, preset
`2 | PRESET_EXTREME`, and `CHECK_CRC64`.

Successful acquisition manifests retain document/archive digests and lengths,
compression declarations, API provenance, query coverage, and ordered complete
page inventories. They exclude compressed bytes and temporary signed URLs.
Archives and successful acquisitions are retained indefinitely.

Storage uploads cannot participate in a PostgreSQL transaction. Upload and
verification finish before a successful acquisition is published; a database
failure may leave an orphaned upload available for retry or reconciliation.

The private JSON publication functions return UUIDs:

```text
publish_settlement_acquisition(jsonb)
publish_data_kiosk_acquisition(jsonb)
publish_settlement_preprocess(jsonb)
publish_data_kiosk_preprocess(jsonb)
publish_sku_terms(jsonb)
publish_company_payout_report(jsonb)
```

The Python repositories publish each complete payload in one transaction.
Source and fee replacements check the expected current reference; stale or
incomplete writes roll back. Published child sets cannot be extended or rewritten.
These private publishers are restricted to trusted database writers, independently
of Storage service-role access. Operators reach terms publication only through
the caller-checked public RPC. Python validates and normalizes archived inputs;
the database enforces ownership, inventory, amount, category, and current-version
constraints at publication.

## Source model

Both preprocessors publish `PREPROCESS_VERSION = "v0"`. Each result retains its
version name; combining required inputs with different names fails. Source facts
contain no copied company, applied rate, or derived company fee.

Each source fact stores one required `public.allocation_category`:
`SETTLEMENT`, `SELBOX`, `DATA_KIOSK`, or `ANALYSIS_ONLY`. Settlement permits the
first three; Data Kiosk permits all four. Every fact requires a monetary amount.
Unknown or incomplete Data Kiosk components fail preprocessing before any day
is published, preserving archived inputs and current results for review.

Settlement `SETTLEMENT` facts require SKU. Recognized Settlement account families
use `SELBOX` and require blank SKU; unmatched `SELBOX` rows preserve any raw SKU.
Data Kiosk `DATA_KIOSK` facts require SKU and `SELBOX` facts require blank SKU.
Marketplace names use `public.amazon_marketplace_name`, including distinct
`Non-Amazon US`; Amazon API IDs remain acquisition provenance.

Report aliases sharing seller, Amazon scope, TSV settlement ID, and decoded bytes
share one canonical settlement. Conflicting bytes fail preprocessing while the
archives remain retained. Data Kiosk source freshness uses root query creation
time and acquisition UUID. Reprocessing older archives cannot advance the source
observation. Complete empty days replace previous facts; unqueried days stay intact.

## Live calculations and access

The current source category views are:

- Settlement: `settlement_sku_entries`, `settlement_account_entries`,
  `settlement_others_entries`.
- Data Kiosk: `data_kiosk_sku_entries`, `data_kiosk_account_entries`,
  `data_kiosk_others_entries`.

Each resolves one complete current version with no rolling date window.
`ANALYSIS_ONLY` remains available in diagnostic reads outside these category views.
`public.live_company_components` joins source facts to selected seller/SKU
terms, exposes source/fee references, and identifies
which components are authoritative. Company totals include Settlement
`SETTLEMENT` and Data Kiosk `DATA_KIOSK` facts. Other categories do not contribute.

`seller_skus` stores stable identity and the selected terms pointer;
`sku_terms_versions` stores nullable company assignment and complete revision
inventories; `sku_fee_periods` stores marketplace/date rates. `company_skus` and
`current_sku_fee_periods` are current projection views. Reassignment restates all
live history; explicit unassignment preserves identity and version history.

Terms contain nonoverlapping `[start, end)` periods per marketplace with an
optional unbounded end. Exact percentages range from 0 through 100 with at most
six fractional digits; excess precision is rejected without rounding. Empty
inventories withdraw coverage. Historical periods do not become active again.

Fee calculations preserve `MISSING_OWNERSHIP` and `MISSING_FEE` diagnostics.
Source constraints already require the dates and marketplaces used by fees.
`APPLIED` includes explicit zero rates;
`NOT_APPLICABLE` identifies noncommission components. Required unresolved amounts
remain null rather than being ignored in a complete total.

Privileged totals require an explicit source scope:

```text
private.company_financial_totals(
  seller_namespace, start_date, end_date, preprocess_version,
  settlement_ids uuid[], marketplaces amazon_marketplace_name[], dataset_key
)
```

Dates are inclusive. Every declared settlement and marketplace/day must have a
compatible current result. Missing required ownership, fees, or source coverage
raises an error. Currencies remain separate, and the Python financial reader
preserves SQL aggregates as exact `Decimal` values.

`private.company_financial_progress(...)` accepts the same scope, permits missing
fees, and returns known sums plus missing-fee details. Source coverage and
ownership remain required. See the
[partial-summary contract](../../../docs/company_fees.md#partial-live-summaries).

All application tables enable RLS. `public.app_accounts` holds one row per
authorized Auth user: `operator` with no company, or `company_member` with one
required company. Operators list all application accounts and add/remove members
or change their company through REST. Only the DB administrator manages operators;
Auth identities are not created or deleted by application-access changes.

Public views use `security_invoker = true`. Company members see their permitted
current source facts and selected fee terms; raw-table RLS also excludes historical
versions. Operators see all retained source/terms history and publish complete terms
through `public.publish_sku_terms(...)`. Full historical preprocessing metadata
uses guarded operator-only read functions behind public views, preserving narrow
member grants on source headers. Archives and privileged completeness functions
remain unavailable through application REST access.

See the [application-access contract](../../../docs/access_control.md) for the
permission matrix, account lifecycle, bootstrap SQL, and exact REST endpoints.

## Frozen payout reports

`private.publish_company_payout_report(jsonb)` captures current source and terms
versions for an explicit scope and saves exact report totals and components.
It rejects unresolved authoritative rows before selecting the requested company
and currency. Typed private manifests retain every required source version,
including empty Data Kiosk days, and all authoritative scoped SKU terms needed
to explain inclusion and exclusion. Later live changes cannot rewrite a report.

Report/component RLS requires an operator. Company members cannot read saved
payouts, including their own company's reports. Operators can also read complete
input manifests through public invoker-security views. See the
[payout report API and guarantees](../../../docs/company_payout_reports.md).
Operator REST reads allow `select=*`, including all source/terms inventory counts.
The trusted Python repository retains full access and is the payout publication
interface; application operators cannot publish reports.
Approval, payment execution, currency rounding, and the refund commission
over-credit policy are not implemented by report publication.

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

Comparison uses the latest three independent observations with compatible
preprocessing and their normalized-content digests. Missing or pruned comparable
results are unavailable. Equal observations do not establish financial finality.

Explicit pruning retains at least three independent observations per day, every
current version, and every payout-referenced version. It deletes eligible fact payloads
while retaining original counts and audit identities. Acquisitions, document
inventories, and archives remain intact. Increasing retention does not restore
pruned payloads; archived inputs can be reprocessed explicitly.

Source publication, payout capture, and pruning acquire day locks in stable
natural identity order. Report dependency inserts validate retained evidence
under the same day lock. Report capture and pruning require `READ COMMITTED`.
Report dependencies are immutable; there is no independent pin/unpin API.
Reprocessing pruned evidence creates a new version. Python does not automatically
retry stale publication failures.

## Verification

With local Supabase running:

```sh
conda run -n A-SelBox python -m services.db.supabase.tests.run_schema_contract
conda run -n A-SelBox python -m unittest discover -s services/db/supabase/tests
```

The loopback-only harness creates disposable databases with minimal Auth/Storage
interfaces, installs the baseline, and drops each database afterward. It never
rebuilds existing development schemas or changes their migration records and
archives. Tests cover complete publication and rollback, real XZ parsing through
repositories, fee corrections, empty days, source ordering, exact filtered tenant
totals, cross-company access, frozen reports, and concurrent publication,
payout capture, and pruning.
These PostgreSQL checks do not exercise hosted Storage or SP-API transport.

Run the separate, opt-in end-to-end suite from the repository root:

```sh
conda run -n A-SelBox python -m unittest discover -s services/db/supabase/tests/e2e -v
```

This suite requires the Supabase CLI and Docker running through a local Unix
socket. It creates a fresh disposable Supabase stack with a copied baseline,
an independent project ID, and allocated local ports, then removes it after
the run. Test clients use validated loopback URLs. The first startup may need
to pull Docker images. It does not load
`.env`, use cloud credentials, or contact production databases; existing local
development data is left intact.

The workflow uses synthetic Amazon documents with real Storage uploads and
downloads, acquisition publication, preprocessing, Auth-issued user tokens,
and company reads through PostgREST. Amazon transport remains synthetic, so
this suite does not establish live SP-API or production deployment readiness.

See the [workflow contract](../../../docs/data_workflows.md),
[live-fee contract](../../../docs/company_fees.md), and
[sync commands](../../sync/README.md) for the application workflows.
