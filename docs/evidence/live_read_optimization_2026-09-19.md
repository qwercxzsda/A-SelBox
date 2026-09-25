# Live transaction read optimization — September 19, 2026

**Historical measurement record.** The timings, plans, and validation counts below describe the
implementation tested on this report's date. They are not measurements of the current
[page/count implementation](../transaction_query_contracts.md). Superseded experiment scripts have
been retired; use the [maintained benchmark guide](../../services/db/supabase/benchmarks/README.md)
for new runs.

The original `20260919021702_optimize_live_transaction_reads.sql` made live reads relational and
computes member source access from current SKU ownership. It preserves the 24-column financial
result, exact arithmetic, current-version selection, and operator/member permissions. The
explicit-version resolver used to freeze payout reports remains unchanged.

## Problem and implementation

The former live view passed arrays of every visible current source and terms version into a PL/pgSQL
resolver. Outer filters and pagination operated on its materialized output. On the original seed, a
25-row request generated 48,540 permitted rows; a separate exact-count read repeated that work. Each
pass also spilled intermediate results to temporary storage.

Replacing the resolver call with joins allowed date and SKU predicates to reach the source facts,
but exposing more companies and source headers revealed a second cost. Header/version RLS repeatedly
called a Boolean helper that rebuilt the member's SKU scope for individual headers. A broad-fixture
page took about 6.3 seconds; switching JIT off left it around 6.0 seconds. The plans pointed to
repeated authorization scans rather than JIT compilation.

The final migration makes four related changes:

- The invoker-security live view joins facts to current source-version pointers. Immediate composite
  foreign keys already guarantee that a current version belongs to its header, so redundant identity
  equalities are omitted. This avoids underestimating the same relationship twice.

- A materialized selected-terms CTE evaluates current ownership and its RLS once per query instead
  of once per result row. Explicitly unassigned terms remain available for ownership diagnostics.

- Four header/version policies test membership in `private.current_company_source_versions(text)`.
  This new private, stable, security-definer helper binds `auth.uid()` to the current member account
  and SKU ownership, then returns only permitted current version IDs. Authenticated execution is
  granted; anonymous and public execution are revoked. It is not a public aggregation RPC. The
  existing Boolean helper delegates to the same authorization logic, and operators retain their
  existing policy branch.

- Six indexes support the final access paths, with one pair for each purpose:

  | Purpose                      | Settlement                                                           | Data Kiosk                                                           |
  | ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
  | Ownership to source versions | `(seller_namespace, sku, version_id)` where category is `SETTLEMENT` | `(seller_namespace, sku, version_id)` where category is not `SELBOX` |
  | Current-version lookup       | Header `current_version_id`, excluding nulls                         | Day `current_version_id`, excluding nulls                            |
  | Date and stable row identity | `(posted_date DESC NULLS LAST, id)` where category is `SETTLEMENT`   | `(activity_date DESC NULLS LAST, id)`                                |

No source or terms data is rewritten. Stored reports, source precedence, fee formulas, nullable
missing amounts, and source-row RLS are unchanged. The frontend continues to use the same REST
endpoints and queries.

## Final measurements

### Existing frontend seed through REST

The final migration was applied atomically to the existing local frontend seed on PostgreSQL port
55422, without resetting its data. The migration file remained uncommitted at this verification
checkpoint. Normal member and operator Auth sessions then repeated the frontend's REST queries,
including its 23-column transaction projection, Data Kiosk zero exclusion, and exact-count
preferences.

Median total HTTP time across three samples per case, in milliseconds:

| Request                             | Member before | Member after | Operator before | Operator after |
| ----------------------------------- | ------------: | -----------: | --------------: | -------------: |
| 25-row page + exact count           |        1868.5 |        254.8 |          1253.2 |          182.5 |
| 25-row page without count           |         946.2 |        150.1 |           638.6 |          119.9 |
| Latest-date page + exact count      |        1847.9 |        100.0 |          1235.7 |            6.9 |
| Daily currency groups + exact count |        2088.2 |        253.0 |          1300.9 |          194.3 |
| SKU choices + exact count           |        2105.9 |        251.0 |          1270.8 |          185.0 |

All 30 samples before and 30 after completed. For all ten role/query cases, response payloads and
row counts matched exactly between versions and stayed stable across repeated samples; the selected
date anchors also matched. The sanitized
[before](live_read_optimization_2026-09-19/live-http-before.json) and
[after](live_read_optimization_2026-09-19/live-http-after.json) artifacts retain timings, response
sizes, counts, and result digests without credentials or transaction values. These local HTTP
results include REST response transfer, but do not measure browser rendering or production network
latency.

### Larger fixtures and simultaneous reads

Both fixtures contain 1,032,440 source facts. Each final run completed all 66 reads with no
eight-second timeouts: 30 serial observations and 36 reads in synchronized bursts. In the original
bounded baseline, all four primary serial cases timed out for both roles in both fixtures. These
timeouts establish failure to meet that bound, not an exact elapsed time or speedup ratio.

Final serial medians across three observations, in seconds:

| Fixture | Role     | Page + count | Date filter + count | SKU filter + count | Company-amount order + count | Daily groups + count |
| ------- | -------- | -----------: | ------------------: | -----------------: | ---------------------------: | -------------------: |
| Density | Member   |        2.123 |               0.542 |              0.373 |                        2.092 |                2.069 |
| Density | Operator |        1.884 |               0.098 |              0.007 |                        1.882 |                1.976 |
| Broad   | Member   |        1.205 |               0.227 |              0.134 |                        1.185 |                1.216 |
| Broad   | Operator |        1.953 |               0.116 |              0.023 |                        2.028 |                2.065 |

