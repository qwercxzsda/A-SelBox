# Current read-performance snapshot — September 27, 2026

This snapshot records the active date-leading index and query design. The retained files contain
only that implementation's samples, index definitions, plans, and verification. The
[performance guide](../../database_performance.md) explains the current architecture and limits;
[query contracts](../../transaction_query_contracts.md) define the API behavior.

## Workload and method

One disposable, vacuumed history clone contains 1,032,440 facts: 737,330 Settlement and 295,110
Data Kiosk, with 129 seller/SKU registrations. Ten shifted seasonal cohorts retain the real seed's
value distributions across 2017–2026. There are 580 Settlement headers and 16,200 Data Kiosk day
headers. The fixture is synthetic read-load data, not replayable Amazon evidence.

The main window is July 16–September 13, 2026, inclusive: 60 days ending at the latest available
transaction. It contains 35,631 member and 67,411 administrator Transactions rows. SKU/marketplace
and detail-currency selections come from positive matches inside that window. Literal `fee` search
resolves to 60 member or 69 administrator Type values.

The current capture includes 31 primary cases and 18 unbounded guards, each with one warmup and
three measured authenticated local HTTP requests: 196 recorded calls. Responses were checked
against authorized references, including exact amounts, ordering, and completeness. Plans and
scratch insertions run outside those request timings. Dates remain optional in the API and the
frontend does not apply an automatic default.

These are warm local medians, not production latency guarantees. Period density, company/SKU
skew, vacuum visibility, header growth, concurrency, and cache state can change the results.

## Requests within the 60-day window

Median HTTP durations in milliseconds; page requests exclude their separate exact count:

| Request | Company member | Administrator |
| --- | ---: | ---: |
| Newest 25-row page | 11.2 | 8.6 |
| Oldest 25-row page | 10.8 | 9.2 |
| Count, no other filter | 16.6 | 12.9 |
| Direct Type count | 13.3 | 11.7 |
| Broad `fee` search count | 15.1 | 20.9 |
| SKU + marketplace count | 7.9 | 7.0 |
| Marketplace count | 8.8 | 9.3 |
| Fees-applicable count | 8.8 | 8.1 |
| Fees-not-applicable count | 17.3 | 13.7 |
| All-currency total | 52.3 | 126.9 |
| One-currency Type detail | 87.1 | 76.8 |

Cards and Type details cover different currency scopes and grouping work. The administrator's
company-filtered count takes 20.2 ms; raw Settlement/Data Kiosk counts take 15.7/4.3 ms. The member's
latest-month total takes 32.3 ms, and a 426-day count over 82,029 rows takes 30.7 ms. Latest-date
lookup is an unbounded, ordered single-row request and takes approximately 9 ms.

## Requests without DATE

| Request | Company member | Administrator |
| --- | ---: | ---: |
| Newest 25-row page | 9.7 ms | 8.7 ms |
| Oldest 25-row page | 10.6 ms | 9.5 ms |
| Count, no other filter | 134.0 ms | 101.6 ms |
| Direct Type count | 106.5 ms | 82.7 ms |
| Broad `fee` search count | 136.9 ms | 341.8 ms |
| Fees-applicable count | 40.7 ms | 32.9 ms |
| Fees-not-applicable count | 160.5 ms | 122.0 ms |

The ordinary count includes 463,980 member or 875,300 administrator rows. The administrator's
company-filtered count covers 463,980 rows in 158.7 ms. Raw Settlement/Data Kiosk counts take
153.9/17.3 ms. Broad free-text search remains a more expensive path than direct Type selection.

An explicitly requested full-date-range administrator total, May 27, 2017–September 13, 2026,
processes 875,300 rows across nine currencies in 2.30 seconds. This sum is separate from the ordinary
page/count request and is not automatically requested for an empty Selected Dates card.

## Plans and index cost

The partial count indexes lead with date and cover the other eligibility/filter columns. The
compact Settlement ownership index and full date/ID, SKU/date, Type/date, marketplace/date, and
version-reference indexes remain available. Exact definitions are in the
[index map](../../transaction_query_contracts.md#index-access-paths) and captured inventory.

The ordinary 60-day count uses index-only scans with zero heap fetches. Source scans report 227
Settlement and 141 Data Kiosk shared buffer read blocks. These counters exclude shared hits and
are not unique pages or guaranteed physical disk I/O; the operating-system cache can satisfy reads.
Totals still read amounts and fee inputs from the heap. Their Settlement bitmap uses the partial
date index; Data Kiosk totals use the date/ID index.

The member's ownership inventory contains 64 identities per source. Current-version header scans
read 580 Settlement and 16,200 Data Kiosk headers once each, independently of the fact date range.
This work is distinct from visiting source facts and does not disappear with a narrow DATE filter.

Total fact-index size is approximately 240.9 MiB. A separate scratch insertion probe uses the same
10,000-row sample for one warmup and three measured runs per source. Medians are 120.7 ms for
Settlement and 101.7 ms for Data Kiosk. Scratch tables include checks and indexes but omit source
foreign keys, RLS, and publication triggers. Executor/WAL timing excludes commit durability and
import orchestration; it is not end-to-end import throughput.

## Recorded evidence

- [Main request samples and index inventory](performance.json), [unbounded samples](unbounded.json),
  and [reference verification and cleanup](validation.json).
- [Count/total plans](plans.json), [bounded page plans](page-plans.json),
  [unbounded count plans](unbounded-count-plans.json), and [unbounded page plans](unbounded-page-plans.json).
- [Zero-inclusive access and payout checks](access.json) and [scratch insertion measurements](write-cost.json).

The clone and private temporary resources were removed. The source database was unchanged by the
benchmark. Current functional verification is documented in the
[database guide](../../../services/db/supabase/README.md#verification), rather than maintained as
past local-install scripts or migration-history patches.
