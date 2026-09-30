# Sync service

The service downloads Amazon Settlement Reports and Data Kiosk Economics into
private archives, then preprocesses saved acquisitions into complete source
versions. PostgreSQL resolves current company ownership and fees for live
reads and freezes exact inputs and amounts when publishing a company payout report.

Inventory Planning reports use the same archive/offline boundary for approximate replenishment
information. They publish one retained capture per seller/marketplace/day, independently of
financial source versions and payouts.

All three sources use `download_*_acquisition` and `preprocess_*_acquisition` for the online and
offline phases. Acquisition persistence/loading lives in `src/database/acquisitions.py`; source
modules own parsing and result publication. Each source has an `acquisition.py` and a preprocessing
`workflow.py`. Settlement's `download_settlement_reports` is the batch discovery operation that
downloads multiple acquisitions. `current_*` helpers identify selected financial versions or the
one inventory capture; those result types retain their different publication and retention rules.

## Configuration

Run Python through the `A-SelBox` conda environment from the repository root.
The local configuration file is **`services/sync/.env`**. The service CLIs pass
this exact path to `load_dotenv()`, independently of the working directory.
They do not search parent directories for another configuration file.
Existing process environment values take
precedence; `--no-load-dotenv` uses only that environment. Do not inspect, print,
or modify `.env` directly, and never put credential values in command arguments
or diagnostic output.

- Downloads use the existing Amazon LWA client credentials and the selected
  scope's refresh-token environment variable, defined in `amazon/credentials.py`
  and `amazon/marketplaces.py`.
- Storage uses `SUPABASE_URL` (default `http://127.0.0.1:54321`) and the server-only
  `SUPABASE_SERVICE_ROLE_KEY`. Keys are read from the environment, never arguments.
- `--database-url` defaults to local PostgreSQL on port 54322. Database writers
  require trusted administrator access to the private publication functions.
- Download commands use `--seller-namespace` to identify source provenance across financial and
  inventory acquisitions. Its default is `__DEFAULT__`; use explicit stable
  namespaces for multiple sellers. Current ownership is configured by exact SKU alone,
  independently of source namespace.

Offline commands obtain the seller from the saved acquisition; they do not
accept a seller override.

The [database guide](../db/supabase/README.md) describes the private
`source-archives` Storage bucket. Source originals and generated financial output
must remain outside version control.

## Download and archive

Download discovers or queries Amazon and archives complete decoded bytes. It does
not parse TSV/JSONL, split days, classify amounts, or load companies and fees.

```sh
conda run -n A-SelBox python -m services.sync.run_download_settlement_reports \
  --scope NA --seller-namespace seller-na

conda run -n A-SelBox python -m services.sync.run_download_data_kiosk \
  --scope NA --seller-namespace seller-na \
  --marketplace-id ATVPDKIKX0DER \
  --start-date 2026-08-01 --end-date 2026-08-31

conda run -n A-SelBox python -m services.sync.run_download_inventory \
  --scope NA --seller-namespace seller-na --marketplace-id ATVPDKIKX0DER
```

Dates are inclusive marketplace-local calendar days. Data Kiosk validates the
complete explicit window before querying; `--max-pages`, `--max-poll-attempts`,
and `--poll-interval-seconds` bound acquisition work. Use `--help` for command options.
Each successful acquisition logs its ID. Failures log diagnostics and produce
no partial successful manifest. Independently completed downloads stay available.

Inventory requests a full `GET_FBA_INVENTORY_PLANNING_DATA` report for one marketplace. It defaults
to 60 status polls ten seconds apart; `--max-poll-attempts` and `--poll-interval-seconds` adjust the
bounds. The interval may be zero through 60 seconds. Cancelled, failed, and timed-out jobs publish
no acquisition. Run the command once daily for the desired scope; no recurring scheduler is
installed. Amazon's source snapshot dates may lag the request.

Use `--report-id REPORT_ID` to resume a known Inventory Planning report without submitting another
`createReport`. The command still verifies its report type and marketplace and performs the actual
status/document requests. Reusing a report preserves its original capture day and does not imply
fresh source data.

Archives use XZ preset 2e, CRC64, and independent SHA-256 hashes and lengths for
the exact document bytes and stored object. Upload and read-back verification
precede acquisition publication. A database failure can leave an unreferenced
object for reconciliation. Every successful acquisition and archive is retained
indefinitely, including overlapping Data Kiosk responses.

Acquisition diagnostics use JSON messages in the normal Python logs (stderr for
the CLI). Capture these logs with the job's log collector. An `attempt_id` links
source identifiers, each archive's bucket/path, hashes and byte lengths, and the
publication outcome. `archive_upload_started` precedes the transfer;
`archive_verified` follows successful verification. Data Kiosk also records page,
query and document IDs as they become available. `acquisition_published` records
the returned acquisition ID only after the database transaction completes.

