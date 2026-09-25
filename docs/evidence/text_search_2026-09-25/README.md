# Filtered transaction reads — September 25, 2026

The final implementation follows the revised scope: simple visible-field search and infrequent
Reported amount ordering over at most **10,000 matching rows**. The earlier broad hidden-field
search design and its unfinished benchmark were superseded. Their timings are not used below.

## Bounded amount ordering

All three tabs apply authorization, current/raw source visibility, selected filters, and search
before deciding whether amount ordering is allowed. The database materializes at most **10,001**
matching candidates without an ORDER BY. If that extra row exists, it raises the fixed `22023` error
before evaluating the sort or fee-calculation branch. With no more than 10,000 matches, it sorts the
complete matching set and selects the requested page. High offsets cannot bypass the cap. Exactly
10,000 rows are allowed. Combined amount-page counts reuse the bounded inventory.

Date ordering retains the existing indexed path and has no 10,000-row limit. Independent exact
counts are also uncapped. The four dedicated amount indexes were removed from the baseline and local
seed. Their [earlier measurement](../reported_amount_ordering_2026-09-25/README.md) recorded about
112.7 MiB on a million-row fixture; those indexes are no longer part of the current implementation.

The frontend disables amount choices when the current exact count is already above the limit. If the
count is unknown or stale, the server enforces the same rule. Its allowlisted limit error produces
an actionable warning and an **Order by date** button, while search and filter controls remain
usable. Other server error bodies remain private; there is no automatic retry of an unchanged
rejected scope.

## Simple search

Search is an ordinary case-insensitive literal predicate applied with existing filters. Transactions
searches SKU, Type, Source, Marketplace, and Currency; the raw tabs omit their redundant Source.
Source accepts its fixed display names as well as canonical codes. Type matches stored codes and
keywords. Settlements now displays canonical Type, while its original Transaction/Description fields
remain available in row details.

Fee status, processing version, seller identifiers, and hidden raw metadata are no longer searched.
The special version/status context, SQL join builder, and fee-search inventories were removed. Only
literal normalization and one shared inlinable visible-field predicate remain. Matching is done in
the database, without downloading complete option lists or trusting their cached completeness. A
nonempty unknown term returns zero rows/count zero; it cannot turn into an empty array meaning no
filter. Null, empty, and whitespace-only input mean no search.

The browser retains its 250 ms debounce and sends `p_search` to the page/count RPCs. Punctuation,
backslashes, and Unicode remain literal; strings are bound parameters, never SQL fragments.
Marketplace substring search casts the enum to text, while selected marketplace filters continue
using native enum equality. Fees are calculated only after selecting an allowed page.

