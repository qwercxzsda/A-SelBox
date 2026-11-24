# Application index footprint

A fresh build of the application indexes uses **70.23 MiB across 84 indexes**, down from 94.84 MiB across 94 indexes at `22921d8`. Both layouts were built on the same populated PostgreSQL 17 heap pages. The saving is **24.61 MiB (25.95%)**. The running preview went from 122.91 MiB (128,876,544 bytes) to 82.84 MiB (86,867,968 bytes) when the changed indexes were rebuilt. A comparison of fresh builds separates changes in key design from page occupancy. [Per-index byte counts](evidence/frontend_index_sizes_2026-11-24.json)

| Access path | Index design and reason |
| --- | --- |
| Raw Finances types and chronological pages | Index the amount type and posting instant separately on their respective tables. The version and row primary keys serve detail hydration. Repeated type and timestamp values share B-tree posting lists. The clean type index fell from 14.72 MiB to 2.11 MiB. The marketplace/time index still serves scoped pages. |
| Exact SKU and fee dates | The general partial B-tree holds the nonnull SKU alone. The catalog returns the same SKU for every qualifying row with that key, so each seek only orders by SKU. The fee editor uses `(sku, version_id) where fee_base is not null` to find applicable transaction dates. Narrowing the fee index as well cost about 10 ms on the administrator editor in a clone trial. |
| Native IDs and regional sync | The unique source key starts with `unit_key`, serving exact native-ID lookup and complete source identity checks. A small B-tree on `(source, seller_namespace, amazon_scope)` serves regional publication scans. The two access paths together occupy 4.48 MiB after a clean build, down from 8.17 MiB. |
| Observation and replay | The primary membership key addresses a batch and unit. The version-only B-tree finds observations of a version. The mandatory composite FK matches its unit and version to a real version, which in turn references its source unit. The unique three-column membership key still guards the current pointer against selecting the wrong version of a batch. |
| Saved payout pins | A covering primary key holds the report ID and unit or assignment key, with the version ID as included payload. A globally unique version belongs to one key, enforced by the composite FK. These constraints imply that a report can pin that version only once. The separate version-first indexes support reverse lookups. Reading the largest report's 6,226 source pins used an index-only scan. |
| Reference sources and fee periods | Native invoice and removal IDs resolve through source units. Report rows resolve through their version and row number. The ledger retains its seller-scoped FNSKU and ASIN lookup paths. Named information is read by seller and native ID; its parent batch is immutable. Fee periods retain their primary key and their GiST exclusion constraint, which also supports assignment/marketplace/date lookup. |
| Identity, inventory and operations | Primary keys, identity/role lookups, capture scope constraints, current-version pointers, and the pending-payout partial index support RLS, scheduled work and concurrent writes. These remain relevant when a particular browsing workload records few scans. |

## Read and write checks

The index-only comparison alternated seven timed calls for each case between fresh layouts on matched clones. For the administrator, a common raw Finances type count improved from 42.2 to 26.1 ms, and the same count with a date range improved from 48.2 to 29.5 ms. Exact native-ID lookup took 2.3 ms on either layout. Catalog reads took 2.2 and 2.0 ms. A separate SKU-and-date count took 20.5 and 22.6 ms. Company transaction pages stayed within 68–82 ms. All 38 representative raw, company, configuration, search and payout cases produced the same ordered values.

A separate publication check used an archived capture with 654 transactions and 3,567 amounts in a new seller namespace on each disposable database. Both layouts passed deferred integrity checks and reused the same versions on unchanged replay. Across three runs per layout, median fresh publication took 390 ms before and 422 ms after, and unchanged replay took 246 ms before and 240 ms after. All trial writes rolled back.

To measure the current local footprint, run the following read-only query in PostgreSQL.

```sql
select n.nspname as schema_name, t.relname as table_name, i.relname as index_name,
       pg_relation_size(i.oid) as index_bytes
from pg_index x
join pg_class i on i.oid = x.indexrelid
join pg_class t on t.oid = x.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname in ('private', 'public')
order by index_bytes desc, schema_name, index_name;
```

The restored database includes separate Supabase-managed Auth and Storage schemas. The footprint and comparisons here cover the application's public and private schemas. [Frontend workload and timings](database_performance.md)
