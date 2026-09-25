# Database read refactor — September 25, 2026

The read layer now has one current definition per object, shared financial and validation rules,
and separate modules for its four public query endpoints. Existing tables, access rules, public
API signatures, financial results, and optimized query boundaries are preserved.

## Source organization

The migration baseline was reduced from 15 files and 4,155 lines to 12 files and 2,989 lines:
1,166 lines removed. Final index and policy definitions now live with their owning schema modules.
Superseded query definitions, temporary REST-aggregation enablement, and incremental replacement
steps were removed. This is a fresh-install baseline; it is not an upgrade sequence to replay
against an existing database.

The [module map](../../../services/db/supabase/README.md#schema-modules) identifies each file's
responsibility. The [query contracts](../../transaction_query_contracts.md) document parameters,
validation, authorization, exact decimal values, null handling, pagination, and planning boundaries.

Five private helpers centralize Settlement fee applicability, exact service-fee arithmetic, typed
filter validation, page bounds, and the existing current-version policy eligibility check. The
private invoker-security `current_sku_terms` view centralizes current ownership selection, including
explicitly unassigned SKUs. The frozen payout resolver still selects the explicit terms versions
supplied by its caller.

Fact filtering, date ordering, per-source candidate limits, and fee lookup placement remain visible
in the relevant endpoint. The relation-free financial helpers can inline into SQL expressions;
request validation happens before fact scans. No generic row-by-row query wrapper was introduced.

## Schema and access verification

Two fresh disposable databases were installed from the before snapshot and the refactored files.
Consolidation alone produced identical catalogs, including routine bodies. The final
[catalog comparison](catalog.json) then allowed only the intended helper/view additions and changed
read-function/view bodies:

- Existing tables and columns, all 138 constraints, 64 indexes, 49 triggers, and 19 policies match.
- Existing relation permissions and routine signatures, grants, security modes, and other attributes match.
- Additions are five private invoker functions and one private invoker view, with its five columns and generated composite types.
- Public endpoints and source authorization rules are unchanged. There are no contract errors.

The full database suite passed **162 tests**. Another **6 real Auth/PostgREST tests** passed, covering
application access, transaction filters, and summary RPCs. New direct shared-rule tests cover
classification, nulls, exact decimal arithmetic, current/unassigned terms, invoker security, and
current-version eligibility. Migration structure tests prevent duplicate object definitions and
obsolete replacement chains. SQLFluff, Ruff, formatting, strict targeted Pyright, and diff checks
passed.

## Performance and result equivalence

[Raw HTTP measurements](performance.json) compare the installed definitions before and after the
refactor on two disposable fixtures of **1,032,440 facts each**: 737,330 Settlement and 295,110 Data
Kiosk facts. Both retain two companies and 129 SKUs. Density repeats facts within seed-sized dates
and source versions. History spreads seasonal cohorts over ten years, 2017–2026; it is not continuous
daily ten-year coverage.

Each fixture runs 22 role/request combinations as a company member or operator, with one excluded
warmup and five measured repetitions per phase. Roles and requests rotate within each phase;
the complete before phase precedes the after phase on the same fixture. All **528 responses**,
including warmups, matched their exact reference results. RPC decimal strings and the full-view
CSV response were checked without floating-point conversion. Each phase's summaries retain its
median, minimum, and maximum.

Representative company-member medians, in milliseconds:

| Fixture | Request                 | Before |  After |
| ------- | ----------------------- | -----: | -----: |
| Density | Company amount ordering | 1115.2 | 1115.9 |
| Density | Exact count             |  291.7 |  291.5 |
| Density | Latest 25 rows          |  171.0 |  169.1 |
| Density | Month totals            |  849.7 |  847.4 |
| Density | Month totals by Type    |  525.6 |  525.8 |
| Density | Oldest 25 rows          |  172.3 |  168.2 |
| History | Company amount ordering | 1216.7 | 1219.8 |
| History | Exact count             |  320.0 |  321.3 |
| History | Latest 25 rows          |  222.8 |  224.9 |
| History | Month totals            |  160.8 |  155.8 |
| History | Month totals by Type    |  134.8 |  133.2 |
| History | Oldest 25 rows          |  174.1 |  176.2 |

All 44 measured role/request medians stayed within 3.4% of their earlier values. This supports
preserving performance through the refactor; it does not establish a speedup. Exact counts and
summaries are separate requests, not added to the page timing. These are warm, sequential local
HTTP measurements, not production or concurrent-user latency guarantees. Both clones and the
private temporary dump were removed, with the source catalog unchanged during benchmarking.

The [maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) describes
re-running the installed API measurements. Earlier
[dedicated aggregation measurements](../dedicated_aggregation_2026-09-25/README.md) and
[date-ordering experiments](../ordered_pages_2026-09-25/README.md) document the preceding query
optimizations. Obsolete executable candidates are not retained in this report.

## Existing local database

The verified function/view definitions were applied transactionally to the local seeded database
without resetting it. [Application checks](application.json) compared 84 results across two company
members, an operator, and a user without application access. All matched. Existing tables, indexes,
access rules, source fact counts, and migration records remained unchanged, and generated REST
aggregation remains disabled. PostgREST's schema cache was notified after the update.