See the [query contracts](../../transaction_query_contracts.md),
[database modules](../../../services/db/supabase/README.md#schema-modules), and
[frontend behavior](../../../services/frontend/user-webpage/README.md).

## Correctness and local application

[Fresh-install catalog comparison](catalog.json) allows only the four removed indexes, the new
source-count endpoint, two private search helpers, and three RPC signatures extended by `p_search`.
All tables, columns, constraints, views, triggers, RLS policies, existing permissions, other
functions, and types match the baseline before this search task. Original financial status cases
were restored, rather than retaining the abandoned search-only classifier.

[Local application checks](application.json) verified **143 allowed pages, 150 exact counts, and 7
over-limit rejections** for two company members, an administrator, and an account without access.
The independent reference applies the final visible-field predicates to the existing views. It
covers blank/unknown/hidden-field terms, Source aliases, Marketplace, amount/date ordering and
narrow SKU selections. Source facts and migration history were preserved; generated REST aggregation
remains disabled. Obsolete interim helpers were removed and PostgREST was notified.

[Validation](validation.json) records **180 database tests, 129 frontend unit tests, 132 browser
tests**, three focused alias checks, and format/lint/type/build checks. Database tests cover the
10,000/10,001 boundary, combined-source counting, RLS and filters before the cap, high offsets,
uncapped date/count requests, exact decimals, and no fee projection on overflow. Browser tests
exercise disabling/re-enabling amount choices, stale/unknown counts, recovery by Date, and all three
tabs' visible search fields.

## Million-row measurements

[Completed benchmark results](performance.json) contain two independently completed runs, each with
**1,032,440 source facts**: 737,330 Settlement rows and 295,110 Data Kiosk rows. Density retains the
seed distribution; History shifts ten seasonal cohorts across 2017–2026. History is not a continuous
daily ten-year dataset. Both fixtures passed 24 role/dataset/case combinations, using one warm-up
and three measured repetitions. Results match the authorized SQL views.

The following values are median local HTTP latency. Page and exact count requests are measured
separately. `live` is Transactions; `operator` is the application administrator, still using the
authenticated database role. These are current implementation timings, not a paired comparison
against the earlier indexed amount or hidden-field search designs.

| Fixture | Role     | Dataset    | Date page / count (ms) | Filtered amount page / count (ms) | Cap error (ms) | Date-bounded no-match page / count (ms) |
| ------- | -------- | ---------- | ---------------------: | --------------------------------: | -------------: | --------------------------------------: |
| density | member_a | live       |          172.0 / 288.2 |                      117.8 / 35.0 |           70.2 |                             97.5 / 95.7 |
| density | member_a | settlement |          425.4 / 285.3 |                      111.5 / 57.6 |           71.9 |                             64.8 / 61.6 |
| density | member_a | data_kiosk |           59.3 / 134.3 |                       57.8 / 32.3 |           46.2 |                             36.3 / 35.6 |
| density | operator | live       |            7.0 / 173.2 |                         7.5 / 5.1 |           13.3 |                             16.1 / 14.3 |
| density | operator | settlement |          328.7 / 158.3 |                         5.4 / 3.7 |           10.2 |                             25.2 / 24.2 |
| density | operator | data_kiosk |             4.9 / 79.9 |                         4.9 / 3.7 |           15.0 |                               7.5 / 6.6 |
| history | member_a | live       |          219.9 / 320.6 |                      121.5 / 62.8 |           73.1 |                           117.9 / 116.5 |
| history | member_a | settlement |          415.8 / 277.6 |                      115.1 / 61.9 |           71.7 |                             63.3 / 62.0 |
| history | member_a | data_kiosk |          106.3 / 169.1 |                      104.4 / 55.8 |           75.1 |                             56.8 / 56.1 |
| history | operator | live       |            8.5 / 158.4 |                         7.3 / 4.3 |           13.4 |                               7.9 / 6.3 |
| history | operator | settlement |          324.2 / 148.7 |                         6.3 / 4.4 |           10.1 |                               7.0 / 5.9 |
| history | operator | data_kiosk |             4.3 / 78.7 |                         4.1 / 3.0 |           14.8 |                               4.1 / 3.6 |

Broad amount requests rejected in **10–75 ms**. Density's permitted amount scope contained exactly
10 matching rows for each actor/dataset. History selected a different, verified below-cap scope; its
recorded 25-row Transactions/Settlement response is the page size, not the complete matching count
(Data Kiosk's scope contains one row). Therefore the two fixtures are not a like-for-like comparison
of amount selectivity.

The no-match searches above have a **date bound**. An unrestricted rare or missing text term can
still require scanning many authorized rows to establish that no match exists. The cap limits amount
sorting work after filters; it does not guarantee that finding the filtered candidates is cheap.
Exact counts remain full-scope work. Raw Settlement date pages were about 324–425 ms here, so these
results do not establish uniformly fast queries for every tab.

Both runs used warm caches and sequential requests, not concurrent production load. Fixture
fingerprints, separate run timestamps, scope differences and cleanup are recorded in the artifact.
All disposable databases and temporary REST containers were removed; source catalog fingerprints
were unchanged. Both real Auth/PostgREST E2E suites also passed, covering literal Unicode and
punctuation, exact numeric values, native marketplace selections, paging, and revoked access.

## Index decision

A [completed exploratory trigram probe](trigram_probe.json) on a million-row clone found that two
multicolumn GIN indexes used **59.2 MiB** but were not used by authenticated company-user or
application-admin regex searches under the current RLS barrier. An owner-only control used GIN,
confirming the operator class worked. The experiment used the earlier field set, so its timings are
not a benchmark of the final simplified predicate. The indexes were not adopted, and no RLS or
leakproof settings were changed. The probe's clone was removed and source catalog preserved.
