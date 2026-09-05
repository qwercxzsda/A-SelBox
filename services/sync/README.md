# Amazon data workflows

The sync service owns three blocking, one-shot workflows:

1. download and structurally parse new Settlement reports;
1. process one stored Settlement report with transient Amazon elaboration
   inputs; and
1. refresh the rolling Data Kiosk provision.

Settlement source rows and successful processing results are immutable ground
truth. Data Kiosk and FBA elaboration inputs are never stored in PostgreSQL.
Provision rows are estimates; later processing batches supersede the current
view, while older results remain until explicitly pruned.

## Environment

Run modules from the repository root with the `A-SelBox` conda environment.
Amazon-facing commands may load these named variables:

- `LWA_APP_ID`
- `LWA_CLIENT_SECRET`
- `REFRESH_TOKEN_NA`
- `REFRESH_TOKEN_EU`
- `REFRESH_TOKEN_JAPAN`
- `REFRESH_TOKEN_SINGAPORE`
- `REFRESH_TOKEN_AUSTRALIA`
- `SP_API_DEFAULT_MARKETPLACE` (optional routing guard; normally unset)

Never inspect or print `.env`, credentials, refresh tokens, signed download
URLs, downloaded documents, or local processing artifacts. Pass
`--no-load-dotenv` when credentials are already present in the process
environment.

Each runner accepts `--database-url` and `--seller-namespace`. The default
database is the local Supabase PostgreSQL instance. Supply only a trusted
server-side connection; never expose it to client code.

## Workflow A: Settlement download and raw parse

```shell
conda run -n A-SelBox python -m \
  services.sync.run_download_and_parse_settlement_reports \
  --scope EU
```

For the selected credential scope, the command:

1. fetches active marketplace IDs and names from the Sellers API;
1. lists Settlement V2 reports created in exactly the last 90 days with status
   `DONE`;
1. queries PostgreSQL and removes already stored identities before downloading
   documents;
1. downloads and decompresses each new report;
1. decodes and structurally parses the TSV; and
1. inserts one report row and its complete content-row inventory in one
   transaction.

The parser preserves the ordered header, physical source line numbers, and
every decoded cell exactly. Empty strings remain empty strings and surrounding
whitespace remains present. It performs no amount, date, timestamp, currency,
quantity, taxonomy, or nullable-value conversion. Validation is limited to the
supported header and preamble, exact row widths, metadata/content row roles,
and a consistent `settlement-id`.

The report and document IDs are independently unique within seller namespace
and Amazon scope. An exact known identity is skipped. A conflicting report or
document identity, changed immutable listing metadata, download failure, parse
failure, or database failure is logged in Python and produces no partial
report. Independent reports continue, and a later invocation retries failed
work.

Once inserted, the raw report and rows reject every update and deletion.

## Workflow B: Settlement processing

```shell
conda run -n A-SelBox python -m \
  services.sync.run_process_settlement_report
```

By default, the command selects the oldest raw report that has no successful
processing log. Selection uses a join between Settlement reports and processing
logs; no mutable processed flag exists on the report.

To process a specific report again, pass its database UUID:

```shell
conda run -n A-SelBox python -m \
  services.sync.run_process_settlement_report \
  --settlement-report-id <uuid>
```

One run performs these steps:

1. loads one immutable raw report and converts its cells into typed Settlement
   data;
1. classifies the report to determine whether Data Kiosk, FBA Long Term Storage,
   or FBA removal-order detail is needed;
1. downloads, parses, and processes only those auxiliary sources;
1. loads effective company/SKU fee rates from PostgreSQL;
1. constructs the final Settlement entries and allocation results with their
   quantity facts; and
1. inserts the processing log and every processed table in one transaction;
   then checks the committed run's fee references and logs any reprocessing
   warning.

Preparation checks every nonblank row marketplace name against the immutable
ID/name mapping stored with the raw report. An unrecognized name aborts the
whole run before artifact creation, auxiliary API calls, or result persistence,
including when the report lists only one marketplace. The CLI error identifies
the source line as `source_line=N`, logs `code=UNRECOGNIZED_MARKETPLACE`, and
exits with status `1` without printing raw row contents. Blank names use the sole
listed marketplace when one exists; otherwise their marketplace remains
unassigned. A row that references an ambiguous stored mapping also fails
validation; unused duplicate names do not block processing.

