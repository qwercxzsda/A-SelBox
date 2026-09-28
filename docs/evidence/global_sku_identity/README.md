# Global SKU identity measurement

The [recorded measurement](measurement.json) verifies that one exact SKU resolves to one
company assignment across three source namespaces. The member receives every matching
Settlement and Data Kiosk row, while unrelated SKU facts remain hidden.

The separate [query-speed comparison](query_speed.md) measures the previous and current schemas
on identical real source data with equivalent synthetic ownership and fees. It records all 13
query cases, including the small member-page differences and larger administrator company-filter gains.

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

## Existing real-seed audit

The [sanitized real-seed audit](real_seed_audit.json) records a read-only inspection of the
user-provided 105,187,334-byte seed. The seed uses the previous namespace-scoped SKU registry:
129 registered identities represent 63 exact SKU strings. Its 103,244 source rows cover five
namespaces, and 26 exact SKUs appear in more than one namespace. The selected current source
versions contain 102,534 rows.

Of the 26 duplicate-SKU groups, 19 have different current company owners. The other seven
have the same owner and complementary marketplace fee coverage. All 26 fee arrays differ,
but no unequal rates overlap within the same marketplace and effective dates. Selected
terms references and declared fee inventories are internally consistent.

The conflicting owners prevent restoring the existing terms as equivalent global-SKU
configuration. No owner was selected, no original terms were changed, and no seed adaptation
was saved. A private local review artifact lists the exact SKUs, namespaces, company names,
and fee schedules needed to resolve those choices; those values are excluded from this
repository evidence. The source file's SHA-256 fingerprint remained unchanged.

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
database. This validates real-source combination by exact SKU; member ownership and fee
equivalence against the conflicting real configuration remain unverified.
