# Historical isolated database optimization methodology

This directory preserves the September 19, 2026 observations and plans described in the
[live-read report](../live_read_optimization_2026-09-19.md). The old query, clone, and comparison
scripts have been retired or their generic fixture support moved to the
[maintained benchmark package](../../../services/db/supabase/benchmarks/README.md). Use that guide
for current RPC measurements. Historical result JSON has not been rewritten.

## Recorded fixtures and access

The run restored one owner-private local seed dump into the allowlisted disposable databases
`aselbox_opt_seed`, `aselbox_opt_large`, and `aselbox_opt_broad`, leaving the application's
`postgres` database intact. It used the local frontend Supabase container and PostgreSQL port 55422.
Credentials stayed in memory; published artifacts contain no rows, identities, tokens or passwords.

The density fixture copied every source fact tenfold: 73,733 Settlement and 29,511 Data Kiosk facts
became 737,330 and 295,110. New row identities and source keys preserved dates, amounts, currencies,
SKUs, ownership, source versions and fee configuration. It increased fact density without expanding
company, source-version or date cardinalities.

The broad fixture instead copied the complete tenant/source graph into nine additional seller
namespaces. It had the same 1,032,440 facts, 20 companies, 21 accounts, 1,290 seller-SKU identities,
580 Settlement headers, 590 Settlement versions and 16,200 Data Kiosk day headers/versions. Members
retained a seed-sized company; operators could read the whole fixture. Foreign keys and complete
child inventories were checked before setup committed. Read grants and RLS were unchanged.
Setup-only trigger suppression ended before authenticated measurements, followed by analysis.

## Recorded measurement boundary

Reads used `SET ROLE authenticated`, member/operator JWT claims, and read-only sessions. The bounded
baseline used an eight-second statement timeout and one observation; final runs used three
observations. The first final observation was the matched comparison; subsequent observations were
additional warm evidence. Timeouts were failed reads, not completed eight-second results.

Serial cases covered 25-row pages, pages plus exact counts, date/SKU filters, monetary ordering,
counts alone, daily currency groups and grouped choices. Four- and eight-reader synchronized bursts
mixed pages, counts and aggregates. All 66 final reads completed per fixture; these short batches
did not establish sustained throughput or production capacity.

Direct SQL timings included execution/fetching over loopback but excluded HTTP, CSV serialization,
browser transfer and rendering. Plans executed additional instrumented queries and are diagnostic
evidence, not substitutes for request timings. Both sides used `plan_cache_mode=force_generic_plan`
to control the old PL/pgSQL resolver's changing plan behavior. That was an experiment setting, not a
recommendation for the current RPCs.

The clones shared local CPU, storage, PostgreSQL and caches; caches were not flushed. Automatic
vacuum overlapped the broad baseline (02:38:55–02:40:15 UTC on September 19): Data Kiosk vacuum
finished at 02:39:03 and Settlement vacuum at 02:39:27. Later fact tables were entirely all-visible.
Preserve that maintenance caveat when comparing these samples.

## Evidence retained

The JSON files retain samples, medians, failures, workload/settings metadata, migration hashes and
ordered result digests. Matching digests supplement the independent financial/permission tests.
Sanitized plans omit financial output, filter literals and credentials. The original report links
the final summary, equivalence checks and complete density/broad observations.

New measurements must use the current migration definitions and a separate output path. Do not
reinterpret the old baseline labels as today's query or remove the historical JSON when refreshing
the maintained harness. Private dumps, raw diagnostics and generated caches do not belong in
evidence.
