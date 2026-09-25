# Progressive transaction counts — 2026-09-23

**Historical measurement record.** The timings, plans, and validation counts below describe the
implementation tested on this report's date. They are not measurements of the current
[page/count implementation](../../transaction_query_contracts.md). Superseded experiment scripts
have been retired; use the
[maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for new runs.

This experiment compares the **then-current `transaction_page` RPC with its count included** against
delivering its rows first and requesting the exact count separately. The baseline already chooses
the page before fee calculation and shares eligible rows with its count; this is not a comparison
against the older fee-heavy view.

## Result

Delivering rows first materially reduces the default table's waiting time, especially at one million
source facts. It does **more total database work on a cache miss**. The count arrives later, and the
benefit is small or absent for some narrowly filtered member queries.

Medians of four measured repetitions after one warm-up, through actual PostgREST HTTP:

| Workload / role                               | Combined: rows and count | Deferred RPC: rows ready | Deferred RPC: count ready | Earlier rows |
| --------------------------------------------- | -----------------------: | -----------------------: | ------------------------: | -----------: |
| 103,244 facts / member / default              |                   173 ms |                   139 ms |                    267 ms |          20% |
| 103,244 facts / administrator / default       |                   157 ms |                    92 ms |                    172 ms |          42% |
| 1,032,440 facts / member / default            |                 1,483 ms |                 1,163 ms |                  2,225 ms |          22% |
| 1,032,440 facts / administrator / default     |                 1,528 ms |                   997 ms |                  1,796 ms |          35% |
| 1,032,440 facts / member / date filter        |                   374 ms |                   368 ms |                    687 ms |           2% |
| 1,032,440 facts / administrator / date filter |                   119 ms |                    77 ms |                    130 ms |          35% |

The date filter is September 1–10, 2026, inclusive. First-row time is when the full 25-row response
has arrived and parsed, not a browser paint measurement. The count starts **after** that event for
deferred methods.

All 200 request scenarios produced identical rows and exact counts across five methods. Each
dataset/role/filter/method has one warm-up plus four measurements. Method order rotates to reduce
cache/order bias. The 1,032,440-fact fixture duplicates every source fact tenfold with new row
identities, preserving date/SKU/company/source-version distributions; it is a volume test, not a
realistic growth in tenant cardinality.

## Database cost

| Default workload              | Combined DB execution | Deferred RPC DB execution | Change |
| ----------------------------- | --------------------: | ------------------------: | -----: |
| Seed / member                 |                165 ms |                    250 ms |   +52% |
| Seed / administrator          |                138 ms |                    144 ms |    +4% |
| Million facts / member        |              1,472 ms |                  2,208 ms |   +50% |
| Million facts / administrator |              1,518 ms |                  1,778 ms |   +17% |

These are differences in `pg_stat_statements` top-level execution totals for the specific clone and
authenticated role, sampled around each scenario without resetting global statistics. They include
PostgREST's small per-request configuration statements. They are elapsed backend execution time
summed across requests, **not CPU time**. Buffer references approximately double because both
requests establish source eligibility and ownership independently. PostgreSQL shared-buffer reads
may hit the operating-system cache; they are not necessarily physical disk reads.

The combined RPC used in this experiment avoided that duplicate eligibility pass by materializing
matching rows for its page and count. On the million-row default queries this wrote about 12,306
temporary blocks for the member and 23,398 for the administrator. The separated requests did not
write temporary blocks in these measurements, but their repeated scans still consumed more aggregate
execution time.

For the million-row member date-filtered case, deferred rows barely improve while database execution
rises from 356 to 653 ms. This prevents claiming that separation is a universal speed or throughput
improvement.

## Count endpoint and scheduling

The retired benchmark-only `bench_transaction_count` function counted
`private.live_company_component_inputs` under existing RLS. It accepts
date/company/SKU/marketplace/source/type filters, excludes zero Data Kiosk amounts, and returns an
exact decimal string. It avoids fee resolution, sorting, page materialization, and transmitting
transactions. The same null/empty-array and validation behavior as the page RPC is retained. The
endpoint is security invoker and uses a custom plan for optional predicates.

An ordinary `HEAD` request to the full live view with `Prefer: count=exact`, `select=source_row_id`,
and `limit=0` also works. It is generally somewhat slower because the view still includes
fee-resolution work. On the million-row default member case, deferred HEAD completed at 2,487 ms
versus 2,225 ms for the dedicated count RPC; for the administrator, 2,058 versus 1,796 ms.

Running rows and counts **in parallel** can finish both sooner on this lightly loaded local
database, but competes with the rows and still repeats eligibility work. For the million-row member
default, parallel RPC delivered rows at 1,167 ms and accumulated 2,295 ms of database execution,
versus deferred rows at 1,163 ms and 2,208 ms of execution. On filtered member queries parallel work
made first rows slower. It is not the preferred design for prioritizing table responsiveness under
multi-user load.

Implemented behavior:

1. Request rows without an exact count.
2. Reuse a cached exact count for the same user/company/dataset/filters; sorting and page changes do
   not alter that count.
3. When a count is missing or invalidated, start the count only after rows settle.
4. Invalidate counts when the relevant source/ownership/fee revision changes; avoid expiring a
   still-valid count solely because the user changed pages later.
5. Keep free-text searches, which may inspect fee resolution status, on the full-view count path. Do
   not apply those filters after counting the cheaper input view.

This improves perceived latency while count caching and selective revision invalidation amortize the
extra work. It does not make the first uncached interaction cheaper for the database.

## Implementation verification

Migration `20260922172509_count_transactions_without_fees.sql` initially installed the
`transaction_count` RPC with the benchmarked filtering, validation, invoker security, and
custom-plan behavior. It was applied atomically to the existing local frontend database on port
55422, without a reset. The security advisor reported no warnings or errors at that checkpoint.

The frontend observes counts independently from rows, starts missing/invalidated counts only after
row success, and reuses them across sorting and pagination. Financial counts stay fresh until
revision invalidation; administrative counts retain 30-second freshness. Previous/Next and row
details work while counting; page-number entry waits for an exact bound. A failed count has its own
Retry action and does not remove or block table rows. The count status reserves space.

Race checks cover cancelled/old-scope counts, publication invalidation, immediate row refetches
within a React batch, cached counts contradicted by growth, empty pages after shrinkage, and a newly
received count contradicting a displayed page. Rows and counts are separate live snapshots rather
than one atomic report.

Validation passed 131 database tests, 104 frontend unit tests, and 115 Playwright browser tests,
including layout stability at 320px and 1280px. Formatting, lint, type checks, and production build
pass; the existing bundle-size advisory remains.

## Historical execution controls

The run restored a mode-0600 local seed dump only into allowlisted disposable clones. Its temporary
loopback PostgREST server used a fresh synthetic JWT secret and cloned account IDs; it did not log
into the source application. Source definitions and retained observations were unchanged. The server
stopped after the run. Local cache/settings, Docker overhead, four measured repetitions, synthetic
density and absence of sustained load limit production generalization.

[Seed](aselbox_opt_seed-results.json) and [density](aselbox_opt_large-results.json) JSON retain
samples and result hashes; [workload.json](workload.json) records fixture setup. The old
benchmark-only count function and setup/query scripts are retired. The current count RPC reads
eligible facts directly, so these old timings do not describe its current implementation.

## Retained evidence and current verification

The dated JSON observations, result hashes, plans, fixture metadata, and limitations remain as the
record of this experiment. Superseded executable query candidates and their old reproduction
commands have been removed. Running today's implementation is a new measurement, not an exact
reproduction of the historical schema and query bodies.

Use the [maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for current
RPC verification on disposable local databases. Preserve the recorded evidence and write new results
to a separate path; retain no raw financial rows, credentials, or private dumps.
