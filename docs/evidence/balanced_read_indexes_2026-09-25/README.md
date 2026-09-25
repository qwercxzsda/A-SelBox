# Balanced financial read indexes — September 25, 2026

The final set uses **nine dedicated fact-table read indexes**: four on Settlement facts and five on
Data Kiosk facts. Required primary/unique indexes, fee-period exclusion indexes, current-source
pointers, acquisition/batch indexes, and payout-retention indexes are unchanged. Query functions,
tables, access rules and financial behavior are unchanged.

## Final index set

`date` below means `posted_date` for Settlement and `activity_date` for Data Kiosk. All listed
B-trees use their normal ascending order. Date pages reverse date/source/ID together for backward
scans; the compact filter indexes do not need to provide the complete page order.

| Source     | Indexed keys                                                                                      | Why it remains                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Both       | `(date, id)`                                                                                      | Newest/oldest pages and date-bounded reads. Settlement now covers every category, fixing raw administrator pages without a second date index. |
| Both       | `(sku, date)`                                                                                     | Exact SKU pages/counts and selected-SKU summaries. The UI does not supply seller namespace, so SKU is the useful leading key.                 |
| Both       | `(component_type, date)`                                                                          | Sparse Type filters, including Type-only reads over all history.                                                                              |
| Settlement | `(seller_namespace, sku, version_id, category, marketplace_name)` where `category = 'SETTLEMENT'` | Existing compact ownership/current-version checks, exact counts, and option discovery.                                                        |
| Data Kiosk | `(seller_namespace, sku, version_id)` where `category <> 'SELBOX'`                                | Existing company-member authorization/current-version inventory.                                                                              |
| Data Kiosk | `(marketplace_name, date)`                                                                        | Privileged backend financial reads, including empty and nonempty declared Kiosk scopes.                                                       |

