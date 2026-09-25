# Bounded summary HTTP benchmark

**Historical measurement record.** The timings, plans, and validation counts below describe the
implementation tested on this report's date. They are not measurements of the current
[page/count implementation](../../transaction_query_contracts.md). Superseded experiment scripts
have been retired; use the
[maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for new runs.

Five warm, alternating measurements per strategy and role against the local seeded API on port
55421, after the live-view database optimization. Requests used ordinary authenticated RLS. One
warmup per strategy was excluded. The benchmark did not modify the database or configuration.

The implemented frontend strategy uses latest-date discovery followed by parallel day and month
totals, grouped by currency. A selected DATE range has its own bounded request only while a filter
is active; matching bounds share the same account-scoped query cache. Initial loads, errors, and
stale responses are handled independently for each card. The month-end selection rule, exact
amounts, zero Data Kiosk exclusion, TYPE breakdowns, and existing authorization checks are
preserved. No new database migration is required.

| Role           | Full-history daily aggregate | Latest date + parallel day/month totals | Latest date + bounded daily aggregate |
| -------------- | ---------------------------: | --------------------------------------: | ------------------------------------: |
| Company member |                     248.6 ms |                       313.6 ms (+26.1%) |                     303.7 ms (+22.2%) |
| Administrator  |                     210.7 ms |                       154.6 ms (-26.6%) |                     152.5 ms (-27.6%) |

Values are median end-to-end time, including discovery, response parsing and exact decimal
reduction. The parallel strategy completes both period requests before timing stops.

All 30 measured summaries and all six warmup summaries agreed exactly with their role's full-history
reference: chosen periods, separate currencies, decimal amounts, record counts and
known-company-amount counts. SQL NULL sums remained unknown rather than becoming zero. Raw source
counts matched the sum of group record counts, establishing complete grouped responses. Financial
values, dates, account IDs, keys and tokens are omitted from the saved results.

| Role and strategy               | HTTP requests | Aggregate groups | Response body bytes | Source rows counted   |
| ------------------------------- | ------------: | ---------------: | ------------------: | --------------------- |
| Member: full history            |             1 |              493 |              22,846 | 41,132                |
| Member: parallel periods        |             3 |               11 |                 615 | 51 day; 15,812 month  |
| Member: bounded daily           |             2 |              162 |               7,745 | 15,863                |
| Administrator: full history     |             1 |              637 |              29,597 | 87,530                |
| Administrator: parallel periods |             3 |               14 |                 749 | 113 day; 37,466 month |
| Administrator: bounded daily    |             2 |              206 |               9,806 | 37,579                |

The member's serial latest-date lookup cost about 117 ms, followed by about 191 ms for the monthly
request; the concurrent daily request cost about 106 ms. The full-history request alone cost about
245 ms. For the administrator, discovery cost about 64 ms and the monthly request about 87 ms,
against about 206 ms for full history. These request medians are explanatory and should not be added
as though they were a single measured sample.

The role-dependent overhead is consistent with repeating member authorization/RLS setup across
requests. That is an inference from HTTP behavior, not a measured attribution to a particular
database plan node; these requests do not isolate RLS cost from other query execution work.

The three-request strategy bounds aggregate work to the displayed periods and reduces response body
size by approximately 97%. Header and request bytes are not included in these byte counts. It
improves administrator latency in this fixture, but it is not a company-member latency improvement.
The two-request union saves only about 10 ms for the member and retains substantially more response
data, so this run does not justify changing from separate period totals to that alternative merely
for speed.

These are warm local-loopback results on the existing small fixture, not a production capacity
claim. Each HTTP request used a fresh local connection; normal application background refresh could
occur. No network-latency simulation, larger-history fixture, database plan inspection or
configuration changes were included. The bounded strategy may age better with growing history, but
this benchmark does not establish that crossover.

Sanitized individual observations remain in [results.json](results.json). Latest month follows the
requested rule: use the latest transaction's month when that date is month-end, otherwise the
preceding calendar month. The two-request experiment combined that month and latest day in an OR
filter while preserving Data Kiosk zero exclusion. Its script is retired.

## Retained evidence and current verification

The dated JSON observations, result hashes, plans, fixture metadata, and limitations remain as the
record of this experiment. Superseded executable query candidates and their old reproduction
commands have been removed. Running today's implementation is a new measurement, not an exact
reproduction of the historical schema and query bodies.

Use the [maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for current
RPC verification on disposable local databases. Preserve the recorded evidence and write new results
to a separate path; retain no raw financial rows, credentials, or private dumps.
