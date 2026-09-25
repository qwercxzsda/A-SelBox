# Current transaction queries: one-million-row verification

Measured September 25, 2026, after the page/count query and index optimization. The
[current read modules](../../../services/db/supabase/README.md#schema-modules) now contain the
canonical definitions. These measurements exercised the installed REST endpoints, including the
native marketplace arguments and ascending-date indexes. There are no benchmark-only query
implementations.

The later
[fee-filter page contract](../../../services/db/supabase/migrations/20260925065535_transaction_page.sql)
removes reported-amount ordering and adds fee-applicability filtering. The measurements below
predate that API change and all use date ordering; they do not measure the new fee-filtered cases.

## Default newest-first page

Median local HTTP latency in milliseconds for 25 rows, one warm-up and five measured requests per
case:

| Fixture | Account       | Rows ready, before → after | Rows and exact count ready, before → after |
| ------- | ------------- | -------------------------: | -----------------------------------------: |
| Density | Company user  |        1,098.3 → **182.9** |                        2,102.4 → **484.5** |
| Density | Administrator |            920.2 → **6.5** |                        1,621.6 → **168.4** |
| History | Company user  |        1,181.1 → **231.5** |                        2,242.6 → **571.0** |
| History | Administrator |            935.3 → **8.8** |                        1,681.6 → **172.8** |

The count request starts after the rows arrive, matching the frontend when its count cache is empty.
“Rows and exact count ready” measures elapsed time from the page request's start; it already
includes the row request. Each column is a separate median, so rounded medians need not sum exactly.
Cached counts are reused across page and sort changes until the relevant revision changes. The table
can display its rows while an uncached exact count is still running.

[Before](before.json) and [after](after.json) contain individual samples, response sizes, digests,
fixture metadata, settings, catalog fingerprints, and cleanup checks. The before run already had the
ascending indexes and enum-array RPC arguments; the measured difference is the integrated page/count
rewrite and replacement Settlement index.

## Final history-fixture cases

All values are median milliseconds. Filtered cases use newest-first ordering.

| Account       | Query                     | Rows ready | Count request alone | Rows and count ready |
| ------------- | ------------------------- | ---------: | ------------------: | -------------------: |
| Company user  | Newest first              |      231.5 |               338.9 |                571.0 |
| Company user  | Oldest first              |      181.2 |               335.0 |                516.9 |
| Company user  | One marketplace           |      230.3 |               330.8 |                561.7 |
| Company user  | Latest ten calendar dates |      229.0 |               118.5 |                347.5 |
| Administrator | Newest first              |        8.8 |               163.8 |                172.8 |
| Administrator | Oldest first              |        9.2 |               164.6 |                174.0 |
| Administrator | One marketplace           |        9.5 |               115.0 |                124.5 |
| Administrator | Latest ten calendar dates |        9.4 |                 6.9 |                 16.3 |

## What changed

1. `transaction_page` filters each source's facts and takes at most `offset + limit` eligible
   candidates before projecting metadata and ownership or resolving fees. It merges those
   candidates, selects the global page with stable source/UUID ties, and calculates fees only for
   that page. All eligibility filters apply before the source limits. The bound limits candidates
   returned, not how many source rows PostgreSQL may examine to establish eligibility.
2. `transaction_count` counts eligible facts directly. It does not project metadata or calculate
   fees. A combined page/count request delegates to that same count implementation within one SQL
   statement.
3. The count function computes whether current-version membership is already guaranteed by member
   fact RLS before planning its SQL. With its existing custom-plan setting, that Boolean is known
   when PostgreSQL plans the query. The duplicate lookup is omitted only for authenticated
   non-operators while the relevant fact table's RLS is active. Other roles keep explicit
   current-version checks. This depends on the existing policy contract and must be revalidated if
   those policies change.
4. The Settlement owner/version index now has trailing `category` and `marketplace_name` keys:

   ```sql
   create index settlement_transactions_owner_version_idx
   on private.settlement_transactions
       (seller_namespace, sku, version_id, category, marketplace_name)
   where category = 'SETTLEMENT';
   ```

   It replaces the former three-key index; there is no duplicate retained index. In the isolated
   history test, the Settlement fact read changed from an Index Scan to an Index Only Scan. Guard
   planning plus this index reduced member exact-count SQL from 928.1 to 325.3 ms and operator count
   SQL from 721.8 to 158.6 ms, with identical results; restoring the baseline reproduced the slower
   timings. These isolated SQL timings are separate from the final HTTP table above.
   [Guard planning](count-plan-comparison.json) and [index comparison](count-index-comparison.json)
   preserve the samples and sanitized plans. The candidate index occupied 5,824,512 bytes (5.55 MiB)
   on that million-row fixture. On the seed, the replacement increased the index by 8 KiB.
   Import/write overhead for this replacement was not measured.

5. Summary latest-date discovery uses the shared current page RPC with one row and counting
   disabled, retaining only the company/SKU/marketplace scope. It no longer sorts the complete live
   view just to discover a date. At this checkpoint, period sums used bounded REST aggregate
   requests; the later dedicated aggregation RPCs replaced that path.

Table definitions, RLS policies, ownership semantics, exact financial calculations, and saved
payouts remain unchanged. Native enum comparisons, exact decimal strings, zero-amount Kiosk
exclusion, null diagnostics, and optional-count behavior remain part of the API contract.

## Cleanup and validation

The unused Boolean source-version compatibility helper and
[24 superseded experiment files](cleanup-manifest.json) were removed. The
[maintained benchmark package](../../../services/db/supabase/benchmarks/README.md) calls installed
RPCs and contains no alternate page/count SQL. Sanitized measurements remain historical evidence;
migration definitions were subsequently consolidated into the canonical fresh baseline. The complete
live view remains necessary for text search and Company amount ordering; dedicated RPCs now serve
summaries/options, and the explicit-version resolver remains necessary for payouts.

- [Initial local application](application.json): 68 exact before/after comparisons across two
  company members, an operator and an account without application access; preserved security
  configuration.
- [Final count/index application](application-final.json): 24 additional exact comparisons,
  unchanged table/access rules and a valid, ready replacement index.
- All 27 page/count/live-equivalence database regression tests passed with the final migration,
  including filters before limits, source-ID collisions, version replacement and ownership changes.
- A real PostgREST scenario passed 46 requests after the query rewrite; the final index/planning
  refinement was then covered by the database regressions and the complete HTTP benchmark.
- Frontend formatting, lint, unit tests, TypeScript/production build and 116 Playwright tests
  passed. SQLFluff and Python formatting/lint checks passed for the affected code.
- Both benchmark copies and temporary REST servers were removed. Private dump/environment files were
  removed. Source and clone catalog fingerprints remained unchanged during measurement.

## Scope and limitations

Each fixture has **1,032,440 source facts**: 737,330 Settlement and 295,110 Data Kiosk rows,
including historical/ineligible facts. It retains two companies and 129 seller/SKU identities.
Density multiplies facts within existing versions. History creates ten dated cohorts spanning
2017–2026, with source headers and fee coverage moved consistently. This is repeated seasonal seed
data, not continuous daily coverage over ten years or a many-tenant production workload.

PostgreSQL 17.6 and PostgREST v16.2 run locally through Docker, with 128 MiB shared buffers and 4
MiB work memory. Clones were vacuumed and analyzed; fact heap pages were all-visible at the measured
checkpoint. Index-only benefits can be smaller immediately after imports before vacuum catches up.
The runs include local HTTP and JSON decoding but exclude the gateway, Auth, browser rendering,
simultaneous summary requests and production network latency. They use warm database/OS caches,
sequential requests and an empty frontend count cache, not sustained concurrent load or p95
estimates.

Member authorization still constructs permitted current-version sets, which explains much of its
remaining startup cost. Exact counts still inspect every qualifying entry. Deep offsets,
fee-dependent sorting, cold caches and simultaneous imports/readers need separate capacity tests.
These results establish a faster current implementation, not a production latency guarantee.
