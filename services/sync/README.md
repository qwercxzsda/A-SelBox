# Sync service

The service downloads Amazon Settlement Reports and Data Kiosk Economics into
private archives, then preprocesses saved acquisitions into complete source
versions. PostgreSQL resolves current company ownership and fees for live
reads and freezes exact inputs and amounts when publishing a company payout report.

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
- Download commands use `--seller-namespace` to identify the seller across both sources
  and ownership configuration. Its default is `__DEFAULT__`; use explicit stable
  namespaces for multiple sellers.

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
```

Dates are inclusive marketplace-local calendar days. Data Kiosk validates the
complete explicit window before querying; `--max-pages`, `--max-poll-attempts`,
and `--poll-interval-seconds` bound acquisition work. Use `--help` for command options.
Each successful acquisition logs its ID. Failures log diagnostics and produce
no partial successful manifest. Independently completed downloads stay available.

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
conda run -n A-SelBox python -m services.sync.run_preprocess_settlement_report \
  --acquisition-id ACQUISITION_UUID

conda run -n A-SelBox python -m services.sync.run_preprocess_data_kiosk \
  --acquisition-id ACQUISITION_UUID
```

Preprocessing checks archive integrity before parsing. Missing or corrupt input
fails locally. Failure preserves the acquisition and publishes no partial source
version. Reruns use the shared `src/preprocess_version.py` definition; historical
source versions remain immutable. Bump that constant when source interpretation changes;
ownership and fee edits do not change it.

The current definition is `v1`. Both sources use the same named category enum:
`SETTLEMENT`, `SELBOX`, `DATA_KIOSK`, or `ANALYSIS_ONLY`. Settlement accepts the
first three. Exact Settlement types must be registered and pass their family checks;
known retained charges explicitly use `SELBOX`. Unknown types abort the entire report.
Data Kiosk rejects unknown monetary
components and missing required amounts before publishing any day. Its explicit
analysis-only components remain outside strict financial totals and remain available
in dashboard estimates. The [shared registry](../../docs/transaction_type_registry.md) also generates the frontend Type catalog.

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

Use `src/database/company_terms.py` to create companies and call
`publish_sku_terms()` with a company, complete fee periods for all marketplaces,
the expected current terms version, and a change reason. UUIDv7 IDs are generated
automatically. `public.seller_skus` holds each stable seller/SKU identity and its
current terms reference; immutable `public.sku_terms_versions` records the company
assignment, and `public.sku_fee_periods` holds that version's marketplace periods.

An explicit `company_id=None` publishes an unassigned version while preserving
the identity and history. There is no stored Default company. Periods use
nonoverlapping `[start, end)` ranges within each marketplace. An empty replacement
withdraws all fee coverage; an omitted marketplace loses its prior coverage, and
a 0% period is explicit valid coverage. Publication rejects stale edits.
`public.company_skus` and `public.current_sku_fee_periods` expose the selected
assigned terms. Source imports do not register or assign SKUs or create fees.

Operators can publish the same complete terms through the public REST RPC.
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
posting-date rate. Data Kiosk sales analysis is separate from authoritative
Settlement sales; selected `DATA_KIOSK` costs have no commission rate. Company and
fee corrections immediately affect live reads. The refund formula still has the
[refund commission risk](../../docs/known_issues.md#deferred-refund-commission-over-credit-risk).

## Saved company payout reports

Use `src/database/payout_reports.py` to call `publish_company_payout_report()`
with one company, seller and currency; inclusive dates; an exact preprocessor
version; explicit settlement IDs and required marketplaces; a report name; and
a change reason. The default dataset is `economics`. This is an administrator
publication API, not a download or preprocessing command.

The database captures current complete Settlement and Data Kiosk versions and
selected SKU terms, then validates the entire declared source scope before
filtering to the requested company and currency. Missing day coverage, unassigned
authoritative SKUs, or missing applicable rates reject the report. Callers supply
scope and descriptive metadata; the database calculates all amounts.

One transaction saves `public.company_payout_reports`, its immutable
`public.company_payout_report_components`, and private manifests of the exact
Settlement, Data Kiosk, and terms versions. Each saved component includes its
source reference, applicable terms and fee period, rate, and exact source, fee,
and company amounts. `load_company_payout_report()` and
`load_company_payout_report_components()` read saved values without recalculating
against current selections. Later source or terms publications leave them intact.

The Data Kiosk manifest includes every required day, including successful empty
days. These immutable report references protect complete versions during cleanup;
there is no separate generic pin/unpin API. Publication and retention use
READ COMMITTED transactions and coordinate through day locks. Operators read all
saved reports and input references through REST, including full header counts.
Company members have no payout access. The trusted Python header loader retains
full access; report publication remains a direct-database operation.

See the [payout report contract](../../docs/company_payout_reports.md) for schema,
capture, and retention details. Saving a report does not approve or execute a
payment. Approval, payment execution, currency rounding, and the refund commission
over-credit policy remain deferred.

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
