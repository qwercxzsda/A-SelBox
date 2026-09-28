# Query latency before and after global SKU identity

The [recorded A/B measurement](query_speed.json) compares the namespace-scoped schema at
commit `921a9f0` with the current global-SKU schema. Two fresh disposable databases received
identical real source records. All 13 query cases returned equivalent results in every warm-up
and measured execution.

The largest reduction was in administrator queries filtered by company: about 64% for counts,
61% for totals, and 34% for a page. Member counts and totals showed smaller reductions. Member
page differences were around 0.2 ms, with overlapping interquartile ranges; those small changes
should be treated as near parity rather than a reliably perceptible improvement.

## Measured query times

Times are medians of 21 warm executions per version. Positive reduction means less query time.
Pages request 25 rows with their separate count disabled. Period queries cover the same inclusive
60-day window, July 16 through September 13, 2026. The shared-SKU cases select the most frequent
exact SKU occurring in multiple source namespaces.

| Query | Before | After | Latency reduction |
| --- | ---: | ---: | ---: |
| Member: count all owned transactions | 15.039 ms | 13.384 ms | 11.00% |
| Member: count selected period | 8.115 ms | 7.268 ms | 10.44% |
| Member: count selected SKU and period | 2.840 ms | 2.577 ms | 9.27% |
| Member: latest page | 5.832 ms | 5.616 ms | 3.71% |
| Member: selected-period page | 5.723 ms | 5.531 ms | 3.37% |
| Member: selected-SKU page | 6.178 ms | 5.981 ms | 3.19% |
| Member: selected-period totals | 24.553 ms | 23.027 ms | 6.22% |
| Member: selected-SKU totals | 6.897 ms | 6.175 ms | 10.47% |
| Member: Type totals | 28.772 ms | 27.588 ms | 4.12% |
| Administrator: company-filtered count | 330.714 ms | 118.860 ms | 64.06% |
| Administrator: company-filtered page | 11.185 ms | 7.339 ms | 34.39% |
| Administrator: company-filtered totals | 352.043 ms | 136.760 ms | 61.15% |
| Administrator: all-company totals | 58.653 ms | 51.552 ms | 12.11% |

The company-filtered count and total have speedups of about 2.8× and 2.6×,
respectively. These are individual request comparisons, not a combined dashboard or throughput
measurement. The JSON evidence includes every timing sample, quartiles, paired ratios, query
definition fingerprints, and sanitized query plans.

## Equivalent data and configuration

Both PostgreSQL 17.6 databases contain the same 103,244 source facts, including historical
versions, across five namespaces and 63 exact SKUs. The benchmark imports private source tables
only. It does not import real Auth data, company accounts, ownership terms, or payout snapshots.

Two synthetic companies receive consistent ownership by exact SKU in both databases. The
member owns the same 32 SKUs; the administrator can read all source data. Every relevant fee is
5%, covering the same source dates and marketplaces. Old terms cover only the marketplaces
observed for each namespace/SKU pair; new terms combine those marketplaces under the global SKU.
There are **192 fee periods in each database**, avoiding unused old marketplace periods that
would inflate the comparison. The old schema needs 129 identities/terms; the new schema needs 63.

This benchmark used its own equivalent synthetic setup rather than the original seed's 19
conflicting fixture assignments. The fixture was normalized separately after the user confirmed
those assignments and fees were made-up data. The timings and recorded seed fingerprint describe
the benchmark run, not that later fixture update or real business ownership.

Each comparison checks ordered source-row identities, company ownership, dates, currency,
exact Decimal amounts, rates, fees, status, counts, and totals. Internal SKU/terms/fee-period
UUIDs are excluded because those identities differ between the models. No source rows or
financial values are written to the evidence files.

## Timing and plan interpretation

Both databases use the same server and planner configuration. The maturity cutoff is fixed at
July 28, 2026. Both receive the same VACUUM/ANALYZE treatment. Three complete warm-up rounds
precede 21 measured rounds. Query-case order rotates each round, and each case alternates which
version runs first. The runner uses `prepare=False`; function-specific planning settings remain
those defined by each schema.

Timings include the SQL statement and decoded result, excluding role/transaction setup and
comparison work. Plans are collected after all timing rounds, without forcing an index.

The plans show the same qualifying source cardinalities. For the company-filtered count,
ownership subplans still execute per candidate row, but inspect fewer terms: the recorded
Settlement branch averages 56 terms before versus 23 after, and Data Kiosk averages 60 versus 25.
Member totals project 71 namespace identities before versus 32 global SKU identities after,
while both scan the same 101 visible fee periods. These observations are consistent with the
gains from simpler ownership lookups; the test does not isolate each optimization's contribution.

This is a warm local SQL benchmark. It excludes HTTP, browser rendering, cold caches, sustained
concurrency, and production infrastructure. Small timing differences can be noise. Both disposable
databases were removed and the original seed fingerprint remained unchanged.

## Reproduce

From the repository root, with local Supabase PostgreSQL available on port 54322:

```sh
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.benchmarks.sku_query_comparison \
  --seed /path/to/seed.real.local.sql \
  --baseline-ref 921a9f0 \
  --repeat 21 \
  --output /private/tmp/aselbox-query-speed.json
```

The output file must be new. The baseline must be a trusted commit using the old namespace-scoped
SKU publication contract. Its SQL is read from Git into a temporary directory; the working tree
and existing databases remain intact. No service environment file or external credentials are needed.
