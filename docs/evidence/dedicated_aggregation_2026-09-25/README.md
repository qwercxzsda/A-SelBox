# Dedicated aggregation RPCs

Implemented and measured September 25, 2026. Current definitions are in the
[canonical read modules](../../../services/db/supabase/README.md#schema-modules):
`transaction_totals`, `dataset_filter_options`, and `rest_api_configuration`. The configuration sets
`pgrst.db_aggregates_enabled=false` on `authenticator`. The frontend uses the dedicated endpoints
without a generated-aggregation fallback. No indexes, fact tables, ownership rules, RLS policies, or
financial formulas changed. The measurements below retain their original implementation checkpoint,
before shared-rule consolidation.

## Measurements

Both fixtures contain **1,032,440 source facts**: 737,330 Settlement and 295,110 Data Kiosk rows.
Each value below is median milliseconds for one complete local HTTP result, from five alternating
measurements per strategy after one excluded warm-up. Discovery of the actor's latest authorized
date happens before timing, so these are individual totals/menu request latencies, not total initial
dashboard load times. Totals are bounded to the requested period; options span all visible history.

### Multi-year history

Ten dated seasonal cohorts span 2017–2026, retaining the seed's two companies and 129 seller/SKU
identities. This is synthetic repeated seasonal data, not continuous daily coverage over ten years.

| Account       | Request                    | Previous generated REST | Dedicated RPC |
| ------------- | -------------------------- | ----------------------: | ------------: |
| Company user  | Latest day                 |                   354.6 |      **65.5** |
| Company user  | Latest month               |                   752.7 |     **150.7** |
| Company user  | Month Type breakdown (USD) |                   671.4 |     **137.1** |
| Company user  | SKU options                |                 1,961.9 |     **359.4** |
| Company user  | Marketplace options        |                 1,966.2 |     **397.7** |
| Company user  | Type options               |                 2,390.7 |     **702.5** |
| Administrator | Latest day                 |                    13.4 |       **6.9** |
| Administrator | Latest month               |                    95.8 |      **63.0** |
| Administrator | Month Type breakdown (USD) |                    38.3 |      **26.6** |
| Administrator | SKU options                |                 1,613.0 |     **262.7** |
| Administrator | Marketplace options        |                 1,585.7 |     **330.4** |
| Administrator | Type options               |                 2,035.4 |     **826.7** |

### Increased density

Ten copies of the facts within existing source versions retain the original date range, making
monthly ranges denser than the history fixture.

| Account       | Request                    | Previous generated REST | Dedicated RPC |
| ------------- | -------------------------- | ----------------------: | ------------: |
| Company user  | Latest day                 |                   381.6 |      **37.6** |
| Company user  | Latest month               |                 1,455.9 |     **873.0** |
| Company user  | Month Type breakdown (USD) |                 1,406.0 |     **539.1** |
| Company user  | SKU options                |                 2,272.9 |     **337.7** |
| Company user  | Marketplace options        |                 2,179.2 |     **362.7** |
| Company user  | Type options               |                 2,190.8 |     **659.2** |
| Administrator | Latest day                 |                     7.1 |       **5.9** |
| Administrator | Latest month               |                 1,133.8 |     **684.9** |
| Administrator | Month Type breakdown (USD) |                   565.8 |     **314.2** |
| Administrator | SKU options                |                 1,981.5 |     **259.1** |
| Administrator | Marketplace options        |                 2,075.1 |     **339.6** |
| Administrator | Type options               |                 2,054.0 |     **639.0** |

The gains do not apply uniformly to every tiny query. Administrator Current fees marketplace options
changed from 3.5 to 4.1 ms in density and 3.6 to 4.2 ms in history. That small overhead is retained
to remove the dependency on generated aggregation. Complete results, including source options, a
marketplace-scoped month and raw administrator options, are in [results.json](results.json).

## Why less work is needed

- Totals filter eligible current source facts first, then combine facts that share seller/SKU,
  marketplace, date, currency, optional Type and fee applicability. Current ownership and fee rates
  are resolved once per compatible group. Exact numeric arithmetic makes the grouped calculation
  equivalent to summing individual calculations; there is no per-row rounding to move across the
  sum.
- Missing ownership and missing applicable rates remain unknown. Non-applicable fees remain zero;
  zero fee bases remain applicable. Currency sums and row/known-company counts preserve the prior
  null semantics and missing-fee indicators.
- Filter options use distinct eligible values without resolving fees or counting occurrences. Raw
  administrator and fee datasets retain their existing invoker-view scope.
- A scalar JSON envelope contains at most 1,000 results and an explicit continuation marker, using
  one lookahead result. This removes the extra exact input-row count previously requested through
  `Prefer: count=exact`. It removes database work within an HTTP request, not a separate HTTP
  request. Summary group row counts and known-company counts remain because the UI needs them.

The measurement compares the complete strategies; it does not independently attribute milliseconds
to each optimization. Existing lightweight polling, separate period caches, and lazy Type/menu loads
remain in place. Company/SKU/marketplace scope remains shared across all cards, DATE only affects
Selected dates, and source/Type/fee-applicability selections do not alter the cards.

## Validation and configuration

[Local application evidence](application.json) records 8 exact totals comparisons and 32 option-set
comparisons across two members, an administrator, and an identity without application access. It
also records actual gateway rejection of generated sums/counts with HTTP 400 / `PGRST123`, after
setting the local `authenticator` role to `false` and reloading configuration. The installed
function definitions match the benchmark copies' fingerprints.

- 48 database/guard regression tests passed, including 14 new totals/options tests.
- Real isolated Auth/PostgREST E2E confirmed RPC behavior with aggregation disabled, denied
  anonymous/revoked access, and preserved date-page behavior.
- 124 frontend unit tests and 119 browser scenarios passed, plus targeted scope checks.
- Database/API tests cover more than 1,000 Unicode groups/options, bounded pagination, exact
  amounts, nulls, fee periods, zero fees, source replacements and ownership changes.
- Frontend tests reject missing/duplicate/nonadvancing pagination, oversized or incomplete pages,
  imprecise numeric JSON and late responses after cancellation. Browser mocks reject raw REST
  aggregate syntax so a stale caller cannot pass unnoticed.
- Build, formatting, lint, SQLFluff and Python typing checks passed.

The SQL test harness restores the cluster-wide aggregate setting before committing its disposable
migrations, preventing tests from changing another local database's API configuration.

## Controls and limits

The
[maintained harness](../../../services/db/supabase/benchmarks/README.md#summary-and-filter-option-rpcs)
uses installed RPC definitions and guarded disposable local copies. It temporarily enables generated
aggregation only on its own REST server for the reference comparison, then verifies rejection on a
second temporary server with aggregation disabled. It never enables it on the source API. All 480
warm-up/measured responses agreed on exact amounts, counts, nulls and option sets. Artifacts retain
digests rather than financial rows, account identifiers or tokens. Both clones, temporary REST
servers, private dumps and temporary configuration files were removed after the run.

These are warm local PostgreSQL 17.6/PostgREST v16.2 results with vacuumed/analyzed data. They
include HTTP plus CSV/JSON decoding, but exclude production network latency, browser rendering, Auth
and sustained concurrency. The discovery request is excluded, and caches do not serve the measured
requests. They are not production p95 or throughput guarantees. Large totals and distinct-option
queries still process their eligible input, and member authorization still has a history-dependent
startup cost. Multiple result pages remain live estimates rather than one atomic snapshot.
