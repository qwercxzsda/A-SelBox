# Shared current references and simpler transaction RLS — September 26, 2026

Registered company members may now read all current report/day/version references, without proving
SKU ownership inside the metadata policy. Transaction rows still require current source versions,
current seller/SKU ownership and eligible categories. The user explicitly approved this reference
visibility expansion; it is not a claim that every previous metadata permission remains identical.

## Current access contract

| Caller                                       | Header/version references                | Transaction facts                                           |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Company member                               | All current references, across companies | Current, eligible rows for currently owned seller/SKU pairs |
| Member whose company has no SKUs             | All current references                   | None                                                        |
| Operator                                     | All references, including history        | Existing full retained-source access                        |
| Missing or unregistered application identity | None                                     | None                                                        |

Members cannot read headers with a null current pointer or historical version references. Selected
empty versions and versions containing only excluded categories are visible as references. SKU
transfers and unassignment affect facts without changing reference visibility. Removing the
application account revokes both on subsequent requests; requests retain their normal statement
snapshot behavior.

Column grants remain unchanged: headers expose `id` and `current_version_id`; versions expose `id`,
their parent report/day ID, and `preprocess_version`. Full amounts, row counts, diagnostics, hashes
and acquisition details remain behind the existing operator-only functions. Private metadata tables
remain outside the exposed REST schemas; this change adds no public endpoint or new column access.

## Implementation and query choice

The [application access migration](../../../services/db/supabase/migrations/20260914094640_application_access.sql)
now contains one small `private.is_company_member()` helper. It checks `auth.uid()` against stored
`app_accounts.access_role`, with a fixed empty search path and authenticated-only application
execution. It accepts no caller-supplied company or user ID. Policies use scalar subqueries for the
account checks so they can be initialized once per query rather than repeated for every row.

The selected policies use:

- **Headers:** operator, or registered company member with a nonnull current pointer.
- **Version references:** operator, or registered member with an `EXISTS` match against a current
  header pointer.
- **Facts:** the existing operator branch, otherwise eligible category plus owned seller/SKU plus
  `version_id IN (SELECT current_version_id FROM the source headers)`.

The header policies never read facts. This removes the former dependency from currentness through
metadata ownership and back into transaction rows. The two old helpers,
`current_company_source_versions` and `can_read_current_source_version`, are removed rather than
retained as wrappers. No source data, table, index, public RPC signature, fee calculation, or existing
column grant changes. The fact-policy contract still supports the RPCs' existing current-pointer
shortcut for company users with active RLS.

Three equivalent new query forms were benchmarked: all correlated `EXISTS`, all current-pointer
`IN` sets, and the selected combination of fact `IN` with metadata `EXISTS`. All preserved financial
responses and implemented the same broader reference contract. All-`IN` metadata was slower for
small pages; all-`EXISTS` facts had similar page speed but slower monthly aggregation. The selected
combination keeps each policy simple and avoids new lookup/cache tables or custom equality functions.

[PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) explains how table policies
and SQL grants combine; the [Supabase guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
describes caller-bound helpers and scalar-subquery initialization.

## Repeated measurements

[Performance evidence](performance.json) uses 1,032,440 facts: 737,330 Settlement and 295,110 Data
Kiosk rows in ten shifted seasonal cohorts. It includes 580 report headers and 16,200 day headers,
existing company memberships, and the previously optimized marketplace queries/indexes. It is not
a continuously populated decade. Indexes and data stay unchanged across all variants.

Each pilot has one warmup and one measured sample across 71 role/query cases. Baseline, `EXISTS`,
and the selected combination then receive one warmup and three measured samples. Every financial
response matches exactly, including row order, monetary strings, nulls and exact counts. Cases cover
both roles and date directions, raw-source tabs, single/multiple marketplaces, date/SKU/Type/search
filters, absent matches, totals, options, and operator company filtering. Metadata counts are recorded
separately because their expansion is intentional.

| Member request                       | Before (ms) | Selected (ms) |
| ------------------------------------ | ----------: | ------------: |
| Transactions: newest page            |      84.405 |        21.335 |
| Transactions: oldest page            |      83.954 |        20.595 |
| Transactions: unfiltered exact count |     277.157 |       216.790 |
| Sparse marketplace: page             |      89.745 |        22.801 |
| Sparse marketplace: count            |      79.154 |        17.311 |
| Raw Settlement: newest page          |      44.886 |         8.259 |
| Raw Data Kiosk: newest page          |      40.156 |        10.243 |
| Latest-date lookup                   |      82.736 |        19.012 |
| Latest-month totals                  |     130.321 |        64.465 |
| SKU options                          |     313.653 |       255.545 |

Page times exclude separate exact counts. The benchmark also times a count for the latest-date
case for comparison; the frontend latest-date lookup does not request that count. Operator newest
pages remain comparable at 9.321 versus 9.405 ms. Exact counts and broad distinct-option requests
still process their matching rows; removing metadata ownership work does not make them constant-time.

[Density evidence](density.json) checks a second million-row copy with the original number of
report/day versions. Twenty cases receive the same warmup and three repeats. Member newest-page
latency improves from 44.847 to 16.975 ms, sparse pages from 50.776 to 19.456 ms, and unfiltered
counts from 230.269 to 215.087 ms. Its much larger monthly aggregation remains expensive at about
771 ms, compared with 802 ms before. All financial responses match.

[Concurrency evidence](concurrency.json) runs four simultaneous page-then-count jobs across two
members and both date directions, with one warmup and three alternating measured rounds. Median
page time improves from 111.329 to 52.825 ms, page-plus-count completion from 427.210 to 320.946 ms,
and four-job batch completion from 452.363 to 323.145 ms. All 32 warm/measured responses match.
This is a short warm burst, not a production network or sustained-throughput/p95 capacity test.

The concurrency guard explicitly verifies equivalent effective table ACLs where `pg_dump` restores
owner-only table grants using the default-null representation. No function ACL is treated that way;
the [ACL comparison](concurrency-acl-verification.json) verifies raw and effective permissions of all
49 shared routines and the explicitly changed helper set.

Both clone catalogs are restored before removal. The source catalog stays unchanged throughout
benchmarking, and temporary REST containers, private credential files, and dumps are removed. Saved
evidence contains technical metadata, counts, timing and digests rather than financial rows or
account/SKU identifiers.

## Application and verification

[Local application](application.json) atomically installs the canonical helper and six policy
expressions, drops the two retired helpers with `RESTRICT`, and reloads the REST schema cache.
It verifies unchanged table contents and migration history, preserved existing grants/catalog
objects, and **120 unchanged financial response cases** across two members, the operator, an
unregistered identity and a missing user ID.

Reference checks separately confirm the intended new result: both local members can read all 58
current Settlement references and 1,620 current Data Kiosk references. Their previous sets were
51/1,350 and 35/1,260 respectively. Operator history remains 59 Settlement versions; unregistered
and missing-user reads remain empty.

[Validation](validation.json) records **196 database tests and 8 real Auth/API tests**, plus the
standalone schema contract, Ruff, explicit-environment Pyright and SQLFluff with large-file skipping
disabled. The [source-reference tests](../../../services/db/supabase/tests/test_source_version_visibility.py)
separate metadata expectations from fact expectations and cover empty/foreign/excluded versions,
zero-SKU membership, pointer changes, revocation, null headers, restricted columns, operator-only
full metadata, helper ACLs and removal of the old functions. The
[canonical comparison](canonical-equivalence.json) checks the installed design against the measured
candidate. [Security advisors](advisors.json) are compared with the previous local baseline.
