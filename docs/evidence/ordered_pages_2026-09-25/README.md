# Ordered transaction pages: current-schema query experiments

**Historical measurement record.** The timings, plans, and validation counts below describe the
implementation tested on this report's date. They are not measurements of the current
[page/count implementation](../../transaction_query_contracts.md). Superseded experiment scripts
have been retired; use the
[maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for new runs.

This experiment tested changing where the query chooses its page. With the existing tables, indexes,
RLS policies, helpers, and grants, selecting eligible source facts before joining their metadata
substantially reduced the cost of the default date-ordered page. A new transaction projection or
schema redesign is not required to obtain this improvement.

On the multi-year fixture, the first 25 transactions took a median **1,088.7 → 301.9 ms for a
company member** and **884.8 → 3.3 ms for an operator**. These are local SQL request measurements
with the same JSON result, authenticated role, and eight-second statement timeout. They exclude HTTP
and browser work. They are historical query-experiment results, not current end-to-end timings or a
throughput guarantee.

Date ordering is the highest-priority path because it is the default table view. The experiments
also expose important limits: member authorization still scales with history, selective date ranges
sometimes gain little, and ascending or deep-offset pages need separate attention.

## Implementation follow-up, September 25

The ascending-date indexes were subsequently installed; their canonical definitions now live in
[the source-schema module](../../../services/db/supabase/migrations/20260912072531_live_source_versions.sql).
[Application verification](ascending-index-application.json) records the index-only checkpoint; the
measured query rewrites had not yet been installed at that point.

The
[native marketplace page contract](../../../services/db/supabase/migrations/20260925065535_transaction_page.sql)
records both RPC marketplace arguments as enum arrays, rejecting unknown labels. The historical
candidate results below used the earlier text-array contract; its unknown-label behavior is not the
current API contract.

The [current read modules](../../../services/db/supabase/README.md#schema-modules) select eligible
facts per source before metadata/ownership projection and fee resolution, use native marketplace
filters and the guarded current-policy check, and count eligible facts directly. Optional page
counts call the same typed count RPC. Existing RLS and financial semantics remain; the unused
Boolean source-version compatibility helper is removed. The complete live view still serves text
search and Company amount ordering, and the payout resolver remains active. Dedicated
summary/options RPCs have since replaced generated REST aggregation. The measurements below remain
the separate experiments that motivated that implementation. The
[final installed-RPC report](../current_transaction_queries_2026-09-25/README.md) includes the
subsequent count-plan refinement, replacement covering index and actual REST timings.

## Scope and controls

The benchmark uses disposable databases in the existing local Supabase container, reached through
`127.0.0.1:55422`. The source `postgres` database is read to make a private dump; its application
data and definitions are not changed. Fixture generation changes only the explicitly named clones.
No benchmark query creates or replaces a function, view, policy, or index. Optional index
experiments are a separate stage described below.

Every measured query:

- Runs in a read-only transaction as `authenticated`, with the same JWT claim setup for the chosen
  existing application account.
- Uses an eight-second statement timeout, `plan_cache_mode=force_custom_plan`, and disabled psycopg
  automatic preparation. No planner scan or join methods are disabled.
- Returns the unchanged 23-column transaction row contract, with exact decimal strings and
  `total_count: null`. Counts are deliberately outside this page-only comparison.
- Uses the same company, SKU, marketplace, source, type, and date filters; current source versions;
  current ownership and fee terms; and zero-amount Data Kiosk exclusion.
- Is checked against the baseline JSON payload, including row order and nulls. A mismatch fails the
  run. Artifacts retain result hashes and row counts, not the financial rows or account/filter
  identifiers.

The completed serial runs have one discarded warm-up and three measured samples per method, role,
and case. Method order rotates between iterations. Clones were vacuumed and analyzed before the
recorded runs, then queried with warm database and OS caches. The recorded source fact relations
were entirely all-visible in their catalog estimates. This is a favorable read-heavy condition; it
does not simulate concurrent imports, cold storage, or an actively changing visibility map.

PostgreSQL settings were identical across the reported runs: PostgreSQL 17.6,
`shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=128MB`, JIT enabled, up to two
parallel workers per gather, and `random_page_cost=4`. These are this local environment's settings,
not proposed production settings.

The serial timer measures executing and fetching the SQL result, including the JSON construction
shared by the baseline and candidates. Connection creation, transaction/role setup, HTTP, login,
network traversal, and frontend rendering are excluded. `EXPLAIN ANALYZE` times are separate
instrumentation samples and must not be substituted for these request medians. Earlier HTTP
page/count evidence therefore cannot be directly compared as if it used the same measurement
boundary.

Each completed run records equal before/after catalog fingerprints covering application relations
and view options, columns/defaults, constraints, index definitions and validity, functions and
grants, policies, triggers, and types. Candidate SQL and its experiment drivers have been retired
after integration; the JSON retains each method label, controls and result metadata. Current
executable verification lives in the maintained benchmark package linked above.

## Six historical methods

| Method                        | What changes from the existing page query                                                                                                  | Interpretation                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline`                    | Calls the unchanged `public.transaction_page`, with exact count disabled.                                                                  | Reference behavior and timing.                                                                                                                            |
| `source_topn`                 | Limits each fully eligible source to `offset + page_size`, then merges and selects the global page.                                        | Tests whether a source-level limit alone is sufficient. Metadata and ownership joins still precede each source limit.                                     |
| `sku_lateral`                 | For members, requests candidates separately for each owned seller/SKU pair before the global merge. Operators use source-level candidates. | Tests a membership-first access shape. The seed results do not justify this path as the general default.                                                  |
| `source_topn_deferred_joins`  | Selects eligible fact candidates per source, then chooses the global page, then joins source metadata/current terms and resolves fees.     | The principal improvement, using existing date indexes.                                                                                                   |
| `deferred_native_marketplace` | Adds a native marketplace-enum comparison to deferred joins.                                                                               | Avoids the text comparison on the fact column. Unknown labels still match no rows; they are not converted into an unfiltered query or an enum-cast error. |
| `deferred_rls_current`        | Omits a duplicate explicit current-version check only for authenticated non-operators while source-table RLS is active.                    | Relies on the reviewed current member policy already enforcing the same restriction. Other execution contexts retain the explicit check.                  |

The last two methods are independent refinements of `source_topn_deferred_joins`; their measurements
do not represent a combined implementation.

These experiment templates compared valid requests and result semantics, not the entire RPC's error
contract. The integrated implementation preserves validation and authenticated REST/RPC access, uses
the dedicated typed count RPC, and keeps the complete-view path for calculated sorts and text
search. The browser never executes the experiment SQL.

For a first page of 25 rows, the deferred query asks each source for at most 25 eligible candidates,
merges at most 50 candidates, and performs the metadata/fee work for the selected 25. For offset
2,500, each source can instead produce 2,525 candidates. These bounds describe intermediate output,
**not** how many facts, ownership rows, or source headers PostgreSQL must inspect to establish
eligibility.

The global order remains the requested date or source amount, followed by source and source-row UUID
in ascending order; null sort values remain last. A source's row below its own first
`offset + page_size` candidates cannot enter that global page. Company filtering, current-version
eligibility, and the source RLS checks remain before candidate selection. This is essential: taking
25 arbitrary source rows and then applying authorization or company filters could produce an
incorrect short page.

The current-policy refinement needs an explicit maintenance condition. The
[member fact policies](../../../services/db/supabase/migrations/20260914094640_application_access.sql)
require both an owned seller/SKU and membership in the source headers' `current_version_id` set. The
query checks `current_user = 'authenticated'`, active row security on the fact table, and
non-operator status before relying on that policy. The guard checks the execution context; it does
**not** prove the meaning of an arbitrary future policy. A policy change requires renewed proof and
semantic tests. Operators, owners, and bypass contexts must retain the independent current-version
restriction because their fact visibility can include history.

## Fixtures and their limits

| Fixture                        | Settlement facts | Data Kiosk facts | Settlement headers | Kiosk day headers | Companies / seller-SKUs | Purpose                                                                                                   |
| ------------------------------ | ---------------: | ---------------: | -----------------: | ----------------: | ----------------------: | --------------------------------------------------------------------------------------------------------- |
| Seed, `aselbox_opt_seed`       |           73,733 |           29,511 |                 58 |             1,620 |                 2 / 129 | Existing representative local data.                                                                       |
| Density, `aselbox_opt_large`   |          737,330 |          295,110 |                 58 |             1,620 |                 2 / 129 | Ten times as many facts at the same dates and dimensions.                                                 |
| History, `aselbox_opt_broad`   |          737,330 |          295,110 |                580 |            16,200 |                 2 / 129 | Ten shifted seasonal cohorts spanning 2017–2026, including ten times as many source headers and versions. |
| Tenants, `aselbox_opt_tenants` |          737,330 |          295,110 |                580 |            16,200 |              20 / 1,290 | Ten source/dimension graphs with separate companies and seller namespaces at the seed dates.              |

The [density workload](workload.json) copies source facts while retaining seed-sized date,
source-version, SKU, and company cardinalities. It is a volume test, not evidence of scaling across
years or many companies.

The separate [history workload](history-workload.json) shifts the complete source graph in 366-day
steps. Settlement fact dates span 2017-05-27 through 2026-09-08, with 980 distinct days; Data Kiosk
dates span 2017-06-09 through 2026-09-13, with 900 distinct days. This is ten seasonal windows,
**not continuous daily coverage over ten years**. It retains complete empty days and obsolete source
interpretations: 2,700 empty day versions and ten obsolete Settlement versions after expansion.

History generation retains the two companies, account membership, seller/SKU ownership, original fee
revisions, and frozen payout references. New selected fee revisions extend each marketplace's
earliest configured rate backward to cover the synthetic history. Foreign keys/current identity
pairs, source/batch/fee inventories, fee exclusions, source/header identity, and unchanged ownership
are checked before commit. Trigger suppression is transaction-local and normal trigger execution is
restored before authenticated measurements. Raw JSON/archive references are copied rather than
reconstructed, so this is not an archival replay validation. Fixture revision tokens are not a test
of live polling; measurements use fresh reads.

The [tenant workload](tenant-workload.json) instead copies the complete source/dimension graph into
nine additional synthetic tenant namespaces. It has 20 companies and 21 application accounts,
including non-login test members, with each company retaining a seed-sized history. Its purpose is
to test sparse membership in a larger set of owners, which neither of the two-company scale fixtures
demonstrates. Dates and value distributions remain seed-like; it does not combine 20 companies with
ten years of history. Fixture construction checks all public/private foreign keys and unpruned
inventories, and the before/after catalog fingerprints remain equal.

## Completed date-page results

Medians in milliseconds; three measured samples per cell, no SQL errors in these runs. Each row
compares methods on the same fixture and role.

| Fixture / role     | Existing RPC | Deferred metadata joins | Reduction |
| ------------------ | -----------: | ----------------------: | --------: |
| Seed / member      |      102.324 |                  41.509 |     59.4% |
| Seed / operator    |       65.630 |                   3.822 |     94.2% |
| Density / member   |    1,013.352 |                 238.535 |     76.5% |
| Density / operator |      853.722 |                   3.847 |     99.5% |
| History / member   |    1,088.663 |                 301.886 |     72.3% |
| History / operator |      884.762 |                   3.295 |     99.6% |

Sources: [seed-final.json](seed-final.json), [density-original.json](density-original.json), and
[history-original.json](history-original.json). Percentages describe these local warm measurements;
the very small operator result should not be extrapolated to production latency or capacity.

On the seed member's default date page, source-level limiting alone was **102.068 ms** versus
**102.324 ms** for the baseline. Per-owned-SKU lateral reads were **245.812 ms**. Moving metadata
joins after candidate/page selection was the useful difference. The operator's corresponding values
were 61.691 ms, 68.221 ms, and 3.822 ms, versus a 65.630 ms baseline.

The recorded plans for the deferred query use the existing `settlement_transactions_date_id_idx` and
`data_kiosk_transactions_date_id_idx`; no added index explains these gains. Both source scans output
25 candidates in the first-page plans. In the history member plan, those scans take approximately 55
and 57 ms just to produce their first rows, while the operator's startup times are below 0.1 ms. The
whole instrumented member query takes about 311 ms versus 1.5 ms for the operator. This supports
investigating member authorization/current-source preprocessing next; the remaining cost cannot be
explained by fee arithmetic on 25 rows alone. Node timings are nested and should not be added as
independent costs.

## Other date-ordered cases

The following history-fixture medians compare the same unchanged RPC and deferred-join query.
`date_range` selects the latest ten calendar dates inclusive; SKU, marketplace, and company cases
each apply one available selection; `deep_page` uses offset 2,500; `oldest_page` is the first page
ordered by date ascending.

| Case             | Member baseline → deferred, ms | Operator baseline → deferred, ms |
| ---------------- | -----------------------------: | -------------------------------: |
| Latest ten dates |              310.881 → 299.217 |                    8.857 → 3.370 |
| One SKU          |              522.618 → 308.747 |                  194.695 → 3.679 |
| One marketplace  |              880.303 → 303.344 |                  466.842 → 3.987 |
| One company      |            1,106.815 → 320.666 |                  746.347 → 4.373 |
| Offset 2,500     |            1,101.151 → 271.250 |                 887.934 → 10.930 |
| Oldest first     |            1,091.407 → 932.195 |                939.244 → 684.019 |

A narrow date range already reduces much of the baseline work, so the member gain there is small.
Ascending order keeps ascending UUID tie-breaks, while the existing date index is descending by date
and ascending by UUID; scanning it backward does not supply the entire required ascending order. The
recorded oldest-first measurements warrant a focused ordering/index experiment, not a blanket claim
that all date pages now cost a few milliseconds.

These runs prioritize date-ordered access. The validator checks both date and reported/source-amount
ordering, but these tables do not establish amount-order performance. Sorting by calculated company
amount or service fee is outside these query variants and still requires separate work before a
production change.

## Seed refinements

This run compares refinements within the same measurement session. Medians in milliseconds; three
measured samples, no SQL errors.

| Role / case                      | Deferred joins | Native marketplace comparison | Guarded member current-policy reuse |
| -------------------------------- | -------------: | ----------------------------: | ----------------------------------: |
| Member / latest date page        |         42.301 |                        42.313 |                              32.257 |
| Member / marketplace selection   |         76.867 |                        43.154 |                              33.234 |
| Operator / latest date page      |          3.319 |                         3.305 |                               3.405 |
| Operator / marketplace selection |         27.563 |                         3.654 |                               3.576 |

Source: [refinements-seed.json](refinements-seed.json). Native comparison helps the
selected-marketplace case without changing unknown-label behavior. Reusing the member policy removes
duplicated eligibility work on this fixture, while preserving the explicit check for operators.
Neither result alone proves scalability across many memberships or a busy shared server.

## History refinements and concurrent readers

The [history refinement run](history-refined.json) repeats the comparison on the ten-cohort fixture
without additional indexes. Medians in milliseconds; three measured samples for each serial cell.

| Role / case                      | Existing RPC | Native marketplace refinement | Guarded member current-policy reuse |
| -------------------------------- | -----------: | ----------------------------: | ----------------------------------: |
| Member / latest date page        |    1,104.944 |                       300.068 |                             210.035 |
| Member / latest ten dates        |      308.688 |                       308.855 |                             206.683 |
| Member / marketplace selection   |      876.692 |                       309.030 |                             211.899 |
| Member / oldest first            |    1,095.780 |                       950.025 |                           1,020.799 |
| Operator / latest date page      |      890.410 |                         3.785 |                               5.442 |
| Operator / latest ten dates      |        8.572 |                         3.306 |                               5.142 |
| Operator / marketplace selection |      473.523 |                         4.610 |                               6.218 |
| Operator / oldest first          |      884.752 |                       661.903 |                             890.537 |

Guarded policy reuse helps the member's common descending page and bounded date query. It is not
uniformly faster: the guard preserves an explicit check for operators, and the ascending query
remains expensive without a matching index. Native comparison by itself does not remove the member's
current-source authorization work.

The same run includes synchronized four- and eight-reader bursts. Four readers are two requests for
member A, one for member B, and one operator; eight readers are three for each member and two
operators. Connections and an identical baseline warm-up per connection precede the measured burst.
There is one discarded warm-up burst and three measured bursts per method and reader count; methods
rotate.

| Readers | Method                              | Member A median request, ms | Median complete burst, ms | Median burst requests/s |
| ------- | ----------------------------------- | --------------------------: | ------------------------: | ----------------------: |
| 4       | Existing RPC                        |                   1,090.482 |                 1,094.707 |                   3.654 |
| 4       | Native marketplace refinement       |                     316.997 |                   322.687 |                  12.396 |
| 4       | Guarded member current-policy reuse |                     219.401 |                   224.757 |                  17.797 |
| 8       | Existing RPC                        |                   1,268.968 |                 1,275.850 |                   6.270 |
| 8       | Native marketplace refinement       |                     318.722 |                   327.374 |                  24.437 |
| 8       | Guarded member current-policy reuse |                     219.757 |                   228.315 |                  35.039 |

All measured requests completed within the same eight-second timeout with exact baseline-equivalent
payloads. Burst wall time runs from barrier release to the last completed request and includes
transaction/role setup, whereas the per-request SQL timer does not. These results demonstrate
improvement under this small mixed-reader load; burst requests/s are **not sustained throughput**,
and three bursts cannot establish production tail-latency or saturation limits.

## Sparse membership across 20 companies

The [tenant comparison](tenants-original.json) keeps the original schema and indexes and applies the
same timeout, warm-up, and three-sample controls. Default descending date-page medians in
milliseconds:

| Role     | Existing RPC | Deferred joins | Guarded member current-policy reuse |
| -------- | -----------: | -------------: | ----------------------------------: |
| Member   |      606.706 |         92.577 |                              77.841 |
| Operator |      902.979 |          4.968 |                               6.628 |

The smaller member time than the two-company history fixture is consistent with the different
workload: the database has the same total fact count, but each company owns a much smaller subset.
This reinforces the need to measure both database size and membership selectivity; it is not a
controlled claim that company count alone improves performance.

| Concurrent readers | Existing RPC median burst, ms | Deferred joins median burst, ms | Guarded policy reuse median burst, ms |
| ------------------ | ----------------------------: | ------------------------------: | ------------------------------------: |
| 4                  |                       928.020 |                         110.607 |                                93.063 |
| 8                  |                     1,066.814 |                         156.758 |                               132.910 |

There were no measured SQL errors and all successful payloads matched the baseline. The same fixed
mixed-role distribution is used as in the history bursts. The eight-reader figures correspond to
median burst rates of 7.499, 51.034, and 60.191 successful requests/s, respectively; these remain
short synchronized bursts rather than sustained load or a capacity limit.

## Optional ascending-date indexes

Historical comparison: those measurements preserved ascending IDs in both date directions. The
[current implementation](../reversible_date_ordering_2026-09-25/README.md) reverses date and ID
together, using one index per source. The duplicate direction-specific indexes were removed.

After the query-only comparisons, two indexes were added only to the history clone:
`(posted_date ASC NULLS LAST, id)` for Settlement-category facts and
`(activity_date ASC NULLS LAST, id)` for Data Kiosk facts. Existing indexes and access rules
remained in place. Together they occupied **41,820,160 bytes, approximately 39.9 MiB**, and took
approximately 0.387 seconds to build locally using ordinary `CREATE INDEX`. This is not a production
concurrent-index build estimate. See [ascending-index-build.json](ascending-index-build.json) and
the adopted definitions in the
[source index definitions](../../../services/db/supabase/migrations/20260912072531_live_source_versions.sql).

| Oldest-first method / role                     | Before ascending indexes, ms | With ascending indexes, ms |
| ---------------------------------------------- | ---------------------------: | -------------------------: |
| Deferred joins / member                        |                      932.195 |                    263.451 |
| Deferred joins / operator                      |                      684.019 |                      4.106 |
| Guarded member current-policy reuse / member   |                    1,020.799 |                    164.696 |
| Guarded member current-policy reuse / operator |                      890.537 |                      5.324 |

These are three-sample medians from [history-original.json](history-original.json),
[history-refined.json](history-refined.json), and the subsequent
[indexed comparison](history-ascending-indexes.json), with the same fixture and timeout. They are
separate before/after sessions rather than interleaved index toggles. The unchanged baseline still
took 1,104.973 ms for the member and 897.004 ms for the operator after the indexes were added: the
useful outcome depends on the query shape as well as index order.

The default descending page did not gain materially: the indexed deferred query was 308.187 ms for
the member and 3.740 ms for the operator, and the guarded query was 212.800 and 5.321 ms. A matching
ascending index therefore targets the explicitly measured oldest-first path. The
[additional ascending plans](ascending-plans.json) confirm both new indexes are used. Those plans
were captured after the read comparisons and are diagnostic samples, not additional request medians.
These optional clone-only indexes do not explain the earlier descending-order gains.

A separate partial Data Kiosk index on `(activity_date DESC NULLS LAST, id) WHERE amount <> 0`
occupied **6,062,080 bytes, approximately 5.8 MiB**, with a 0.087-second local build. The ascending
indexes were removed before this comparison; its starting catalog fingerprint matches the original
history runs. With the partial index, the deferred default page was 303.150 ms for the member and
3.705 ms for the operator; the guarded variant was 209.403 and 5.836 ms. This does not show a
meaningful default-page gain over the original 301.886/3.295 and 210.035/5.442 ms measurements. The
evidence does not justify adding it solely for this workload. See
[nonzero-index-build.json](nonzero-index-build.json) and
[history-nonzero-index.json](history-nonzero-index.json). Its write cost was not measured because
its read result did not justify adoption.

After all timed read comparisons, an isolated insert test compared the original indexes with the two
ascending indexes. Each trial inserted 1,000 source rows and rolled back; the median excludes one
warm-up and uses three samples.

| Fact table | Original indexes, ms | With ascending indexes, ms | Change | Median WAL bytes, original → ascending |
| ---------- | -------------------: | -------------------------: | -----: | -------------------------------------: |
| Settlement |                9.255 |                     10.598 | +14.5% |                  1,576,178 → 1,655,028 |
| Data Kiosk |                9.780 |                     10.785 | +10.3% |                  1,834,210 → 1,937,790 |

Sources: [write-cost-original.json](write-cost-original.json) and
[write-cost-ascending.json](write-cost-ascending.json). This measures fact insertion and index
maintenance, with publication/FK triggers excluded equally. It is not full import throughput,
includes normal sample variation, and was not randomized across repeated rebuilds. Rollback still
generates WAL and affects heap visibility; vacuum/analyze cleanup followed each table. This is why
write tests ran after read comparisons. For frequent ascending navigation the read benefit supports
considering the pair; newest-first navigation needs no additional index from this trial.

## Semantic and integrity checks

The completed [initial semantic validation](semantic-validation.json) contains 228
candidate/baseline comparisons across two company members, an operator, and an account without
application access. The [refinement validation](additional-semantic-validation.json) adds 152
comparisons. They cover ascending/descending date and source-amount order, page sizes and offsets,
empty arrays, source selection, inclusive/open-ended dates, individual and combined filters,
multiple-company selection, and denied other-company scopes.

Comparisons run against the same repeatable-read snapshot. Validation checks the exact response
shape, source-qualified row uniqueness, deterministic tie-breaks, decimal fee/company arithmetic,
zero-amount Kiosk exclusion, and ownership scope. Matching timeouts or infrastructure errors do not
count as successful equivalence. Normal seed data exercises `APPLIED` and `NOT_APPLICABLE` statuses.

The [controlled mutation validation](mutation-validation.json) adds 64 comparisons for the principal
deferred-join method using missing fees, missing ownership, reassignment, and an applied
zero-percent rate. It checks that current ownership and company filtering continue to agree with the
baseline, and restores the fixture afterward. No authenticated read ran with replica trigger mode,
and no schema definition changed for those scenarios.

The [final refinement validation](final-semantic-validation.json) adds 184 read comparisons,
including unknown-only, mixed, empty, and null marketplace selections. It repeats all four mutation
scenarios for each of the native-marketplace and guarded-policy methods: 64 comparisons each, with
both fixtures restored. Another 15 comparisons exercise the guarded method as a PostgreSQL bypass
user with member claims and as authenticated member/operator roles with `row_security=off`. Bypass
results match the baseline; ordinary authenticated roles fail closed with the same permission error.
Historical Settlement rows were present for the scoped historical check; this fixture had no
obsolete Kiosk facts, so that particular historical-data case was not exercised for Kiosk.

The [final checks](final-checks.json) confirm all eight performance runs completed with no SQL
errors or result mismatches across 1,224 requests including warm-ups. Each clone's catalog returned
to its own initial fingerprint after optional indexes were removed. The
[source catalog before](source-schema-before-v2.json) and [after](source-schema-after-v2.json)
match. Restoring the dump normalizes some raw ACL representations;
[expanded ACL comparison](clone-acl-equivalence.json) confirms identical grantors, grantees,
privileges, and grant options. All four disposable databases and the private dump were removed. The
original Supabase database and application remain running.

These checks establish equivalence for the exercised fixtures and contexts, not for every possible
future policy or data change.

## Conclusions from this experiment

1. **Bound eligible candidates before joining metadata and current terms.** The deferred variant
   produced the principal measured gain; this page shape is now implemented.
2. **Review the policy guard independently.** It reduced member startup work, but its correctness
   depends on the documented fact-policy contract. It and native marketplace comparison are now
   integrated; the historical refinement timings here measured them separately.
3. **Retain both date directions with their measured costs.** The ascending counterparts are now
   installed for oldest-first navigation alongside the newest-first indexes. Do not add the
   nonzero-Kiosk index or adopt per-SKU lateral reads based on these results. The optional SKU-order
   index definitions were not benchmarked and are not recommendations.
4. **Measure remaining capacity before changing the data model.** Exact counts, grouped totals,
   calculated-amount sorting, very deep offsets, large ownership sets, cold-cache latency, and
   simultaneous imports remain separate workloads. Member authorization still constructs permitted
   version sets from facts. A maintained membership map or current projection is conditional
   follow-up work, not a prerequisite for the demonstrated page improvement.

The benchmark itself left the application unchanged. Its recommended page shape, native filter
types, reviewed policy guard and ascending indexes are now implemented as described above. The
[schema review](../../schema_design_review.md) treats a new serving model as a conditional next
step. The tenant and temporal fixtures isolate different growth patterns; their combination, skewed
ownership and sustained production p95/p99 latency remain unmeasured.

## Retained evidence and current verification

The dated JSON observations, result hashes, plans, fixture metadata, and limitations remain as the
record of this experiment. Superseded executable query candidates and their old reproduction
commands have been removed. Running today's implementation is a new measurement, not an exact
reproduction of the historical schema and query bodies.

Use the [maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for current
RPC verification on disposable local databases. Preserve the recorded evidence and write new results
to a separate path; retain no raw financial rows, credentials, or private dumps.
