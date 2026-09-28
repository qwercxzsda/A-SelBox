# Global SKU identity evidence

The [recorded measurement](measurement.json) verifies that one exact SKU resolves to one
company assignment across three source namespaces. The member receives every matching
Settlement and Data Kiosk row, while unrelated SKU facts remain hidden.

The separate [query-speed comparison](query_speed.md) measures the previous and current schemas
on identical real source data with equivalent synthetic ownership and fees. It records all 13
query cases, including the small member-page differences and larger administrator company-filter gains.
The [current seed verification](configuration_seed.json) covers complete configuration reads and
atomic administrator changes through actual Auth and REST.

Run the [synthetic benchmark](../../../services/db/supabase/benchmarks/global_sku_benchmark.py)
from the repository root with the local Supabase PostgreSQL server on port 54322 available:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.global_sku_benchmark \
  --output /private/tmp/aselbox-global-sku-measurement.json
```

The output file must be new. The benchmark creates a disposable database from the current
migrations and removes it after success or failure. It does not load the seed database, read
service credentials, modify existing application data, or install migrations into development.
Fixture publication uses the ordinary source and terms publishers with all integrity checks
enabled. The mature cutoff is fixed inside the disposable database so the fixture stays stable.

## Fixture and correctness

The recorded run used PostgreSQL 17.6 and 30,600 source facts: three namespaces, two source
types, and 5,100 facts for each source and namespace. Each group contains 100 rows for the
same exact SKU and 5,000 rows for unrelated, unassigned SKUs.
This exercises reads with unassigned imports, which can exist before an administrator repairs
the complete configuration.

Authenticated member reads verified all 600 expected source row identities exactly once,
one shared SKU identity, and the same exact count with and without an explicit SKU filter.
Totals matched independently calculated fixture amounts, fees, and company amounts. No
financial rows, authentication identities, or connection details appear in the saved evidence.

## Recorded timings and plans

Correctness verification precedes one designated warm-up and five measured repetitions for
each case. Request order rotates. Times cover the direct SQL RPC call and decoded result.
Fixture setup, role configuration, plans, and comparison-index construction are outside the
timed calls.

| Authenticated member request | Median | Minimum | Maximum |
| --- | ---: | ---: | ---: |
| Count all owned facts | 5.834 ms | 5.658 ms | 6.245 ms |
| Count selected SKU and month | 2.295 ms | 1.765 ms | 2.438 ms |
| Selected SKU page, 25 rows | 5.534 ms | 5.443 ms | 5.837 ms |
| Selected SKU totals | 3.816 ms | 3.376 ms | 4.440 ms |

The installed queries used `settlement_transactions_sku_date_idx` and
`data_kiosk_transactions_nonzero_count_idx`. Neither index contains a namespace key.
The count used an index-only scan for Data Kiosk. Each selected source scan returned 300
matching rows. Small source/terms metadata tables used sequential scans. The benchmark
records the actual choices without forcing a particular index or changing planner settings.

## Index key sizes

After timing and plan collection, the benchmark builds both variants of each comparison
index on the same data. Both variants have identical columns and predicates except that one
includes `seller_namespace` immediately before `sku`. This avoids comparing a freshly built
index with one grown incrementally during publication.

| Index purpose | SKU-only keys | Namespace-bearing keys | Reduction |
| --- | ---: | ---: | ---: |
| Settlement owner/version | 1,032,192 bytes | 1,597,440 bytes | 35.38% |
| Settlement date/count | 1,318,912 bytes | 1,884,160 bytes | 30.00% |
| Data Kiosk date/count | 1,318,912 bytes | 1,884,160 bytes | 30.00% |

These sizes depend on the synthetic SKU/namespace lengths and row distribution. Comparison
indexes exist only in the disposable database and never affect timed application queries.

The complete recorded run finished in 1.726 seconds and confirmed database cleanup. This
small, warm local workload does not measure HTTP, browser rendering, production latency,
concurrent users, historical versions, or scaling to production data volumes. The index-size
comparison does not measure latency against the previous namespace-based query design.

## Configuration read sample

The [configuration-read measurement](configuration_read.json) records a separate one-off sample
of `public.sku_configuration()` on 103,244 real source facts with consistent synthetic terms.
It reused the comparison fixture's source-only loader and account/term setup in fresh disposable
databases; only the current configuration endpoint was timed. Original accounts, company
assignments, fee rates, and payouts were excluded. Synthetic 5% terms covered observed marketplaces
and dates, so all returned items had complete coverage.

The operator received 63 SKUs with 192 periods and 206 requirement ranges. The member received
only its 32 assigned SKUs, with 101 periods and 114 requirement ranges. Exact SKU inventories,
member company scope, empty issue lists, stable responses, and absent namespace fields were
verified. The original seed fingerprint remained unchanged and both temporary databases were
removed.

After VACUUM/ANALYZE, each actor received one warm-up and seven measured reads in a read-only
transaction under `authenticated`, with its synthetic subject and `prepare=False`. The operator
samples ran before the member samples, after the database test workloads had finished. Timings
cover the SQL call and result decoding, excluding role/transaction setup, HTTP, and browser work.

| Caller | Median | Minimum | Maximum | Compact JSON size |
| --- | ---: | ---: | ---: | ---: |
| Operator | 131.031 ms | 127.902 ms | 147.767 ms | 50,744 bytes |
| Company member | 50.516 ms | 49.174 ms | 55.014 ms | 26,933 bytes |

JSON sizes use compact UTF-8 serialization and exclude HTTP overhead. This is a warm local
sample of the complete configuration read, with no comparison endpoint or production latency
claim. Its synthetic setup is separate from the original fixture audit and subsequent fixture
normalization described below.

## Original seed audit

The [sanitized real-seed audit](real_seed_audit.json) records a read-only inspection of the
original 105,187,334-byte seed. That dump used the previous namespace-scoped SKU registry:
129 registered identities represent 63 exact SKU strings. Its 103,244 source rows cover five
namespaces, and 26 exact SKUs appear in more than one namespace. The selected current source
versions contain 102,534 rows.

Of the 26 duplicate-SKU groups, 19 have different current company owners. The other seven
have the same owner and complementary marketplace fee coverage. All 26 fee arrays differ,
but no unequal rates overlap within the same marketplace and effective dates. Selected
terms references and declared fee inventories are internally consistent.

Those conflicting assignments prevented an equivalent restore of that fixture's terms into the
global-SKU schema. During the audit, no owner was selected, no terms were changed, and no seed
adaptation was saved. A private local report recorded the exact SKUs, namespaces, company names,
and fee schedules; those values are excluded from this repository evidence. The audited source
file's SHA-256 fingerprint remained unchanged.

Source-only verification imported source metadata and facts into a fresh disposable baseline.
It excluded real Auth data, application accounts, companies, ownership terms, fee schedules,
and payout snapshots. The data-only restore bypassed publication triggers inside the
disposable import transaction, then restored all guards before creating a synthetic operator
and performing reads. No SQL commands from the dump were executed.

Authenticated operator SKU discovery, exact source counts, and all paginated source rows
matched independently parsed COPY facts: 86 source/SKU groups, including 35 groups spanning
namespaces; 145 page requests; and 88,235 eligible nonnull-SKU row identities with exact amount
sums by currency. Raw Data Kiosk reads exclude zero amounts, while SKU discovery includes
their SKU values. The check took 6.291 seconds and confirmed removal of its disposable
database. That check validated real-source combination by exact SKU; it excluded the original
fixture's conflicting ownership terms.

## Current synthetic seed and API verification

The user subsequently confirmed that the seed's assignments and fees were made-up fixture data
and authorized updating them to the global-SKU model. The normalized fixture contains 63 global
SKUs and 192 compatible fee periods. Its 19 conflicting synthetic owner groups receive one
deterministically selected fixture owner per SKU. Source evidence and Auth fixtures are retained,
including all 103,244 source facts. This fixture preparation is separate from the historical
read-only audit above and does not represent a decision about real company ownership.

The maintained [full-seed verifier](../../../services/db/supabase/tests/verify_real_configuration.py)
restores a current-schema dump into a disposable local Supabase stack. It tests real Auth and
REST configuration access and publication, independent source authority, and reconciliation.
It verifies that test writes leave source facts and the supplied seed file unchanged, then removes
the stack. See the [command and scope](../../../services/db/supabase/README.md#full-seed-configuration-verification).

The [recorded full-seed result](configuration_seed.json) passed with 63 SKUs, 192 fee periods,
zero setup issues, and member scopes of 22 and 41 SKUs. It verified complete batch publication,
atomic rejection, member write denial, assignment and exact fee updates, stale-version rejection,
and missing-fee rejection. Independent authority and reconciliation checks matched the stored
source facts. The maintained local seed was then replaced with that verified global-SKU fixture;
the original dump's backup remains outside version control.

The original audit and performance JSON files retain the fingerprints and fixture assumptions of
their respective runs.
