# Database read benchmarks

These harnesses measure the currently installed database API on disposable local clones. Current
query/index guidance is in [Database performance](../../../../docs/database_performance.md); the
latest recorded results are in the [current-reference access evidence](../../../../docs/evidence/simple_metadata_access_2026-09-26/README.md).

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

- **Pages and counts:** member/operator newest, oldest, marketplace, and recent-date reads. A separate
  exact count starts after page rows arrive; its result must match the combined page/count response.
- **Summaries and options:** date-bounded totals, type/currency groups, marketplace totals, and option
  lists from current live/raw datasets. Untimed queries against the same authorized views provide
  independent exact-value references. Only current RPCs are timed; general REST aggregates stay disabled.
- **Search and amount ordering:** all three datasets, literal visible-field search, filtered date and
  amount pages, stable ties, offsets, exact counts, and the 10,000-row amount-ordering guard. Independent
  view queries verify results without sorting over-limit scopes.

Each actor's visible data supplies its scope. One warm-up precedes measured repetitions; request
order rotates across runs. Results contain timings, counts, sizes, digests, catalog fingerprints,
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

## Index experiments

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.index_benchmark \
  --output-dir /private/tmp/aselbox-index-results
```

This harness owns a history clone and compares its current optional indexes, a minimal date-index
set, and allowlisted SKU/type/marketplace/owner index families. It preserves constraints, RLS,
functions, and required reference indexes. Each set is rebuilt before measurement; exact responses
must match the first baseline. Installed-query EXPLAIN diagnostics run after timing and omit data
and filter literals.

After `pilot-ready.json`, write `selection.json` with a `selected` set and optional `finalists` list
(starting with `"baseline"`, at most four entries). For example:

```json
{
  "selected": {
    "name": "selected",
    "families": {
      "settlement": ["sku_date", "type_date", "market_date"],
      "kiosk": ["sku_date", "type_date", "market_date"]
    }
  }
}
```

Pilots use one measured repetition; finalists use three and add unfiltered totals, latest-date,
sparse-type, oldest/deep-offset SKU, and company-filtered checks. Compare page and count latency
separately; repeated equivalent counts are not independent workload weights.

`write-probe-ready.json` marks the end of timed reads. A separately coordinated clone-only write
probe may then run. After it removes its objects, write `release.json` containing `{"release": true}`.
Handoffs time out after 15 minutes. Errors and timeouts still restore captured indexes and remove
owned clones, containers, dumps, and temporary files.