On failure, `acquisition_failed` records the stage, exception type, failure
location, SQLSTATE when available, and any pending upload with an unconfirmed
outcome. Verified objects are repeated as `archive_retained` at ERROR level, so
they remain identifiable with `--log-level ERROR`. Publication errors are marked
`unconfirmed`: a lost commit response does not establish whether a record exists.
Check PostgreSQL before treating an object as unreferenced. Logs exclude source
bodies, arbitrary API metadata, credentials, signed URLs and exception messages.
These logs aid diagnosis; they do not implement durable checkpoints or automatic
recovery, and an abrupt process termination may leave only the preceding events.

## Offline preprocessing

Pass a saved successful acquisition ID. These commands need PostgreSQL and
private Storage access, and make no Amazon requests:

```sh
conda run -n A-SelBox python -m services.sync.run_preprocess_settlement \
  --acquisition-id ACQUISITION_UUID

conda run -n A-SelBox python -m services.sync.run_preprocess_data_kiosk \
  --acquisition-id ACQUISITION_UUID

conda run -n A-SelBox python -m services.sync.run_preprocess_inventory \
  --acquisition-id ACQUISITION_UUID
```

Preprocessing checks archive integrity before parsing. Missing or corrupt input
fails locally. Failure preserves the acquisition and publishes no partial result.
Financial reruns use the shared `src/preprocess_version.py` definition; historical
source versions remain immutable. Bump that constant when financial source interpretation changes;
ownership and fee edits do not change it.

Inventory uses its own `INVENTORY_PREPROCESS_VERSION` (`inventory-v1`). It keeps exact SKU text,
turns missing/unusable optional metrics into NULL with diagnostics, accepts Amazon's observed
`fc-transfer` header, and skips conflicting duplicate SKUs. A nonempty report with no usable SKUs
fails. Successful preprocessing replaces the entire original report day's capture atomically;
replaying an already published acquisition/parser pair reuses its capture ID. Earlier days and all
raw archives remain retained. Capture dates follow original report creation in the marketplace's
timezone, never preprocessing time. See the
[inventory contract](../../docs/inventory_daily_captures.md) and
[recorded verification](../../docs/evidence/inventory/README.md).

The financial definition is `v1`. Both financial sources use the same named category enum:
`SETTLEMENT`, `SELBOX`, `DATA_KIOSK`, or `ANALYSIS_ONLY`. Settlement accepts the
first three. Exact Settlement types must be registered and pass their family checks;
known retained charges explicitly use `SELBOX`. Unknown types abort the entire report.
Data Kiosk rejects unknown monetary
components and missing required amounts before publishing any day. Its explicit
analysis-only components remain available in source diagnostics and are excluded from
financial pages and totals. The [shared registry](../../docs/transaction_type_registry.md) also generates the frontend Type catalog.

Preprocessing preserves exact signed amounts and nonblank SKU text verbatim,
including surrounding whitespace. Settlement requires exact report reconciliation
and records optional trailing-field omissions and out-of-period postings as
diagnostics. Identical decoded bodies with the same scoped settlement identity
share one financial settlement, even across different API references; conflicting
bodies fail.

Tax retrocharges require reviewed complete source coverage. Supply
`--retrocharge-coverage /path/to/coverage.json` with a JSON array of complete
source-line groups, such as `[[3, 4], [8, 9, 10, 11]]`. The parser verifies group
identity, component pairing, and exact event-wide zero. A zero sum alone does not
prove coverage; incomplete or cross-report evidence requires review.

Data Kiosk verifies the pinned unfiltered DAY/MSKU query and complete page
provenance. It prepares every covered day, including empty days, before atomic
publication. Disappeared SKUs remain absent in the replacement day. An older
acquisition cannot displace a newer Amazon observation by finishing later.

See the [workflow contract](../../docs/data_workflows.md) for validation and
ordering, and the [family rules](../../docs/settlement_component_categories.md)
and [source policy](../../docs/source_allocation.md) for
classification. Pure Data Kiosk preparation lives in `data_kiosk_economics/preprocess.py`;
its database orchestration lives in `data_kiosk_economics/workflow.py`.

## Company terms and live financial reads

The trusted `src/database/company_terms.py` repository creates companies and publishes
individual immutable revisions through `private.publish_sku_terms(jsonb)`.
Its Python `publish_sku_terms()` helper accepts an exact SKU, company, complete submitted
period inventory, expected current terms version, and change reason. UUIDv7 IDs are generated
automatically. `public.skus` holds each stable SKU identity and its
current terms reference; immutable `public.sku_terms_versions` records the company
assignment, and `public.sku_fee_periods` holds that version's marketplace periods.

