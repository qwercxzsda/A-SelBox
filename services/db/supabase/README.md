# Supabase database

This directory contains the PostgreSQL schema for the three A-SelBox workflows.
Manage the schema only through the migrations in this
directory. Do not make schema changes in the Supabase dashboard.

The application uses a trusted server-side PostgreSQL connection. All tables
have row-level security enabled, and `anon`, `authenticated`, and
`service_role` receive no table, view, sequence, function, or private-schema
access.

## Data lifecycle

### Settlement source

`private.settlement_reports` stores one immutable Reports API identity together
with the exact structural TSV parse:

- ordered marketplace IDs and names;
- ordered column names;
- the physical metadata-row line number and its exact `text[]` values;
- the decoded document SHA-256 digest; and
- the declared number of transaction content rows.

`private.settlement_report_rows` stores each transaction row by immutable UUID
and physical source line number. `column_values` is an exact `text[]`: blank
cells stay empty strings, spelling is not normalized, and no amount or date is
converted during ingestion. A trigger enforces the report's column width.
Deferred inventory checks on parent and child inserts require the declared
and stored row counts to match when the transaction commits.

The metadata and all rows must be inserted in one transaction. Both tables
reject every `UPDATE` and `DELETE` immediately. Report ID and document ID are
independently unique within seller namespace and Amazon scope. Download,
identity, and parse failures belong only in Python logs.

### Settlement processing

Every successful invocation inserts a new
`private.settlement_processing_logs` row. It has no status or input-deduplication
key. Failed work rolls back, while retrying or changing processing logic creates
another immutable run for the same report.

Each processed table directly references its processing log:

- `private.settlement_processed_reports` contains the typed report header;
- `private.settlement_processed_entries` contains typed transaction rows and
  cites the exact immutable raw row;
- `private.settlement_processed_results` contains final allocation targets and
  exact Settlement, elaborated, difference, Selbox-fee, and payable amounts
  with their nullable quantity facts.

These rows are immutable. Data Kiosk, FBA aged-storage, and FBA removal-order detail
used during processing is transient and remains only in local processing
artifacts.

Both the log and each processed-table insert queue deferred inventory checks.
Keep checks deferred until a multi-statement batch is complete. Forcing an
earlier check cannot bypass validation of later child inserts.
Each child queues a recount, so validation cost grows quadratically with the
batch's row count. A rollback-only local benchmark measured 0.08 seconds for
1,000 raw rows and 1.43 seconds for 5,000. The
[inventory regressions](tests/workflow_data_model/35_inventory_constraint_timing.sql)
cover inserts after early constraint evaluation.