Removed both old `(seller_namespace, sku, date)` indexes and the Settlement marketplace/date index.
The Settlement date/ID index was broadened in place conceptually; locally it was recreated from the
canonical baseline. SKU and Type filters retain compact date keys rather than unique ID tails. The
measured ID-tail alternatives consumed much more space with little benefit on the tested reads.
Duplicate-key compression is an important part of the smaller keys' value; see PostgreSQL's
[B-tree deduplication](https://www.postgresql.org/docs/17/btree.html#BTREE-DEDUPLICATION).

Canonical definitions are in
[live_source_versions](../../../services/db/supabase/migrations/20260912072531_live_source_versions.sql).
Installed-read callers and filter semantics are documented in the
[query contracts](../../transaction_query_contracts.md).

## Comparison method

[Main evidence](performance.json) records ten pilot index sets and three repeated finalists:
baseline, lean, and balanced. The guarded History clone contained **1,032,440 source facts**:
737,330 Settlement and 295,110 Data Kiosk, spread across ten shifted seasonal cohorts (2017–2026).
It is not a continuous daily ten-year dataset or a production concurrency simulation.

Every optional set, including baseline, was freshly rebuilt after the fixture load. Storage savings
therefore do not count old index fragmentation as a design improvement. Each pilot used one warmup
and one measured repetition. Finalists used one warmup and three measured repetitions, with case
order rotated/reversed. Installed RPCs, roles, RLS, fact rows and financial calculations were the
same throughout. Every response and exact decimal string matched the baseline, including counts.

The 40 main actor/query cases cover newest/oldest pages on all three tabs, common/rare SKU scopes,
multiple selections, marketplace filters, date/text/Type combinations, counts, selected-SKU totals,
current-version authorization, and the maintained privileged financial-progress call. Counts are
recorded separately; repeated identical count scopes are not treated as additional user demand.

[Supplemental guardrails](guardrails.json) compare all three finalists on thirteen additional cases:
unfiltered day/month totals, latest-date discovery with limit 1, administrator company selection,
oldest-first common-SKU pages, offset 10,000, and Type-only filters. They use one warmup and three
measured repetitions. These checks were sequential on the same clone after the main finalists.

The first two attempts stopped in the benchmark's size-reporting code because a psycopg SQL-format
placeholder was not escaped. They restored/dropped their clones and are excluded from performance
claims. The corrected complete run and all supplementary checks used ordinary planner choices; no
index scan was forced.

## Storage and selected read results

| Variant  | Optional indexes (MiB) | All fact indexes (MiB) | Exact main cases |
| -------- | ---------------------: | ---------------------: | ---------------: |
| baseline |                  60.37 |                 216.17 |               40 |
| lean     |                  51.45 |                 207.26 |               40 |
| balanced |                  60.12 |                 215.93 |               40 |

| Role     | Query                          | Baseline page / count (ms) | Balanced page / count (ms) |
| -------- | ------------------------------ | -------------------------: | -------------------------: |
| member_a | live/newest                    |              217.9 / 315.6 |              214.9 / 323.2 |
| member_a | live/oldest                    |              172.7 / 314.5 |              169.9 / 316.3 |
| member_a | settlement/newest              |              433.8 / 278.2 |              114.7 / 289.2 |
| member_a | data_kiosk/newest              |              103.4 / 166.3 |               98.1 / 165.5 |
| member_a | live/single_sparse_sku         |               171.4 / 61.7 |               161.9 / 53.5 |
| member_a | live/multiple_skus             |              224.1 / 169.5 |              214.8 / 161.9 |
| member_a | live/sku_date_literal          |              222.1 / 112.5 |              219.8 / 111.7 |
| member_a | live/sparse_type_date          |               123.6 / 61.5 |               118.9 / 59.5 |
| member_a | live/single_sparse_marketplace |             2223.7 / 321.1 |             2225.1 / 314.6 |
| operator | live/newest                    |               10.1 / 155.7 |                9.5 / 159.3 |
| operator | live/oldest                    |                9.2 / 155.1 |                8.6 / 154.9 |
| operator | settlement/newest              |              322.0 / 155.9 |                5.2 / 157.2 |
| operator | data_kiosk/newest              |                 4.7 / 75.2 |                 4.7 / 77.0 |
| operator | live/single_sparse_sku         |                17.4 / 11.8 |                  6.9 / 3.6 |
| operator | live/multiple_skus             |                 9.8 / 49.3 |                 9.6 / 41.5 |
| operator | live/sku_date_literal          |                 10.8 / 7.0 |                 12.7 / 8.4 |
| operator | live/sparse_type_date          |                  9.5 / 4.7 |                  6.1 / 3.9 |
| operator | live/single_sparse_marketplace |              513.1 / 110.1 |              515.4 / 110.8 |

The balanced set's tunable indexes use **60.12 MiB**, versus **60.37 MiB** for baseline. These
numbers exclude unchanged ownership/version and mandatory indexes; including every fact-table index
gives **215.93 MiB versus 216.17 MiB**. There is one more dedicated read index overall (nine versus
eight), but broader useful coverage with essentially the same total footprint.

Type-only guardrails make the compact Type indexes worthwhile. For a company member, page/count
latency changed from roughly **1,805/483 ms to 120/59 ms**; for the administrator, **1,706/647 ms to
7.6/3.9 ms**. The lean alternative saved about 8.7 MiB further by omitting those indexes, but left
this path slow. ID-tailed alternatives were rejected: the paired SKU/date/ID family raised total
tunable storage to **98.08 MiB**, and Type/date/ID to **111.81 MiB**, with little sparse-case
benefit relative to compact variants.

Default company Transactions pages remain around **215 ms** in this local workload. Exact counts
still process the complete matching scope. The raw Settlement page improves substantially because
its previous all-category scan could not use the category-limited date index.

There are measured trade-offs. Unfiltered monthly totals increased from approximately **155 to 175
ms** for the member and **78 to 97 ms** for the administrator in the supplemental comparison. Deep
pages stayed comparable, around **400 to 390 ms** for the member and **216 to 207 ms** for the
administrator. These are warm, sequential local medians, not production latency guarantees.

## Why the retained indexes have separate jobs

Diagnostic plans in the main artifact show each compact SKU/date index in selective pages/counts;
Kiosk's also helps selected-SKU summaries. Both Type/date indexes serve sparse Type requests. The
two date/ID indexes serve chronological pages. [Inner authorization plans](owner-version-plans.json)
show both unchanged ownership/version indexes in the member version inventory.

The Data Kiosk marketplace/date index has a different purpose.
[Backend plans](backend-market-plan.json) and a [fresh-connection backend probe](backend-probe.json)
show it avoiding work in both an empty Kiosk branch and a valid nonempty declared Kiosk day. A
selected compact SKU/Type set without it took about **193 ms** for the Settlement backend scope and
**13.1 ms** for the Kiosk scope; retaining it reduced those to about **34.1 and 3.7 ms**. This probe
uses three warmup pairs and three measured pairs per variant, because those private routines have
plan-cache-sensitive behavior. Its absolute timings should not be compared to the separate main
backend samples as though they were the same warmup protocol. The earlier shared-connection
exploratory probe was superseded and is not included.

No authenticated UI plan in this experiment selected a marketplace candidate. Installed PostgreSQL
17.6 marks `enum_eq` non-leakproof; the predicates can remain behind fact RLS. The sparse
marketplace case therefore remains around **2.23 seconds** for the member and **515 ms** for the
administrator. This is an unresolved query/security-barrier limitation, not evidence that a larger
marketplace index will fix it. No RLS, leakproof flag, enum type or function was changed. Arbitrary
substring search likewise has no new index. Amount ordering keeps its existing 10,000-match cap.

## Insert cost

[Write-cost evidence](write-cost.json) uses identical rows in logged clone-only scratch tables with
row/domain checks and all baseline/selected fact indexes, including mandatory unique keys. Each case
seeds 20,000 rows, then measures insertion of 5,000 further rows. One warmup precedes three measured
repetitions, alternating variant order. Foreign-key lookups, source publication triggers, network
transfer and importer work are excluded: this measures isolated index maintenance, not end-to-end
import throughput.

| Source     | Baseline insert (ms) | Balanced insert (ms) | Change | WAL change |
| ---------- | -------------------: | -------------------: | -----: | ---------: |
| Settlement |               37.151 |               37.693 | +1.46% |     +1.06% |
| Data Kiosk |               42.179 |               44.822 | +6.27% |     +3.52% |

The modest insert overhead is accepted for the measured read improvements and unchanged overall
index footprint. Scratch tables were removed before releasing the benchmark clone.

## Application and regression checks

[Local application](application.json) changed only the reviewed optional fact indexes. Eighteen
before/after page, exact-count and day-total responses matched under member/administrator roles.
Catalog comparisons preserve all tables, columns, constraints, functions, policies, grants,
triggers, other indexes and types. Source fact counts and migration history are unchanged. The
undeployed canonical migration now contains only the final definitions.

[Validation](validation.json) records **183 database tests** and **three real Auth/PostgREST
suites** passing, including precision, both date directions, pagination, search, native enum
filters, company isolation, revoked access, publication inventories, payout retention and sync
integration. SQLFluff, Ruff, strict Pyright and formatting checks pass.
[Security advisors](advisors.json) reported the same three previously reviewed scalar-helper
warnings and no new warnings. No frontend runtime change was needed. All benchmark clones, temporary
REST servers, private dumps and scratch schemas were removed.

Use the maintained [index benchmark guide](../../../services/db/supabase/benchmarks/README.md) for
future workload-based reevaluation. Index use depends on actual data and filters; the selected set
is justified by these cases, not claimed to be a universal optimum for every future distribution.
