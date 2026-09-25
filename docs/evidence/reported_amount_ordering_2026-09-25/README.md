# Reported amount ordering — September 25, 2026

This is the earlier experiment with dedicated amount indexes. The subsequent
[filtered-read change](../text_search_2026-09-25/README.md) removes those four indexes and limits
amount ordering to 10,000 matching rows. The measurements below describe the earlier implementation.

Transactions, Settlements, and Data Kiosk now offer Date and Reported amount ordering. Date remains
the default. Transactions no longer offers Company amount ordering; the value remains displayed.
Reported amount means the signed stored numeric amount, without currency conversion.

## Implementation

`transaction_page` accepts `p_order_by` (`date` or `amount`). Each source selects at most
`offset + limit` authorized and matching candidates in the requested order. The function combines
them, chooses the global page, and only then resolves metadata and fees. Ties remain source and row
ID ascending. Filtering, current-version selection, and company access precede candidate limits.

`source_transaction_page` serves both raw-source tabs, with the dataset restricted to `settlement`
or `data_kiosk`. It retains their existing historical-version/category visibility and source RLS.
Stored date/amount rows are selected before projecting version metadata; existing policies ensure
that a visible fact's referenced version is visible. Data Kiosk zeros remain excluded, and
Settlement zeros remain visible. Exact numeric values, including quantities and source line numbers,
are JSON strings. The function returns the same fields the frontend previously selected from each
raw view.

Four amount/ID indexes support ascending and descending amounts while retaining ascending ID ties.
Settlement's pair includes all categories and historical rows for the raw tab. Data Kiosk's pair
excludes zero amounts. Existing date, ownership, and version indexes are retained. Both page
functions use invoker security, an empty search path, custom planning, fixed internal ordering
fragments, and bound filter parameters.

Blank-search pages on all three tabs use these functions. Nonempty text search retains the matching
view request with the same supported ordering. Exact counts still load separately: Transactions uses
`transaction_count`, and raw source tabs use filtered REST HEAD requests. Summary behavior and
Payout report ordering are unaffected.