Company-amount ordering is additional final coverage; it was not measured in the original bounded
baseline. The other four columns are the matched query cases. For example, the broad member's first
final page/count observation was 1.238 seconds, followed by 1.199 and 1.205 seconds. The table
reports the median rather than presenting all three observations as independent baseline
comparisons.

For each final fixture, three four-reader bursts completed 12/12 reads and three eight-reader bursts
completed 24/24 reads. The largest individual burst latency was 2.564 seconds for density and 2.001
seconds for broad. The baseline completed 1/4 and 1/8 density reads, and 0/4 and 0/8 broad reads;
the others timed out. These short batches test simultaneous requests, not sustained production load.

The [final summary](live_read_optimization_2026-09-19/final_summary.json) links these results to the
migration's SHA-256 and retains first observations, medians, ranges, and failure counts. Complete
observations are in [density results](live_read_optimization_2026-09-19/large-density-final.json)
and [broad results](live_read_optimization_2026-09-19/large-broad-final.json). All 30 available
completed reference result digests matched the final results, as recorded in the
[equivalence checks](live_read_optimization_2026-09-19/final_result_equivalence.json). Most
references are intermediate candidates because the original reads timed out; this supplements,
rather than replaces, the independent semantic tests.

## Verification and reproducibility

Browser checks on the updated local app confirmed pagination, grouped SKU choices, combined SKU/date
filtering, and unchanged day/month summaries. The dashboard was restored to its unfiltered first
page with no alerts.

The final migration passed all 103 database tests in 17.827 seconds, the schema contract, SQLFluff,
and Ruff. The security advisor reported no warnings or errors. Four pre-existing informational
findings concern private tables with RLS enabled and no policies, which deny application reads by
default.

The semantic regression compares all 24 live columns with the unchanged explicit-version resolver
using `EXCEPT ALL` in both directions. Cases cover trusted, operator, member, and unregistered
reads; identical SKUs under different sellers; reassignment and unassignment; current versus
historical source versions; all Data Kiosk categories; missing ownership/fees; exact amounts; and
filtered, ordered pages. Structural plans check that date predicates reach both source fact scans.
Existing fee, payout, publication, and access suites cover the surrounding invariants.

The [historical methodology](live_read_optimization_2026-09-19/README.md) records the isolated setup
used for these results. It restored the same private seed into disposable local databases, retained
the application database, and completed synthetic loads before measurement. Reads used
`authenticated` with member/operator claims, unchanged grants and RLS, and an eight-second statement
timeout. Current runs use the maintained benchmark guide above.

Two fixtures separate fact density from broader tenant/source inventories:

| Fixture | Source facts |                 Companies | Data Kiosk day headers | What changes                                                                                |
| ------- | -----------: | ------------------------: | ---------------------: | ------------------------------------------------------------------------------------------- |
| Density |    1,032,440 | Original seed cardinality |                  1,620 | Ten copies of each fact, preserving source versions and the tenant/SKU/date distribution    |
| Broad   |    1,032,440 |                        20 |                 16,200 | Ten copies of the complete tenant/source graph; 21 accounts and 1,290 seller-SKU identities |

The broad fixture also has 580 Settlement headers and 590 Settlement versions. Its members retain
one seed-sized company amid unrelated companies; the operator can read the whole fixture. Counts and
foreign-key inventories are verified before measurement.

Serial queries include a 25-row page with a separate exact count, date and SKU filters, monetary
ordering, and daily currency aggregates with a matching-record count. One-shot synchronized batches
of four and eight readers mix member and operator page, aggregate, and grouped-option reads. The
first final observation is compared with the single bounded baseline observation; additional final
repeats are reported separately as warm evidence. A timeout is an unsuccessful read, not a completed
eight-second result.

The larger-fixture timings use direct SQL over loopback. They exclude HTTP, CSV serialization,
network transfer to the browser, and rendering. Both sides use `plan_cache_mode=force_generic_plan`
to avoid a changing PL/pgSQL custom/generic plan during the comparison; this is a session benchmark
setting, not a deployed configuration change. PostgreSQL is 17.6, with 128 MiB shared buffers, 4 MiB
work memory, JIT enabled, and at most two parallel workers per gather.

## Limits and rollout cost

The fixtures share one local database container and its CPU, storage, and caches. Caches were not
flushed. Automatic vacuum overlapped part of the broad baseline; both fact tables were all-visible
before its later candidate runs. Background maintenance and cache state were not frozen. The broad
operator baseline and concurrent reads still timed out after that automatic maintenance had
completed.

Synthetic copying may interleave tenant rows physically. Earlier broad plans revisited many heap
pages through version-based scans; append-per-version imports may have different locality, which is
not guaranteed by this schema. The fixtures preserve the seed's per-tenant dates and value
distributions. They do not model every production distribution or establish sustained throughput,
capacity, or a latency guarantee for larger histories.

Whole-history aggregates, exact counts, and monetary ordering still need to process their matching
rows. At this checkpoint, frontend counts were reused for 30 seconds. The later progressive-count
implementation instead retains financial counts until relevant revision invalidation and loads them
separately from the page. Grouped results can reduce requests and transfer without eliminating
aggregation work. Multi-page reads remain live estimates; matching counts do not guarantee an atomic
cross-page snapshot.

At this checkpoint, six ordinary `CREATE INDEX` operations added storage and future write
maintenance, and their builds blocked writes on the indexed tables. Those final indexes are now part
of the canonical source-schema module. This dated record is not an instruction to replay the retired
incremental migration or reset an existing database.

Other tested alternatives were omitted from the final change: uniform UNION casts and an explicit
own-company REST predicate did not produce a useful measured improvement. A wide financial covering
index would make valid unbounded text and exact numeric inputs vulnerable to B-tree tuple-size
limits. Index order was selected with the final authorization and join structure rather than from an
isolated earlier candidate.
