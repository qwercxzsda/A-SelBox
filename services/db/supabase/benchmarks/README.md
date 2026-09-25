# Current transaction RPC benchmark

Run from the repository root with the local frontend seed database and REST containers running:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.benchmark \
  --output-dir /private/tmp/aselbox-current-rpc-results \
  --repeat 5 --fixtures density,history
```

The output directory must not already exist. `--fixtures density` or `--fixtures history` selects
one workload. `--help` never accesses Docker or the database.

This entry point calls only the **installed** `transaction_page` and `transaction_count` endpoints.
It does not install migrations, inline query candidates, import old experiment code, or extract SQL
from historical migrations. Install the current application migrations before running it; the
contract check requires native marketplace arrays, the fee-applicability parameter, and the current
`p_order_by` argument for date/amount ordering, and optional `p_search`, without the retired
`p_sort` argument.

It measures member and administrator reads for newest, oldest, one marketplace, and latest ten
dates. One warm-up precedes the requested measured repetitions. Page rows arrive first; the exact
count request starts afterward. Separate responses must match the installed RPC's combined response
exactly. `results.json` contains timings, sizes, digests, fixture metadata, catalog fingerprints,
and cleanup status; it never stores financial rows, account IDs, credentials, or tokens.

Date ordering reverses the date and its source/ID tie-breakers together: descending uses
`NULLS FIRST`, ascending uses `NULLS LAST` (transaction dates are non-null). Amount ordering keeps
`NULLS LAST` and ascending source/ID ties in both directions. The independent view oracles and real
Auth tests enforce this distinction. A focused date-only run uses `--fixtures history --repeat 3`.

The two fixtures contain about one million source facts:

- **Density:** ten copies per existing source version, retaining the seed's date/SKU/company
  distribution.
- **History:** ten dated cohorts, shifting source headers and facts together while preserving
  existing accounts and payouts. Fee coverage extends backward in newly selected revisions;
  integrity checks run before commit. Raw archive references remain synthetic and are unsuitable for
  import replay.

Only the fixed local seed stack on loopback port 55422 is used. Existing benchmark databases cause
an error rather than reuse. The package creates and later removes only its own allowlisted clones,
starts a temporary REST container using the already installed image with `--pull=never`, and uses a
fresh synthetic signing key. Dumps and REST environment files have mode 0600 inside an automatically
deleted temporary directory. The source catalog must remain unchanged; fixture triggers are
suppressed only inside clone setup transactions and restored before reads.

The benchmark warms database/OS caches, vacuums and analyzes the clones, and starts with no
application count cache. It does not simulate browser rendering or sustained production concurrency.
Never run simultaneous instances using the same fixture names.

## Summary and filter-option RPCs

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.aggregation_benchmark \
  --output-dir /private/tmp/aselbox-summary-rpc-results \
  --repeat 5 --fixtures density,history
```

Install the current `transaction_totals` and `dataset_filter_options` definitions first. The harness
uses the same guarded disposable fixtures and cleanup. It compares the installed RPCs against the
previous generated REST request shape, with exact source counts and CSV decoding, alternating the
two strategies for each warm-up/measured repetition. It does not install alternate SQL
implementations. Latest-day/month bounds are discovered separately for each actor, outside the
measured requests.

Only the temporary REST server enables generated aggregates for that comparison. A second temporary
server explicitly disables them, verifies `PGRST123` rejection, and checks that the RPCs still work.
Neither server changes the source's aggregate setting or uses real Auth credentials. Exact decimal
values, NULL amounts, row/known counts, and complete option sets must match before measurements are
accepted. Saved artifacts retain only timings, sizes, digests and technical fixture metadata.

## Visible text search and bounded amount ordering

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.search_benchmark \
  --output-dir /private/tmp/aselbox-search-results \
  --repeat 3 --fixtures density,history
