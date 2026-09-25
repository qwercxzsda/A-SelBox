# Page selection before fee resolution — September 23, 2026

**Historical measurement record.** The timings, plans, and validation counts below describe the
implementation tested on this report's date. They are not measurements of the current
[page/count implementation](../../transaction_query_contracts.md). Superseded experiment scripts
have been retired; use the
[maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for new runs.

Migration `20260922165537_page_transactions_before_fees.sql` originally added the authenticated
`transaction_page` REST RPC for date and reported-amount ordering without free-text search. That
endpoint was introduced for those requests. Calculated-fee ordering, text search, filter choices,
and summaries retain the complete live view.

## What changed at this checkpoint

A shared, private `security_invoker` input view contains the original current source selection and
current ownership logic. Both the complete view and the new RPC read it under the existing grants
and RLS. No policy or financial formula is weakened, and frozen payout resolution is unchanged.

The RPC applies permission checks, all selections, and Data Kiosk zero exclusion before selecting
the page. It then resolves applicable fees for that page. When an exact count is requested, one
materialized set of qualifying input rows serves both the count and pagination. When it is not
requested, that materialized branch is empty and performs no source reads. Counts survive
empty/out-of-range pages.

The function uses `force_custom_plan` locally. With a generic plan, optional-filter predicates and
CASE-based ordering produced poor plans; the initial prototype regressed despite the explicit page
limit. Choosing a plan for each request's actual filters/order removed that regression. This adds
planning work and is not a database-wide configuration change.

The RPC returns 23 financial columns with all six numeric fields represented as JSON strings. SQL
NULL stays null. Exact row counts are strings until validated as safe integers by the frontend. No
SQL is sent from the browser.

## Measured HTTP performance

The harness compares the old live-view endpoint, including its CSV response and
`Prefer: count=exact` when needed, with the new JSON RPC. Both use normal `authenticated` SQL roles
and the same member/operator scopes. An isolated PostgREST 16.2 server connects only to disposable
local database clones, with an ephemeral test JWT secret. It does not log in to or modify the
original app.

Each case has one warmup per method and three measured requests per method, alternating their order.
All 192 responses, including warmups, matched exactly after decoding rows and requested counts. The
retained files contain only timings, response sizes, row counts, and SHA-256 result digests, never
transaction values, user identities, credentials, or tokens.

Median HTTP milliseconds for a 25-row date-descending page **with exact count**:

| Fixture                              | Role     |  Before |   After | Reduction |
| ------------------------------------ | -------- | ------: | ------: | --------: |
| Seed: 103,244 facts                  | Member   |   268.3 |   151.6 |     43.5% |
| Seed                                 | Operator |   195.3 |   120.6 |     38.3% |
| Density: 1,032,440 facts             | Member   | 2,144.0 | 1,284.6 |     40.1% |
| Density                              | Operator | 1,979.3 | 1,380.5 |     30.3% |
| Broad: 1,032,440 facts, 20 companies | Member   | 1,304.8 |   700.5 |     46.3% |
| Broad                                | Operator | 2,066.2 | 1,510.6 |     26.9% |

Date-descending pages **without a new count**, as used when a count is cached:

| Fixture | Member before / after | Operator before / after |
| ------- | --------------------: | ----------------------: |
| Seed    |         153.1 / 125.1 |            129.2 / 72.2 |
| Density |     1,183.8 / 1,030.2 |         1,142.7 / 916.8 |
| Broad   |         664.6 / 648.9 |         1,263.6 / 989.6 |

The broad member's no-count improvement is small and should be treated as near measurement noise.
The largest reliable improvement is avoiding repeated membership work for page-plus-count requests,
not a claim that all pages become constant-time. Reported-amount ordering and bounded date queries
also improved in the retained cases. See [seed](seed-http.json), [density](density-http.json), and
[broad](broad-http.json) observations for every sample.

These are warm, sequential, local HTTP measurements. They include response transfer/decoding but
exclude the Supabase gateway, production network latency, and browser rendering. Clones share the
local PostgreSQL instance and machine; caches were not flushed. The density fixture increases fact
volume tenfold while preserving source/company cardinality. The broad fixture expands the
tenant/source graph to 20 companies and 1,290 seller-SKU identities, retaining the original date and
value distributions. Neither fixture establishes sustained production capacity.

## Why counting was expensive

Exact counting is a normal database operation. PostgreSQL must determine every matching,
snapshot-visible row; an exact filtered count is not a lookup of a stored table-size number. Here
the requested count is over a union of versioned facts, current-source joins, ownership,
user-specific RLS, and selected filters.

The old plan also retained the fee-period join even though COUNT does not require fee values. The
nonoverlapping fee-period constraint guarantees at most one fee, but the observed plan did not use
that guarantee to eliminate the join. Numeric fee arithmetic is pruned from the count; identifying
and joining rows is the work. In addition, old page-plus-count requests performed their eligibility
work twice.

[Sanitized plans](plans.json) show the old count/page fee join producing 46,398 member rows and
87,530 operator rows on the seed. The new page's fee join produces only 25 rows. Its separate
qualifying-row count contains no fee-period scan. For counted requests, the eligible CTE is built
once and read for pagination and counting; for uncounted requests, the counted branch produces zero
rows without source work. The new plans were captured from the RPC's inner query with typed constant
arguments, matching its custom-plan behavior; they are structural explanations, not substitutes for
end-to-end function/HTTP timings.

Permission and current-version checks still process substantial source data, especially for members.
This remaining work explains why an exact count or unbounded table page can still be expensive after
fees are deferred. Additional indexes cannot make every arbitrary filtered exact count
constant-time.

## Alternatives rejected

Before choosing the RPC, three transparent-view alternatives were measured: independent scalar fee
subqueries, a scalar composite fee subquery, and an always-one-row lateral fee aggregate. The scalar
expressions expanded into multiple lookups over candidate rows; a member page was approximately 1.27
seconds versus 0.14 seconds for the existing view. The lateral aggregate was also slower. They were
not installed in the application. The original all-row read remains for requests that need fee
calculations before ordering/filtering.

## Validation and rollout at this checkpoint

- 124 database tests pass, including ten new RPC tests with hundreds of role, filter, ordering,
  pagination, and count combinations.
- 97 frontend unit tests and 101 Playwright browser tests pass.
- SQL/Python/frontend formatting, lint, type checks, and production build pass. The pre-existing
  frontend chunk-size advisory remains.
- Database security advisor reports no warnings or errors after local application.
- Existing-source row and count comparisons, exact decimals, missing fees, null/zero fee bases,
  period boundaries, current-version replacement, reassignment, and hidden companies retain their
  existing behavior.
- The migration was applied atomically to the existing local frontend seed on port 55422 without a
  reset. Member/operator smoke checks confirm 25 rows, exact count agreement, decimal-string JSON,
  and count omission when requested.

Deploy the migration before the frontend that calls the new RPC. No financial backfill, new index,
or table rewrite is required. The count path materializes the qualifying rows, which may spill to
temporary storage for large results. Narrow filters, count reuse, and revision polling remained
useful. These were the rollout conditions for the original implementation, not the current
direct-count query.

## Retained evidence and current verification

The dated JSON observations, result hashes, plans, fixture metadata, and limitations remain as the
record of this experiment. Superseded executable query candidates and their old reproduction
commands have been removed. Running today's implementation is a new measurement, not an exact
reproduction of the historical schema and query bodies.

Use the [maintained benchmark guide](../../../services/db/supabase/benchmarks/README.md) for current
RPC verification on disposable local databases. Preserve the recorded evidence and write new results
to a separate path; retain no raw financial rows, credentials, or private dumps.