See the [query contracts](../../transaction_query_contracts.md),
[database module map](../../../services/db/supabase/README.md#schema-modules), and
[frontend request behavior](../../../services/frontend/user-webpage/README.md#requests-and-session-lifecycle).

## Schema and result verification

The [fresh-install catalog comparison](catalog.json) permits exactly four added indexes, a new raw
source page function, and replacement of the transaction-page signature with its additional optional
sort parameter. All existing tables, columns, constraints, views, triggers, RLS policies, other
functions, types, grants, and existing indexes remain unchanged. No obsolete page overload remains.

[Local application checks](application.json) compared 96 page/count responses with the original
views: two company members, an operator, and an account without access; all three datasets; both
sort keys; both directions; first and second pages. Every result matched. The application was
transactional, left source facts and migration history intact, kept generated REST aggregates
disabled, and notified PostgREST's schema cache.

[Validation](validation.json) records 169 database tests (168 in the full suite plus the last-added
raw-versus-calculated ordering test), 127 frontend unit tests, 122 Playwright browser tests, and
format/lint/type/build checks. Database cases cover filters before pagination, historical/current
visibility, reassignment, amount ties, exact values beyond JavaScript's integer precision, missing
fees, grants, and invalid requests. Browser tests exercise ordering and pagination on all three
tabs, count reuse, and text-search fallback. A real Auth/PostgREST scenario also passed for all
three datasets, both sort keys/directions, native marketplace arrays, precise values, historical
rows, pagination, and access revocation. Timestamp comparisons normalize only equivalent ISO
spellings; financial strings and nulls remain exact. Existing relation-free scalar helpers retain
their two previously reviewed search-path advisory notices; neither page function adds a warning.

## Performance

[Sanitized measurements](performance.json) compare two fixtures with **1,032,440 facts each**:
737,330 Settlement and 295,110 Data Kiosk facts. Density repeats facts within the seed's existing
dates/versions. History spreads seasonal cohorts over 2017–2026; it is not continuous daily
coverage. Both retain two companies and 129 SKUs.

Each indexed phase alternates view and RPC requests across a company member, an administrator, all
three datasets, both date and amount directions, offset 100, and a marketplace filter. One warm-up
precedes five measured repetitions. A second phase removes only the four amount indexes inside the
disposable clone and repeats both amount directions and newest-date requests, with one warm-up and
three measured repetitions. Definitions are restored and catalog fingerprints must match.

All **72 counted comparisons and 1,152 sampled responses** matched. Count comparisons are outside
the timings below. Timings cover the HTTP request, response read and decoding for the first 25 rows;
they exclude exact-count requests and browser rendering. Roles, cases and view/RPC order rotate, but
the indexed phase precedes the phase without indexes. Caches are warm, and requests are sequential.
These are local measurements, not production concurrency or p95/p99 latency claims.

### Index contribution

Same RPC and highest-reported-amount request, median milliseconds:

| Fixture | Page                        | Without amount indexes | With amount indexes |
| ------- | --------------------------- | ---------------------: | ------------------: |
| Density | Transactions, company user  |                  811.4 |               180.2 |
| Density | Transactions, administrator |                  689.2 |                 7.6 |
| Density | Settlements, administrator  |                  188.3 |                 5.2 |
| Density | Data Kiosk, administrator   |                   89.8 |                 4.0 |
| History | Transactions, company user  |                 1098.9 |               219.0 |
| History | Transactions, administrator |                  922.7 |                 9.5 |
| History | Settlements, administrator  |                  199.9 |                 4.7 |
| History | Data Kiosk, administrator   |                   87.6 |                 4.2 |

### Page function contribution

Equivalent highest-reported-amount pages using the same final indexes, median milliseconds:

| Fixture | Page                        | Existing view | Page RPC |
| ------- | --------------------------- | ------------: | -------: |
| Density | Transactions, company user  |        1192.9 |    180.2 |
| Density | Transactions, administrator |        1152.6 |      7.6 |
| Density | Settlements, administrator  |           4.3 |      5.2 |
| Density | Data Kiosk, administrator   |           4.2 |      4.0 |
| History | Transactions, company user  |        1260.2 |    219.0 |
| History | Transactions, administrator |        1180.2 |      9.5 |
| History | Settlements, administrator  |           4.8 |      4.7 |
| History | Data Kiosk, administrator   |           3.7 |      4.2 |

Transactions benefits from selecting the page before fee resolution. The raw tabs' amount-ordering
benefit comes primarily from their new indexes: their existing views are already simple, and the
indexed raw view and RPC timings are close. Company amount ordering returns different results and
was not used as an equivalence or timing baseline.

### Date ordering and index cost

Newest Transactions pages retain similar performance, median milliseconds:

| Fixture | User          | Without amount indexes | With amount indexes |
| ------- | ------------- | ---------------------: | ------------------: |
| Density | Company user  |                  175.7 |               177.2 |
| Density | Administrator |                    7.6 |                 6.7 |
| History | Company user  |                  233.0 |               215.5 |
| History | Administrator |                    9.9 |                 9.2 |

The four indexes total **112.7 MiB** on each million-row fixture. They also need maintenance during
imports; insertion throughput was not measured in this run. Exact counts and summary calculations
are unchanged by this feature. Selective access/filtering and deep offsets can still require more
index scanning than a first-page request.

Both disposable databases, temporary REST servers, and private dump/environment files were cleaned
up. Source catalog fingerprints remained unchanged during benchmarking. This is historical evidence:
the four amount indexes were subsequently removed. The maintained
[benchmark guide](../../../services/db/supabase/benchmarks/README.md#visible-text-search-and-bounded-amount-ordering)
now verifies the installed bounded amount-ordering implementation; the old driver was retired.
