# Database read benchmarks

The clone-based harnesses measure the installed database API on disposable local databases.
Current query/index guidance is in [Database performance](../../../../docs/database_performance.md).
Clone-based runners require a seed installed from the current baseline.

Run from the repository root with the frontend seed database and REST containers available:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.benchmark \
  --output-dir /private/tmp/aselbox-page-results --repeat 5 --fixtures density,history

conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.aggregation_benchmark \
  --output-dir /private/tmp/aselbox-summary-results --repeat 5 --fixtures density,history

conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.search_benchmark \
  --output-dir /private/tmp/aselbox-search-results --repeat 3 --fixtures density,history
```

The output directory must be new. `--fixtures density` or `--fixtures history` selects one workload.
`--help` does not contact Docker or the database. The shared runner records completion/failure and
cleanup status and writes results atomically.

## Workloads

- **Pages and counts:** member/operator newest, oldest, and marketplace reads with and without a 60-day range. A separate
  exact count starts after page rows arrive; its result must match the combined page/count response.
- **Summaries and options:** latest-day/month and 60-day totals, Type/currency groups, marketplace totals, and the
  operator's complete SKU catalog, including historical facts and registered-only SKUs. Untimed
  authorized SQL provides independent exact-value references. Only current RPCs are timed;
  general REST aggregates stay disabled.
- **Search and amount ordering:** all three datasets, exact OR search sets resolved from raw SKU,
  Type, Marketplace, and Source values before timing; currency is excluded. Filtered date and amount
  pages cover stable ties, offsets, exact counts, and the 10,000-row amount-ordering guard. Independent
  raw-view substring queries verify these benchmark terms without sorting over-limit scopes.
  Frontend tests separately cover humanized labels and Unicode matching.

Each actor's visible data supplies its scope. Summary filter values are selected from positive
transactions inside the benchmark date range; records include the actual bounds and
matching row counts. One warm-up precedes measured repetitions; request order rotates
across runs. Results contain timings, counts, sizes, digests, catalog fingerprints,
and cleanup status. Financial rows, filter literals, account identities, credentials, and tokens
remain in memory.

Date ordering reverses date and source/ID ties together. Amount ordering retains ascending ties in
both directions. SQL and real Auth/API tests cover these contracts, including multi-market merging,
current-source visibility, missing fees, and exact numeric values.

## Fixture lifecycle

Only the fixed seed stack on loopback port 55422 is used. Docker is pinned to a validated local Unix
socket. An existing benchmark database causes refusal rather than reuse. The harness creates and
removes only its allowlisted clones and temporary REST containers, using the installed image with
`--pull=never` and a fresh synthetic signing key.

- **Density** copies each source fact ten times with new identities and updates clone-only inventories.
  Dates, SKUs, companies, and source versions keep their original distribution.
- **History** creates ten dated cohorts and shifts source headers/facts together. Selected fee terms
  extend backward; original accounts, payouts, and source rows remain intact. Foreign keys, inventories,
  pruning rules, and ownership are checked before commit.

Both fixtures derive sizes from the source rather than a saved row-count assumption and refuse
repeated expansion. Setup-only trigger suppression ends before reads. Dumps and REST environment
files have mode 0600 and are removed with their temporary directory. Source catalog fingerprints
must remain unchanged.

These are warm database/OS workloads with fresh reads. They do not measure browser rendering,
application caches, sustained production concurrency, or replayable Amazon import evidence. Do not
run simultaneous instances against the same clone names.

## Query plans

`plans.explain_rpc(connection, user_id, function_name, arguments)` inspects current installed
query definitions on an idle connection. It binds the current request parameters and runs the
extracted SELECT under `authenticated` with the supplied actor in a read-only transaction. The
SKU catalog path first invokes its actual administrator gate. Check the real RPC response before
using a plan as diagnostic evidence; this helper does not replace API validation.

The adapter supports current page, count, total, and administrator SKU-catalog RPCs. It records
technical node/index names and cardinalities without saving filter values or financial rows.
Plans are collected after timing; they are not HTTP latency measurements. No benchmark runner
changes an existing application database. Plan collection itself does not alter indexes,
functions, or access rules.
