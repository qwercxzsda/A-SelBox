# Fee-applicability filtering by Type — September 26, 2026

`transaction_page` and `transaction_count` now filter fee applicability by each source's raw Type.
This lets applicable-only counts use the **existing** Type/date indexes. No index, table, access
rule, fee calculation, or frontend runtime change was needed.

## Filter definition

The source branches use these predicates when `p_fee_applicable` is not null:

```sql
-- Settlement branch
(t.component_type in ('PRODUCT_SALES', 'PRODUCT_REFUNDS')) = p_fee_applicable

-- Data Kiosk branch
(t.component_type = 'NET_PRODUCT_SALES') = p_fee_applicable
```

Null still means no applicability restriction. Explicit Type selections intersect the applicability
filter. Filtering precedes pagination, the 10,000-row amount-sort cap, and fee projection. Page and
count keep the same public signatures and boolean parameter.

The current preprocessors assign these Types to the same rows as the former source-field/base
checks. A read-only consistency check covered all 73,733 Settlement and 29,511 Data Kiosk seed
facts, including historical versions, with no disagreements. The million-row fixture also had no
disagreements. Zero bases, zero rates, missing rates, and missing ownership remain applicable.

Type is now authoritative **for the filter**. The schema stores Type and the underlying fields
independently, so trusted direct SQL could supply an inconsistent row. Tests explicitly cover that
case: selection follows source-specific Type, while returned fee bases, resolution status, fee
amounts, and company amounts retain their existing source rules. No stored data was rewritten.

Canonical definitions:
[page](../../../services/db/supabase/migrations/20260925065535_transaction_page.sql) and
[count](../../../services/db/supabase/migrations/20260925065533_transaction_count.sql).
The [API contract](../../transaction_query_contracts.md) documents the filter separately from fee
calculation.

## Measurement

[Performance evidence](performance.json) records the maintained history fixture with **1,032,440
facts**: 737,330 Settlement and 295,110 Data Kiosk rows in ten shifted seasonal cohorts. It is not
a continuously populated decade or a production-concurrency simulation.

Twenty-eight role/query cases cover company member and administrator reads, applicability true,
false and null, newest/oldest dates, a ten-day range, SKU plus date, a contradictory Type selection,
and bounded amount ordering. Each case has one warmup and three measured repetitions per variant;
baseline and Type variants alternate. The 224 request pairs each measure a page followed by its
separate exact count. Every row digest and exact count matches the baseline.

| Request                                       | Before (ms) | Type filter (ms) |
| --------------------------------------------- | ----------: | ---------------: |
| Member: applicable-only count                 |     611.256 |          403.864 |
| Administrator: applicable-only count          |     715.114 |          282.133 |
| Member: applicable-only count within ten days |     132.403 |          110.494 |
| Member: not-applicable count                  |     715.905 |          631.387 |
| Administrator: not-applicable count           |     736.228 |          702.263 |
| Member: applicable newest page                |     221.059 |          220.335 |
| Administrator: applicable newest page         |       9.311 |           16.066 |
| Administrator: applicable oldest page         |      10.366 |           10.710 |

The main improvement is **34% lower applicable-only count latency for the member and 61% for the
administrator**. Unfiltered and already selective SKU/date requests remain comparable. The negative
filter covers most rows and retains broad scans; it does not receive the same indexed narrowing.

There is no consistent page-speed improvement. Date pages already stop after finding enough rows
and retain their date/ID scans. Administrator newest-page samples were variable: baseline
29.215/9.168/9.311 ms versus Type 27.370/16.066/9.875 ms. The table reports the measured medians
without treating the few-millisecond variation as a proven speedup or a stable regression.

Untimed plans captured from the actual function query bodies show
`settlement_transactions_type_date_idx` and `data_kiosk_transactions_type_date_idx` as bitmap index
scans in applicable-only counts for both roles. The smaller candidate set reduces fact-row scanning;
authorization and current-version checks still run. Planner choices are normal, with no forced
index scan or security changes. Constraints on leading B-tree keys can narrow the scan; see
[PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html).

All clone function definitions were restored before its removal. The source catalog was unchanged
throughout measurement. Temporary REST containers, credential files, and the private dump were
removed. Saved evidence includes only technical metadata, counts, timing, and result digests;
selected SKU literals are redacted.

## Application and regression checks

[Local application](application.json) replaced only the two function bodies in one transaction.
All other catalog definitions, indexes, table row counts, migration history, and function
signatures/owners/grants remain unchanged. Twelve local role/filter/order cases preserved complete
page responses and counts. PostgREST received a schema-cache reload notification.

Tests retain an independent fee-base oracle for normal preprocessed rows and add a separate explicit
Type-selection test for inconsistent stored fields. Fixtures now use realistic Type labels;
zero rates/bases, missing configuration, source-specific selection, contradictory filters, both
date directions, pagination, and exact count agreement are covered. Browser mocks reflect the same
filter while retaining the existing boolean RPC interface.

[Validation](validation.json) records database, real Auth/API, frontend, browser, and lint checks.
[Security advisors](advisors.json) report the same three existing scalar-helper warnings and no new
warnings. These warm local timings do not predict cold-cache or sustained concurrent latency.