Auxiliary Amazon data never enters PostgreSQL. The default
`--artifact-root` is `output/settlement-processing`. Each run receives its own
UUID-named directory with mode `0700`; fetched documents and JSON metadata use
mode `0600`. The directory is ignored by Git and may contain sensitive Amazon
and company data. These files are pre-commit diagnostics, not completion
markers; the database processing log is authoritative. A failed run can leave
diagnostic artifacts, but it leaves no processing log or processed database
rows.

Every successful invocation appends a new immutable run, even for a previously
processed report. The newest run is selected deterministically by processing
time and UUID through the database's latest-result views; older runs remain
available for audit.

The Selbox fee rate comes from the current
`public.company_sku_fee_rates` entry covering the activity date. Current means
the newest `created_at DESC, id DESC` entry for each
seller/marketplace/SKU/company, selected before filtering its period. A newer
entry fully supersedes that company's older entry, even outside the new period.
Entries for different companies remain independent; conflicting current periods
are rejected by the database.
Only product sales enter the fee base; refunds are excluded.
A zero-percent rate preserves the company assignment and produces no fee;
if a processed SKU has no applicable current fee, Python logs an error and
aborts the run without committing a processing log or results. Provision
processing follows the same rule and preserves its previous current batch.
This coverage requirement belongs to Python; the database itself does not
require a fee assignment.

```text
selbox_fee = -(selbox_fee_base * fee_rate_percent * 0.01)
```

