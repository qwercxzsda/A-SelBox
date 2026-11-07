# Sync service

The service archives Amazon Finances, Data Kiosk Economics and Inventory Planning responses, then
preprocesses those saved inputs without contacting Amazon. The [workflow contract](../../docs/data_workflows.md)
explains each source's publication and history model.

Finance downloads write a local manifest. Successful preprocessing atomically accepts acquisition
metadata, batch membership and immutable transaction versions through `src/database/finances.py`.
Data Kiosk and Inventory persist/load acquisitions through `src/database/acquisitions.py`. Each
source owns its parser and `workflow.py`; company fees and saved payouts are separate calculations.

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
- `--database-url` defaults to local PostgreSQL on port 54322 for preprocessing and the
  Data Kiosk/inventory downloaders. Finance downloading uses Storage and a local manifest only.
  Database writers require trusted administrator access; Finance publishes its validated batch
  through one Python-owned database transaction.
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
not split days, classify amounts, or load companies and fees.

```sh
conda run -n A-SelBox python -m services.sync.src.cli.download_finances \
  --scope NA --seller-namespace seller-na \
  --start-date 2026-08-01 --end-date 2026-08-31 \
  --manifest-output /private/path/finances-august.json

conda run -n A-SelBox python -m services.sync.src.cli.download_data_kiosk \
  --scope NA --seller-namespace seller-na \
  --marketplace-id ATVPDKIKX0DER \
  --start-date 2026-08-01 --end-date 2026-08-31

conda run -n A-SelBox python -m services.sync.src.cli.download_inventory \
  --scope NA --seller-namespace seller-na --marketplace-id ATVPDKIKX0DER
```

Dates are inclusive marketplace-local calendar days. Data Kiosk validates the
complete explicit window before querying; `--max-pages`, `--max-poll-attempts`,
and `--poll-interval-seconds` bound acquisition work. Use `--help` for command options.
Each complete download logs its ID. Finances writes an atomic local manifest bundle to
`--manifest-output`; it requires no database connection and refuses an existing output file.
Completed monthly captures remain in the bundle if a later month fails. Other downloaders
continue publishing their acquisition metadata to PostgreSQL. An incomplete source traversal logs diagnostics and
publishes no partial successful manifest. Independently completed downloads stay available.

Finances uses SP-API v2024-06-19 `listTransactions` and `listSummary`. It obtains the
seller's participating marketplace roster and sends unfiltered regional requests, including all
statuses and account types. Verified Non-Amazon US, DE, and IT channels retain their native identities
and marketplace-local dates. `--marketplace-id`
overrides the declared coverage roster; it does not filter the API request. Unexpected source
marketplaces fail preprocessing. Each acquisition covers at most one calendar month, finishes
pagination, and archives the exact decoded HTTP response bytes. Missing Summary access does not
discard the downloaded archives or local manifest, but prevents successful preprocessing.

For historical periods, repeat `--marketplace-id` for the complete historical roster when older
inactive marketplaces no longer appear in current participation discovery.

Only finished local days can be captured, with the final UTC boundary at least two minutes old.
The downloader rejects ranges outside its rolling two-year history bound. Amazon can lag by
48 hours and later update past transactions; a complete API response is not financial finality.
Re-fetch overlapping historical dates to observe those changes. The CLI uses explicit dates and
does not install a source-download scheduler. See the
[Finances contract](../../docs/finances_transactions.md) for capture and reconciliation rules.

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
query and document IDs as they become available. For Data Kiosk and Inventory, `acquisition_published` records the acquisition ID after database
publication. Finance instead logs local manifest completion; its database publication happens
during preprocessing.

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

Finances takes the local manifest written by its downloader. Data Kiosk and inventory take
saved acquisition IDs. These commands need PostgreSQL and private Storage access and make
no Amazon requests:

```sh
conda run -n A-SelBox python -m services.sync.src.cli.preprocess_finances \
  /private/path/finances-august.json

conda run -n A-SelBox python -m services.sync.src.cli.preprocess_data_kiosk \
  --acquisition-id ACQUISITION_UUID

conda run -n A-SelBox python -m services.sync.src.cli.preprocess_inventory \
  --acquisition-id ACQUISITION_UUID
```

Preprocessing checks archive integrity before parsing. Missing or corrupt input fails locally.
Finance preprocessing also validates the complete proposed transaction state against accepted
state and independent Summary controls under a seller/scope lock. Missing previously accepted
transactions, stale captures, or failed controls roll back the whole batch. Acquisitions and
preprocessing batches enter PostgreSQL together only after successful validation; failed attempts
remain in local logs and their downloaded archives/manifests. Data Kiosk and inventory retain
their saved acquisition metadata when preprocessing fails.
Financial reruns use the shared `src/preprocess_version.py` definition; historical
source versions remain immutable. Bump that constant when financial source interpretation changes;
ownership and fee edits do not change it.

Inventory uses `INVENTORY_PREPROCESS_VERSION` (`inventory-v1`). Same-acquisition/parser replay is
idempotent; successful preprocessing replaces that report day's entire capture. The
[inventory contract](../../docs/inventory_daily_captures.md) defines optional metrics, duplicate-SKU
handling and report-time semantics.

The [type registry](../../docs/transaction_type_registry.md) owns supported native monetary paths,
allocation categories and frontend type generation. The [Finances contract](../../docs/finances_transactions.md)
owns transaction identity, lifecycle and Summary checks. The [Data Kiosk workflow](../../docs/data_workflows.md#data-kiosk-preprocessing)
owns daily validation, zero filtering and version reuse. All preserve exact signed decimals and
nonblank SKU text; unknown required monetary detail fails rather than receiving a guessed category
or amount.

## Company terms and live financial reads

`src/database/company_terms.py` provides trusted internal company/terms writers. Application
administrators use the guarded `public.publish_sku_configuration` API instead. Source imports never
assign companies or create rates. The [company-fee contract](../../docs/company_fees.md) defines
immutable terms, explicit unassignment, fee periods and corrections; the
[access contract](../../docs/access_control.md) defines application roles and permissions.

`src/database/financial_reads.py` reads exact company totals for selected successful Finance batches,
a required processing version and inclusive marketplace/date scope. Missing coverage, ownership or
required fees fails a strict read. `load_company_financial_progress()` permits missing fees and
returns known amounts plus the unresolved components. Its fully unknown sums remain NULL.
See [partial summaries](../../docs/company_fees.md#partial-live-summaries) and the
[source-allocation policy](../../docs/source_allocation.md).

## Saved company payout reports

The database worker generates mature monthly reports and reacts to source/terms changes. It does
not call Amazon. The [payout contract](../../docs/company_payout_reports.md) owns eligibility,
input selection, retry/reuse behavior and access.

`src/database/payout_reports.py` provides a trusted internal `publish_company_payout_report()`
helper and readers for frozen headers and records derived from saved inputs. Publication selects one
company/month/marketplace/currency scope; callers do not supply source selections or calculated
totals. A null marketplace/currency can represent an eligible company month without monetary scope.
Application users only read reports; saving one does not approve or execute payment.

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
version reuse, immutable history, concurrency, and company access locally. See the database guide for
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
for the boundaries of these checks. Source and payout publication concurrency are
covered by database tests. The [known issues](../../docs/known_issues.md) also
document the restrictions on changing Storage visibility or process-global
routing configuration during use.