An explicit `company_id=None` publishes an unassigned version while preserving
the identity and history. There is no stored Default company. Periods use
nonoverlapping `[start, end)` ranges within each marketplace. An empty replacement
withdraws all fee coverage; an omitted marketplace loses its prior coverage, and
a 0% period is explicit valid coverage. Publication rejects stale edits.
`public.company_skus` and `public.current_sku_fee_periods` expose the selected
assigned terms. Source imports do not register or assign SKUs or create fees.

Application operators use `public.publish_sku_configuration` to publish a nonempty batch of
staged revisions atomically. That guarded API additionally requires ownership for every known
SKU and coverage of applicable dates in selected source versions. The trusted Python helper
supports internal revision publication and source-independent setup; it is not the
administrator application's write interface.
`public.app_accounts` records operator/member access; company members see only
their assigned company's current terms and source results. See the
[application-access contract](../../docs/access_control.md) for account management
and the REST payload.

`src/database/financial_reads.py` reads strict company totals for explicitly
selected canonical settlements, a required `PREPROCESS_VERSION`, and inclusive
marketplace/day coverage. It preserves exact decimal values and separate
currencies. Missing source versions, ownership, fee coverage, or component
mappings raise instead of producing incomplete totals. Company-facing views and
privileged diagnostics are documented in the database guide.

`load_company_financial_progress()` permits missing fees while preserving complete
source coverage and ownership checks. It returns known fee/company sums together
with every missing-fee component; fully unknown sums remain NULL. See the
[partial-summary contract](../../docs/company_fees.md#partial-live-summaries).

Live fees use signed Settlement product principal and refunds at each row's own
posting-date rate for mature dates; recent dates use Data Kiosk net product sales.
Data Kiosk amounts in the Data Kiosk category remain authoritative at every age and have no
sales commission. For mature dates, Settlement report amounts in the SelBox category
and the difference between the sources in the Data Kiosk category remain with SelBox. Company and
fee corrections immediately affect live reads. The refund formula still has the
[refund commission risk](../../docs/known_issues.md#deferred-refund-commission-over-credit-risk).

## Saved company payout reports

The trusted Python API in `src/database/payout_reports.py` publishes one known
company/seller/currency scope. Call `publish_company_payout_report()` with inclusive
dates spanning one complete calendar month, a preprocessor version, explicit Settlement
IDs and required marketplaces, a report name, and a change reason. The dataset defaults
to `economics`. The database selects current versions, validates inputs, and calculates
all amounts; callers never supply calculated totals.

The publisher returns the saved report UUID. It reuses the latest report when its scope
and exact input versions match. An explicit request is required to create any snapshot;
downloads, preprocessing, and terms publication never create one automatically.

`load_company_payout_report()` and `load_company_payout_report_components()` read frozen
values without recalculating current inputs. The header reader also supports the
all-null seller/currency/preprocessor shape produced by company/month generation when
no currency scope is known. Those totals are zero.

Administrators use the UI or `public.generate_company_payout_reports` to generate all
scopes for one company/month. See the [payout contract](../../docs/company_payout_reports.md)
for maturity, coverage, empty aggregates, reuse, access, and retention. Saving a report
does not approve or execute payment.

## Verification

```sh
conda run -n A-SelBox python -m unittest discover -s services/sync/tests/unit -t .
conda run -n A-SelBox python -m services.sync.src.transaction_types.generate --check
conda run -n A-SelBox python -m unittest services.db.supabase.tests.test_archive_to_live
conda run -n A-SelBox ruff format --check .
conda run -n A-SelBox ruff check .
```

Run Pyright with the conda interpreter explicitly if its automatic discovery
selects another environment:

```sh
conda run -n A-SelBox python -c 'import sys; print(sys.executable)'
conda run -n A-SelBox pyright --pythonpath /path/printed/above
```

The database test suite constructs the fresh baseline and exercises publication,
retention, concurrency, and company access locally. See the database guide for
its commands. Unit tests use synthetic inputs and mocked transfers.

For real local Auth, Storage, and PostgREST verification, run the separate,
opt-in end-to-end suite:

```sh
conda run -n A-SelBox python -m unittest discover -s services/db/supabase/tests/e2e -v
```

It requires the Supabase CLI and a local Docker Unix socket. The harness starts
a fresh disposable stack with a copied baseline and loopback ports; the first
startup may pull Docker images. It uses synthetic Amazon data, does not load
`.env` or use cloud/production databases, and removes its stack afterward. See
the [database guide](../db/supabase/README.md#verification) for scope and isolation.

See [verification scope](../../docs/known_issues.md#deployment-and-verification-scope)
for the boundaries of these checks. Publication and retention concurrency are
covered by database tests. The [known issues](../../docs/known_issues.md) also
document the restrictions on changing Storage visibility or process-global
routing configuration during use.