The [shared financial contract](../../docs/data_workflows.md#financial-values)
defines exact `Numeric` arithmetic, fee-rate precision, and result quantities.

## Fee publication and advisory checks

The Python administrator entry point
`insert_company_sku_fee_rate(database, fee_rate)` in
`src/database/company_sku_fee_rates.py` accepts a `CompanySkuFeeRate`, inserts
it in a transaction, and returns its UUID. After committing, it checks current
Settlement runs affected by that fee identity, including references to its
older versions. Settlement persistence similarly checks its new processing log
after committing.

For an already-open database connection, the checker supports three modes:

```python
from services.sync.src.database.fee_reference_checks import (
    check_settlement_fee_references,
)

check_settlement_fee_references(database, processing_log_id="<run-uuid>")
check_settlement_fee_references(database, fee_rate_id="<fee-uuid>")
check_settlement_fee_references(database)  # Database-wide sanity check.
```

Supply at most one selector. The run selector is a
`private.settlement_processing_logs.id`, not an individual result-row UUID.
The checker examines only each report's current run and returns the affected
report UUIDs. It warns only about existing foreign keys to superseded fee
entries. It does not audit unassigned results or warn merely because a later
fee entry could cover them; missing fee coverage is logged as an error while
processing. A check failure logs an error and
returns `None`; successful inserts remain committed. The database-wide check
may take longer because it examines all current runs.

Warnings are advisory. Run Workflow B with each logged
`--settlement-report-id <uuid>` when appropriate, or leave the existing results
as they are. Successful reprocessing with current fees clears that report's
warning while retaining its earlier results. If the current fee periods leave
a required activity uncovered, reprocessing instead fails with the coverage
error and preserves the existing results. No automatic retry or reprocessing
is scheduled.

Direct administrator SQL inserts do not invoke Python. After committing one,
call the fee-specific checker explicitly, or run the database-wide check.
Provision refreshes use current fee entries too, but this checker covers
Settlement reports only; refresh affected provisions explicitly when needed.

## Workflow C: rolling Data Kiosk provision

```shell
conda run -n A-SelBox python -m \
  services.sync.run_refresh_data_kiosk_provision \
  --scope EU
```

The command resolves active marketplaces, downloads all Data Kiosk Economics
pages, validates response identity, and processes DAY/SKU facts in memory.
PostgreSQL receives a processing log and its processed provision rows.

Only after every selected marketplace succeeds does the command open a short
database transaction. It loads effective company/SKU fee rates, inserts a log
covering the selected seller, scope, and marketplaces, and inserts the complete
result batch. Any transaction failure preserves the previous current results.
`private.latest_data_kiosk_provisions` selects the latest successful batch per
marketplace using `processed_at DESC, id DESC`, the same policy as Settlement
processing. The timestamp is the persistence transaction's start time, not its
commit time or the age of Amazon's source data.

An explicit date interval limits acquisition input, but supersedes the whole
marketplace's current selection. A successful empty batch makes the current
result empty. Historical rows remain until the explicit
[retention function](../db/supabase/README.md#provision-result-retention) deletes
older results; no refresh deletes history automatically.
During a default whole-scope refresh, a configured marketplace that is no
longer active receives an empty current result after all remaining active
marketplaces succeed. If no marketplaces remain active, the command fails and
preserves the current provision selection.

Without date arguments, the query covers the latest 60 complete
marketplace-local days ending yesterday. Useful selectors are:

```shell
# Refresh one active marketplace for the default window.
conda run -n A-SelBox python -m \
  services.sync.run_refresh_data_kiosk_provision \
  --scope NA \
  --marketplace-id ATVPDKIKX0DER

# Refresh an explicit inclusive marketplace-local interval.
conda run -n A-SelBox python -m \
  services.sync.run_refresh_data_kiosk_provision \
  --scope NA \
  --marketplace-id ATVPDKIKX0DER \
  --start-date 2026-08-01 \
  --end-date 2026-08-31
```

`--marketplace-id` may be repeated. `--refresh-days` cannot be combined with an
explicit date interval. Data Kiosk permits at most two years of history, and an
interval cannot include the current incomplete local date.

Provision values cover the full requested window, including dates that may
already have Settlement data. The refresh does not subtract settled dates or
provide a combined Settlement/provision read API. Consumers must select the
appropriate source without double-counting the overlap. The provision fee base is Data Kiosk ordered product sales, excluding
refunds.

## Command behavior and operational limits

Each command returns `0` on success and `1` on a workflow failure. Workflow A
also returns `1` for an incomplete run containing identity anomalies or failed
reports, while keeping independently successful inserts. Argparse rejects
malformed command syntax with exit code `2`. Workflow B returns `0` when no
unprocessed report remains; it processes at most one report per invocation.

Commands use the `__DEFAULT__` seller namespace unless `--seller-namespace` is set.
Use a stable, distinct namespace for each seller account: the namespace is an
operator-supplied storage boundary and is not derived from Amazon credentials.

Concurrent provision refreshes append separate atomic batches; current views
select one batch per marketplace. Default Settlement processing does not claim
a report: multiple workers may intentionally process the same oldest report
and append independent successful runs.

FBA acquisition reuses a matching `DONE` report when available, otherwise
creates one and polls its ID while pending. Terminal failure stops polling;
reaching the attempt bound logs a timeout. Defaults are 120 attempts with a
five-second interval, about ten minutes of waiting plus API and retry time.
Use `--max-poll-attempts` or `--poll-interval-seconds` to allow longer polling
on a later invocation. Duplicate Amazon work after overlapping requests or
timeout is accepted; no pending-report tracking or coordination is required.
See the [FBA acquisition contract](../../docs/data_workflows.md#fba-report-acquisition).

## Failure and retry behavior

| Workflow | Database effect on failure                    | Retry behavior                                                                      |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| A        | No partial report or error row                | Run A again; known successful reports are filtered                                  |
| B        | No processing log or partial processed result | Run B again, optionally with `--settlement-report-id`; local diagnostics may remain |
| C        | No partial batch; current provision unchanged | Run C again after correcting the acquisition or processing failure                  |

## Code layout

```text
run_*.py                       Thin module entry points
src/cli/                       CLI settings and orchestration boundaries
src/amazon/                    SP-API clients, downloads, and source parsers
src/settlements/                Workflow A discovery and persistence orchestration
src/settlement_processing/      Workflow B conversion, acquisition, planning, and storage
src/data_kiosk_economics/       Workflow C date windows, acquisition, and processing
src/database/                  PostgreSQL repositories and fee-rate resolution
tests/unit/                    Fast behavior tests by domain
tests/integration/             Opt-in Amazon workflow test
tests/support/                 Shared test doubles and fixtures
```

## Development checks

Run from the repository root:

```shell
conda run -n A-SelBox python -m unittest discover
conda run -n A-SelBox ruff check services/sync
conda run -n A-SelBox ruff format --check services/sync
conda run -n A-SelBox sh -c \
  'pyright --pythonpath "$CONDA_PREFIX/bin/python" services/sync'

conda run -n A-SelBox mdformat --check services/sync/README.md
conda run -n A-SelBox pymarkdown scan services/sync/README.md
```

Integration tests are discovered but skip unless their explicit opt-in
environment variables are configured. Unit tests do not inspect `.env`.
