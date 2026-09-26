# Database performance

The [query contract](transaction_query_contracts.md) defines current API behavior. The
[schema guide](database_schema.md) describes the immutable source model and financial boundaries.
This guide explains the current execution strategy and remaining scaling costs.

## Current read design

| Request              | Work performed                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Date-ordered page    | Filter authorized source facts, take bounded candidates in date/ID order, merge sources, then resolve metadata and fees for the selected page. |
| Reported-amount page | Apply all filters and authorization, stop at 10,001 matches, reject scopes above 10,000, otherwise sort the bounded matching set.              |
| Exact count          | Count matching authorized facts without calculating their fees. Cache independently of the current page and ordering.                          |
| Period totals        | Filter the requested period; combine facts sharing fee inputs before resolving fees; return separate currency and optional Type groups.        |
| Filter options       | Read distinct authorized values with a continuation cursor, without monetary calculations or occurrence counts.                                |
| Revision polling     | Read the caller's account and at most three private revision-token rows. Unchanged tokens cause no financial refresh.                          |

Currentness and ownership are independent. Source headers select complete current versions;
fact RLS checks that selection, the source category, and current seller/SKU ownership. Metadata
policies only check registered membership and current pointers. They never scan facts to establish
metadata ownership. Members share narrow current references; full report metadata remains
operator-only. See the [access contract](access_control.md).

Each source has one reversible `(date, id)` index and compact `(sku, date)`,
`(component_type, date)`, and `(marketplace_name, date)` indexes. Ownership/version keys support
eligibility. The compact indexes omit the unique row ID to allow repeated key/date pairs to share
B-tree entries; filtered pages may still need a small sort or merge. There are no dedicated
amount-ordering indexes. The [index map](transaction_query_contracts.md#index-access-paths)
describes each path.

Marketplace names are constrained text and compared directly. A single selected marketplace uses
scalar equality; small multiple selections use bounded candidates per marketplace. The planner
retains the ordinary array-filter path when the candidate work budget would be exceeded. No filter
or pagination result is truncated by that strategy choice.

The browser renders rows before loading the exact count. Latest day/month summaries first discover
the latest transaction date, then aggregate only their periods. These choices improve initial
rendering and avoid unnecessary work; they do not make an uncached exact count or sum constant-time.

## Measurement baseline

The [September 26 benchmark](evidence/simple_metadata_access_2026-09-26/README.md) compares the
current metadata policy design against ownership-dependent metadata discovery. Its history fixture
contains 1,032,440 facts, 580 settlement headers, and 16,200 day headers, spread across ten shifted
seasonal cohorts. These are warm local REST medians after one warmup and three measured repetitions.
Page timings exclude the separate exact count.

| Member request           | Previous metadata policy | Current metadata policy |
| ------------------------ | -----------------------: | ----------------------: |
| Newest Transactions page |                    84 ms |                   21 ms |
| Sparse-marketplace page  |                    90 ms |                   23 ms |
| Unfiltered exact count   |                   277 ms |                  217 ms |
| Latest-month totals      |                   130 ms |                   64 ms |
| SKU options              |                   314 ms |                  256 ms |

Four simultaneous readers improved median page latency from 111 ms to 53 ms. A second million-row
fixture with fewer source versions delivered a 17 ms newest page, but its denser monthly total
still took about 771 ms. All measured financial responses matched between variants. These fixtures
and short warm bursts establish neither cold-cache nor sustained production capacity.

Use the [maintained benchmark harness](../services/db/supabase/benchmarks/README.md) to measure the
installed query definitions on disposable clones. Compare financial responses, ordering, nulls,
exact decimals, role visibility, catalog permissions, index size, and publication cost alongside
latency. Never use privileged plans as a substitute for member-role measurements.

## Remaining costs and possible next steps

| Cost                                  | Why it remains                                                                                 | Change to consider only after measuring                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact counts and wide totals          | Every matching eligible row or group contributes.                                              | Versioned daily primitive rollups if many rows share the same fee inputs. Preserve missing-fee counts, zero-row rules, and exact currencies. |
| Sparse or absent text search          | Literal substring matching may scan many source rows before finding a page or proving absence. | Measure realistic terms and RLS plans before adding a specialized text index or changing search semantics.                                   |
| Deep page numbers                     | Offset pagination must gather and discard earlier candidates.                                  | Cursor pagination if sequential navigation outweighs arbitrary page jumps; include the complete date/source/ID tuple and revision handling.  |
| Many source versions and company SKUs | Current-pointer sets and current ownership still need resolution.                              | A narrow current projection if measured lookup cost justifies duplicate storage and atomic publication work.                                 |
| Operator full-header reads            | Guarded metadata functions can materialize history before an outer view limit.                 | A bounded metadata RPC if these screens become frequent.                                                                                     |
| Concurrent publication                | Global source revision rows serialize writers briefly at commit.                               | Narrower signals only if lock waits and unnecessary refreshes become material.                                                               |
| Large imports and pruning             | Complete JSON publications and retained-history checks consume memory and transaction time.    | Profile staging/COPY or bounded day-level pruning without weakening atomic publication or retention checks.                                  |

Indexes are chosen for selective access and real ordering patterns, not every possible filter
combination. A wide index cannot cheaply support all optional predicates. Record actual scan rows,
buffers, temporary writes, and estimate errors before changing the index family. Maintain ANALYZE
and vacuum as imports and pruning change table distributions.

Rollups or a serving projection would be schema changes with publication and invalidation costs.
They are not present in the current implementation. Current ownership must remain a live decision:
reassigning a SKU changes historical live visibility without rewriting immutable source evidence.
Frozen reports keep their captured source and terms versions regardless of serving optimizations.

Before production, set latency/throughput targets and measure realistic company skew, years of
retained versions, cold reads, concurrent readers, and imports. Inspect statement timeouts and total
connection budgets across PostgREST and worker pools. The current read model does not require a
new cache, pooler, partition scheme, or Realtime subscription merely because the fact tables grow.