```

Install the current `transaction_page`, `transaction_count`, `source_transaction_page`, and
`source_transaction_count` definitions first. All four must expose `p_search`. The harness also
requires the four retired amount indexes to be absent. It never installs or removes indexes.

Search matches literal, case-insensitive substrings in SKU, type, marketplace, and currency.
Transactions additionally searches the source code and its displayed label (Settlements or Data
Kiosk). Hidden import metadata and fee status are excluded. The same guarded clone lifecycle checks
both a company member and an administrator for all three datasets, using four cases each:

- Default newest-date ordering, with no filters or search; this remains uncapped.
- Broad amount ordering, which must return SQLSTATE `22023` and the documented 10,000-row limit
  message. The reference confirms at least 10,001 authorized matches without sorting them.
- Amount ordering within one date/SKU/marketplace/type scope, with a matching currency search. Each
  actor's visible data supplies a positive scope below the limit. Ascending ordering, descending
  ordering, stable ties, offset pagination, and the combined count are checked before timing the
  descending first page and its separate exact count.
- A date-filtered search with no matches, which must return an empty page and an exact zero count.

One warm-up precedes the measured repetitions. Successful requests measure page rows first and then
the exact count, recording each latency separately. Rejected requests measure time to the clear
limit error. This is a bounded workload, not an exhaustive selectivity or concurrency test. It does
not measure hidden-field search or unrestricted amount sorting, which are no longer supported.
Earlier experiments with those behaviors are historical evidence only.

An independent query against the existing views runs under `authenticated` with the same actor's JWT
subject. It uses native numeric/date ordering and an explicit enum-to-text cast for marketplace
search. This avoids PostgREST's inability to apply a text `imatch` operator directly to an enum.
Exact financial strings, NULLs, row order, and counts must match the installed RPCs. Only
`created_at` and `posted_at` are normalized to equivalent timestamp spellings. References use JSON
with exact Decimal/string numeric parsing: PostgREST CSV doubles literal backslashes in text, so its
older representation is not treated as the required stored value.

Literal punctuation, Unicode, whitespace, source aliases, hidden-field exclusions, and revoked
access receive real Auth/PostgREST coverage in `tests/e2e/test_text_search.py`. Database tests cover
the exact 9,999/10,000/10,001 sorting boundary and rejection before fee projection. Saved artifacts
retain only timings, response sizes, digests, technical fixture metadata, and cleanup status; no
rows, search terms, account identifiers, credentials, or tokens are written.

## Optional index experiments

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.index_benchmark \
  --output-dir /private/tmp/aselbox-index-results
```

This entry point owns one disposable history clone throughout its sequential experiments. It
captures the currently installed optional indexes, including canonical SKU/type names, and restores
those exact definitions before dropping the clone. Constraint, ownership/version, and source-header
indexes remain unchanged. Baseline and candidate optional indexes are freshly rebuilt, so index-size
comparisons do not mistake original fragmentation for a key-design improvement.

Forty pilot cases cover member and administrator date pages, frequent/sparse SKU and marketplace
selections, sparse types, date/search scopes, separate counts, selected-SKU totals, the member's
current-version inventory, and a maintained privileged financial-progress call. Every response must
match the first baseline exactly, including row order and decimal strings. Each pilot gets one
warm-up and one measured repetition; it can reject an ineffective or oversized family but is not
final latency evidence. Current installed-query EXPLAIN diagnostics run after timing, without
changing planner methods, SQL functions, or RLS. Saved plans omit filter literals and returned data.

After `pilot-ready.json` appears, write `selection.json` in the output directory. `selected` chooses
the index set left for an optional external write-cost probe. `finalists` starts with `"baseline"`
and may contain up to four entries; omit it to compare baseline and selected. A custom entry has a
label and an allowlisted family list, either shared or selected per source:

```json
{
  "selected": {
    "name": "selected",
    "families": {
      "settlement": ["sku_date", "type_date"],
      "kiosk": ["sku_date", "type_date", "market_date"]
    }
  }
}
```

Finalists receive three measured repetitions and thirteen additional guardrails: unfiltered
day/month totals, latest-date lookup, type-only selection, common-SKU oldest/deep-offset pages, and
administrator company filtering. Compare individual page and count timings; repeated equivalent
counts are not independent workload weights. Index bytes and observed plan use accompany each
variant.

`write-probe-ready.json` marks the end of all timed reads. After any separately coordinated
clone-only write probe finishes and removes its own objects, write `release.json` containing
`{"release": true}`. Each handoff has a 15-minute timeout. Errors and timeouts still restore the
clone's indexes and remove the clone, private dump, REST container, and temporary files. Never run
another benchmark against the same allowlisted clone concurrently.