The [shared financial contract](../../../docs/data_workflows.md#financial-values)
defines Python `Numeric` arithmetic, database fee-rate precision, and nullable
quantity semantics. Monetary columns use finite, unconstrained-scale `numeric`;
applied fee rates are additionally restricted to `0%..100%` and six fractional
digits. Result quantities are `numeric`; Settlement source quantities fit
nonnegative `bigint`.

`private.latest_settlement_processing_logs` deterministically selects the
newest run by `processed_at DESC, id DESC` for each report.
`processed_at` defaults to the persistence transaction's start time, so this
ordering is not a commit-time ordering.
`private.latest_settlement_processed_results` exposes only results belonging to
those runs.

### Company/SKU fee rate

`public.company_sku_fee_rates` stores immutable ownership and fee-rate history
administered by the database administrator. One row binds seller
namespace, marketplace, SKU, company, percentage-point fee rate, and a
nonempty `[)` date range. `2.5` means `2.5%`.

`private.latest_company_sku_fee_rates` selects the newest row by
`created_at DESC, id DESC` for each seller/marketplace/SKU/company.
These current rows are selected before
their periods are tested against an activity date. A new row wholly supersedes
the same company's earlier row: shortening an open-ended period is allowed,
and no older row supplies dates outside the replacement period. A different
company's row does not supersede it. The database prevents overlapping current
periods for different companies with the same seller/marketplace/SKU.

A `BEFORE INSERT` trigger enforces this overlap rule in the existing table.
It locks the seller/marketplace/SKU and checks current entries after acquiring
the lock. Fee inserts require `READ COMMITTED`, PostgreSQL's default isolation
level; the trigger rejects other levels so its overlap check can observe a
concurrent writer's commit. Application transactions use this default.

A `0%` period is valid: it retains the company/SKU ownership assignment while
producing no Selbox fee.

The database enforces interval overlap but does not require every processed
SKU to have fee coverage or a company assignment. When no applicable current
fee exists, Settlement and provision processing log an error in Python and
abort without committing a processing log or results. Trusted manual SQL may
still insert unassigned results that satisfy the existing result-shape checks.

Processed results copy the applied rate and fee base in addition to retaining
the fee-rate foreign key. The database checks the effective period and exact
fee equation:

```text
selbox_fee = -(selbox_fee_base * applied_fee_rate_percent * 0.01)
```

Fee history rejects `UPDATE`, `DELETE`, and `TRUNCATE`. Result foreign keys
continue to reference their original entries after supersession. Referencing
an older entry is permitted: Python logs advisory warnings identifying current
Settlement reports to reprocess. It does not invalidate stored results or
block inserts. These post-commit checks do not audit missing fee references;
coverage errors are logged during processing. The [fee publication and check procedure](../../sync/README.md#fee-publication-and-advisory-checks)
describes the three check modes and the explicit check required after direct
SQL inserts.

### Data Kiosk provision

Every successful refresh inserts a
`private.data_kiosk_provision_processing_logs` row and its complete
`private.data_kiosk_provisions` result batch in one short transaction after
Amazon acquisition and processing. The log records the seller namespace,
Amazon scope, covered marketplace IDs, processor version, processing time,
and original result count. Covered marketplaces include successful empty
results.

Each result has a UUID primary key and a `processing_log_id` foreign key.
The combination of log ID, seller namespace, Amazon scope, marketplace,
activity date, SKU, and currency is unique within the batch. Logs reject
updates and deletions; results reject updates and cannot be inserted after
the log's transaction. Results can be deleted for retention.

`private.latest_data_kiosk_provision_processing_logs` selects one successful
log per seller/scope/marketplace by `processed_at DESC, id DESC`, matching
Settlement processing. `private.latest_data_kiosk_provisions` returns its
results. A successful empty marketplace stays empty rather than falling back
to an older batch. Selection covers entire marketplace partitions, even when
acquisition uses an explicit date interval. Read the view in one query rather
than separately selecting a log and fetching its results across snapshots.

Concurrent refreshes cannot mix their batches in this view. The ordering uses
the persistence transaction's start time, not commit time or Amazon source
freshness; see the [provision contract](../../../docs/data_workflows.md#c-data-kiosk-provision).

Exact equations include:

```text
net_units_sold = units_sold - units_returned
net_product_sales = product_sales - product_refunds
selbox_fee_base = product_sales
```

All stored monetary values use unconstrained-scale PostgreSQL `numeric` and
must be finite. Amounts are never rounded up or down: Python uses
context-independent exact `Numeric` arithmetic, and database equations use
only exact addition, subtraction, and multiplication. Workflow B stores no
derived quotients.

Provision quantities accompany product sales, refunds, net product sales,
Amazon fees, advertising, net proceeds, and the Selbox fee/base. Known sales,
return, and fee-base quantities are generated from the corresponding unit
facts. Fee-detail quantities stay attached to their individual categories. Totals
spanning multiple fee or advertising categories have no shared quantity and
stay null. Per-unit
columns already express a quantity of one.

### Provision-result retention

Refreshes retain previous results. To delete older batches explicitly, call:

```sql
select private.prune_data_kiosk_provision_results(
    p_seller_namespace => '<seller-namespace>',
    p_amazon_scope => 'NA',
    p_keep_latest => 3
);
```

Replace the seller placeholder before running this maintenance operation.
The function returns the number of deleted provision rows as `bigint` and
requires `p_keep_latest >= 1`. It keeps the newest `k` successful batches per
marketplace within that seller and scope, counting empty batches in the same
`processed_at DESC, id DESC` order as the views. A multi-marketplace log may
therefore retain results for only some marketplaces. Every processing log and
its original result count remain; the count records the successful batch, not
the number of rows remaining after pruning. Increasing `k` later does not
restore deleted results.

Ranking and deletion share one statement snapshot, so a concurrently committed
batch is not deleted using a stale list of retained logs. Cleanup is separate
from refresh persistence: failure leaves extra history without affecting the
current result. The function does not prune Settlement processing records.

## Migration and seed

Apply migrations in order:

| Version          | Responsibility                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| `20260904092515` | Immutable Settlement data and rolling provision data                           |
| `20260905064419` | Provision processing logs, current-result views, and explicit result retention |
| `20260905071847` | Child-insert inventory checks for raw and processed Settlement batches         |
| `20260905080405` | Current company/SKU fee versions and overlap checks across companies           |

The provision migration preserves existing rows and places them in labeled
imported logs per seller/scope/marketplace. Those logs describe the imported
snapshot; they do not reconstruct earlier processing history. Existing data
does not require a database reset.

The fee migration preserves every historical row and result reference. For
each seller/marketplace/SKU/company, its newest existing entry becomes current;
earlier entries stop participating in fee lookup even outside its period.

The default `seed.sql` is intentionally empty. Company/SKU fee rates are
administered directly, while Amazon source and provision data must enter through
their production workflows. Do not commit real or fake Amazon source history as
a seed.

## Verification

Use the `A-SelBox` conda environment. From the repository root:

```shell
conda run -n A-SelBox sqlfluff lint services/db/supabase/migrations \
  services/db/supabase/tests services/db/supabase/seed.sql
conda run -n A-SelBox ruff check services/db/supabase/tests
conda run -n A-SelBox ruff format --check services/db/supabase/tests
conda run -n A-SelBox sh -c \
  'pyright --pythonpath "$CONDA_PREFIX/bin/python" services/db/supabase/tests'
conda run -n A-SelBox python -m unittest \
  services.db.supabase.tests.test_local_database
conda run -n A-SelBox mdformat --check services/db/supabase/README.md
conda run -n A-SelBox pymarkdown scan services/db/supabase/README.md

supabase start --workdir services/db
supabase migration up --local --workdir services/db
supabase migration list --local --workdir services/db
supabase db lint --local --schema public,private --level warning \
  --fail-on warning --workdir services/db
supabase db advisors --local --type security --level warn \
  --fail-on warn --workdir services/db
supabase db advisors --local --type performance --level warn \
  --fail-on warn --workdir services/db
conda run -n A-SelBox python -m \
  services.db.supabase.tests.run_workflow_data_model
RUN_LOCAL_SUPABASE_TESTS=1 conda run -n A-SelBox python -m unittest \
  services.db.supabase.tests.test_workflow_repositories \
  services.db.supabase.tests.test_provision_concurrency
```

The SQL runner accepts only the configured loopback Supabase database on port
54322, verifies the expected migrations, executes numbered lifecycle checks
inside one transaction, and always rolls the fixtures back. Never run reset or
test commands with `--linked` or a hosted database URL.

The repository integration tests exercise Python serialization, fee resolution,
and provision batching and retention against the actual schema, rolling back
their synthetic records. The provision concurrency tests validate the same
local connection guard, then create a disposable `provision_c1_test_<uuid>`
database on that server. They verify lossless migration of synthetic existing
rows, concurrent batches and pruning, empty results, and insertion guards,
as well as concurrent fee overlap rejection and fee-insert isolation guards,
then close connections and drop only that test database. Both modules skip
unless `RUN_LOCAL_SUPABASE_TESTS=1` is set and make no Amazon requests.
Starting the stack leaves it running for subsequent development; verification
does not reset the main local Supabase database.

If the connection is refused, ensure Docker is running and run the local
`supabase start` command above. Existing local data may use an older schema;
the migration list and test guard identify that mismatch. Only when the local
data is disposable should you rebuild it with
`supabase db reset --local --no-seed --workdir services/db`, which deletes and
recreates that local database.
