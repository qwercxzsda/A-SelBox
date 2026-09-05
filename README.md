# A-SelBox

A-SelBox builds company-scoped Amazon SKU economics through three independent,
one-shot workflows. Settlement reports are the immutable source of truth. Data
Kiosk and FBA reports help elaborate Settlement results without becoming
database records, while a separate rolling Data Kiosk provision supplies recent estimates.
Provision refreshes do not exclude dates covered by Settlement reports; readers
must choose the authoritative source for their use case.

## Data lifecycle

| Data                  | Database lifecycle                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Settlement source     | Exact structural TSV parse; append-only and immutable                                                              |
| Settlement processing | A new immutable log and result set for every successful run                                                        |
| Elaboration inputs    | Data Kiosk and FBA data stay outside PostgreSQL; fetched documents are retained only as local processing artifacts |
| Data Kiosk provision  | Atomic processing logs and result batches; current views select the latest batch; old results can be pruned        |
| Company/SKU fee rates | Immutable history; the newest entry per seller/marketplace/SKU/company is current                                  |

Settlement amounts remain authoritative even when auxiliary evidence is used
to assign or explain them. By default, readers select the newest successful
processing for each report. Older processing runs remain available for audit.

The [data workflow contract](docs/data_workflows.md) defines exact arithmetic,
fee calculation, quantity handling, persistence, retries, and intended
concurrency behavior. The [known issues](docs/known_issues.md) track unresolved
logic, concurrency, and policy questions.

## Workflows

### A. Download and parse new Settlement reports

The command requests `DONE` Settlement V2 reports created during the last 90
days, filters identities already in PostgreSQL, and downloads only new
documents. Parsing verifies the TSV structure but does not convert dates,
amounts, currency, whitespace, or blank cells. The report metadata and all
content rows are inserted together and can never be updated or deleted.

```shell
conda run -n A-SelBox python -m \
  services.sync.run_download_and_parse_settlement_reports --scope EU
```

Identity anomalies, download failures, parse failures, and failed inserts are
Python log events only. Fix the cause and run the command again.

### B. Process one Settlement report

Without an explicit ID, the command selects the oldest report with no
successful processing log. It converts the stored raw cells, determines which
auxiliary sources are needed, fetches those sources from Amazon, and processes
them in memory. Data Kiosk, FBA Long Term Storage, and FBA removal-order detail are
never saved in PostgreSQL; sensitive source artifacts are written beneath the
ignored local `output/settlement-processing/` directory.

```shell
conda run -n A-SelBox python -m \
  services.sync.run_process_settlement_report
```

Pass `--settlement-report-id <uuid>` to process a report again. Every successful
run appends a new processing log and complete result set, so corrections do not
mutate prior results.

### C. Refresh the Data Kiosk provision

This command downloads, parses, and processes Data Kiosk Economics entirely in
memory. After all selected marketplaces succeed, one database transaction
appends a processing log and its complete result batch. Current-result views
select the latest successful batch per marketplace, including successful empty
results. Older results remain until explicitly pruned; logs are always retained.

```shell
conda run -n A-SelBox python -m \
  services.sync.run_refresh_data_kiosk_provision --scope EU
```

The default window is the latest 60 complete marketplace-local days. Use
`--marketplace-id`, `--refresh-days`, or paired `--start-date` and `--end-date`
arguments to select another supported scope.

## Repository layout

```text
docs/                         Workflow contract and known issues
services/sync/                Python SP-API and processing workflows
services/db/supabase/         PostgreSQL migrations and lifecycle tests
```

Operational details are in the [sync service README](services/sync/README.md).
The [database README](services/db/supabase/README.md) describes tables,
immutability, provision-result retention, and local database verification.

## Environment and safety

Use the `A-SelBox` conda environment:

```shell
conda env update --name A-SelBox --file env.yml --prune
```

The workflow runners may load credentials from `.env`, but application code
accesses only named environment variables. Never inspect, print, or commit
credentials, refresh tokens, signed Amazon URLs, downloaded reports, or local
processing artifacts. Use `--no-load-dotenv` when the process environment is
already configured.

Commands are blocking and one-shot. The repository does not include a scheduler
or resident worker.

## Verification

Run checks from the repository root:

```shell
conda run -n A-SelBox python -m unittest discover
conda run -n A-SelBox python -m unittest \
  services.db.supabase.tests.test_local_database
conda run -n A-SelBox ruff check services
conda run -n A-SelBox ruff format --check services
conda run -n A-SelBox sh -c \
  'pyright --pythonpath "$CONDA_PREFIX/bin/python" .'

conda run -n A-SelBox mdformat --check README.md docs services
conda run -n A-SelBox pymarkdown scan -r README.md docs services
conda run -n A-SelBox sqlfluff lint services/db/supabase/migrations \
  services/db/supabase/tests services/db/supabase/seed.sql
```

Local Supabase startup, SQL lifecycle checks, and opt-in Python repository
integration tests are documented in the database README. Normal verification
does not reset the database. Never run destructive Supabase commands against
a linked or hosted project.
