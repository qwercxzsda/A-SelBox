# Reversible date ordering — September 25, 2026

Date ordering now reverses the complete deterministic key. Transactions uses
`(activity_date, source, source_row_id)`; raw source tabs use their date and row ID. Oldest-first
orders every key ascending, and newest-first orders every key descending. This makes the two
complete result sequences exact reverses, including multiple rows sharing a day or the same UUID
appearing in different source tables. Every page-selection and JSON aggregation stage agrees.

## One date/ID index per source

The later [balanced-index experiment](../balanced_read_indexes_2026-09-25/README.md) broadened the
Settlement date/ID index to all categories and added compact filter indexes. This document records
the preceding direction-reversal change; its then-partial Settlement definition is historical.

Each source retains a single ascending B-tree:

```sql
create index settlement_transactions_date_id_idx
on private.settlement_transactions (posted_date asc nulls last, id asc)
where category = 'SETTLEMENT';

create index data_kiosk_transactions_date_id_idx
on private.data_kiosk_transactions (activity_date asc nulls last, id asc);
```

Queries request `ASC NULLS LAST` or `DESC NULLS FIRST`, with matching ID directions. Both stored
dates are `NOT NULL`, so the null placement changes planner compatibility without moving any visible
missing-date rows. This follows PostgreSQL's
[forward/backward B-tree ordering](https://www.postgresql.org/docs/current/indexes-ordering.html).
The Settlement predicate is unchanged: its index covers Transactions' Settlement-category path, not
all historical categories in the administrator's raw Settlement tab.

The extra index for the opposite date direction has been removed from each source. Local application
dropped the old mixed-direction indexes and renamed the already-existing ascending indexes into the
canonical names, avoiding a rebuild. The canonical undeployed baseline defines each only once.
Tables, access rules, function signatures, financial amounts and amount-ordering behavior are
unchanged. Amount ordering still uses ascending source/ID ties and the 10,000-match limit.

## Verification

[Local application evidence](application.json) records exact reversal and multi-page equivalence for
all three datasets under company-member and administrator roles. Catalog comparisons permit only the
two page function bodies and the expected date-index changes; other functions, grants, relations,
policies, triggers, columns and types match. Source fact counts and migration records are unchanged.
The two removed seed indexes occupied **4,218,880 bytes**; this is the 103,244-row local seed, not
the million-row fixture.

[Installed-query plans](plans.json) show the same two date indexes scanned **Forward** for
oldest-first and **Backward** for newest-first, for both a company user and administrator. These are
read-only `EXPLAIN ANALYZE` plans for the installed dynamic SQL and default 25-row Transactions
request, with normal custom planning. No planner switches force index use; plan timings are omitted.

Database regression coverage checks full-sequence reversal against independent view queries, several
page sizes, cross-source ID collisions, date/SKU/marketplace/text filters, and unchanged amount
ties. Existing search/cap tests also pass. No data or access migration is needed.

## Million-row check

The [installed-query benchmark](performance.json) used the existing History fixture with **1,032,440
source facts** (737,330 Settlement and 295,110 Data Kiosk), one warm-up and three measured
repetitions per actor/query. It contains ten seasonal cohorts across 2017–2026, not continuous daily
data for ten years. The table shows median local HTTP latency for 25-row Transactions pages. Counts
start after pages and are measured separately; all-ready is the median of each full sequential pair,
not necessarily the sum of the two separate medians.

| Role     | Query            | Page (ms) | Exact count (ms) | All ready (ms) |
| -------- | ---------------- | --------: | ---------------: | -------------: |
| member_a | latest           |     232.4 |            337.1 |          569.4 |
| member_a | oldest           |     184.4 |            341.2 |          521.7 |
| member_a | one_marketplace  |     236.7 |            332.9 |          568.9 |
| member_a | latest_ten_dates |     228.7 |            119.5 |          346.7 |
| operator | latest           |      11.0 |            168.1 |          181.9 |
| operator | oldest           |       9.7 |            166.3 |          176.0 |
| operator | one_marketplace  |      14.7 |            115.1 |          129.8 |
| operator | latest_ten_dates |      10.3 |              9.9 |           21.9 |

These measurements confirm usable oldest/newest reads with one index per source. They are not an
interleaved before/after benchmark and do not establish a speedup over the previous two-index
implementation. Warm sequential local timings are not a production-concurrency guarantee. The
benchmark checks combined/separate page/count agreement; independent view equivalence and full-order
reversal are checked separately by database and real Auth API tests.

The benchmark clone, REST server, dump and private temporary directory were removed. Source and
clone catalogs were unchanged during measurements. [Security advisors](advisors.json) reported the
same three previously reviewed scalar-helper search-path warnings, with no new warnings.
