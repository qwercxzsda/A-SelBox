# Application index footprint

The application uses **85 indexes totaling 72.86 MiB** on a fresh build. The same rows required 84 indexes and 70.23 MiB at `ca353da`. Adding the 5.09 MiB index for company-scoped reads raised the total by 2.63 MiB (3.75%) after savings elsewhere. The figures measure clean index builds over identical rows. On the running preview, which includes partially occupied indexes from earlier writes, application index storage measured 82.84 → 81.83 MiB after rebuilding the changed keys. [Per-index byte counts](evidence/frontend_index_sizes_2026-11-24.json)

| Access path | Index design and reason |
| --- | --- |
| Raw Finances types and chronological pages | The `(amount_type, sku)` B-tree supports a type on its own or its intersection with a seller SKU. Repeated pairs share posting lists, so adding SKU to the type key cost 104 KiB. Posting instant and marketplace/instant keys serve the header-date filters. |
| Company-scoped counts and totals | The partial B-tree on `(version_id, sku, route)` holds amounts routed directly to a SKU or SelBox. PostgreSQL can check the visible SKU and route for each selected version in the index. Repeated triples share posting lists. |
| Exact SKU and fee dates | The general partial B-tree holds the nonnull SKU alone. The catalog returns the same SKU for every qualifying row with that key, so each seek only orders by SKU. The fee editor uses `(sku, version_id) where fee_base is not null` to find applicable transaction dates. Narrowing the fee index as well cost about 10 ms on the administrator editor in a clone trial. |
| Native IDs and regional sync | The unique source key starts with `unit_key`, serving exact native-ID lookup and complete source identity checks. A small B-tree on `(source, seller_namespace, amazon_scope)` serves regional publication scans. The two access paths together occupy 4.48 MiB after a clean build, down from 8.17 MiB. |
| Observation and replay | Membership has one row per batch and unit. A deferred FK requires the chosen version to belong to the selected unit. A second deferred FK requires the batch to have observed that version. Each globally unique version identifies one permanent unit, so the unique membership target needs only `(batch_id, version_id)`. This removes one UUID per key and saves 896 KiB. The version-first index also serves history lookup. |
| Source content identity | The private version table stores the 32 SHA-256 bytes. Its `(unit_id, content_sha256)` uniqueness key fell from 5,562,368 to 3,801,088 bytes, in addition to roughly 1.9 MiB saved in the version heap. The publisher converts the existing canonical digest at the database boundary. Archive manifests continue to carry their original hexadecimal hashes. |
| Saved payout pins | A covering primary key holds the report ID and unit or assignment key, with the version ID as included payload. A globally unique version belongs to one key, enforced by the composite FK. These constraints imply that a report can pin that version only once. The separate version-first indexes support reverse lookups. Reading the largest report's 6,226 source pins used an index-only scan. |
| Reference sources and fee periods | Native invoice and removal IDs resolve through source units. Report rows resolve through their version and row number. The ledger retains its seller-scoped FNSKU and ASIN lookup paths. Named information is read by seller and native ID; its parent batch is immutable. The administrator's Raw data views join rows to the current-version pointer index and add no index of their own: on the local preview (14,311 current of 28,622 storage rows, 721 invoices with 7,410 lines), each view's first sorted page took at most 10 ms and its exact count at most 7 ms. Fee periods retain their primary key and their GiST exclusion constraint, which also supports assignment/marketplace/date lookup. |
| Identity, inventory and operations | Primary keys, identity/role lookups, capture scope constraints, current-version pointers, and the pending-payout partial index support RLS, scheduled work and concurrent writes. These remain relevant when a particular browsing workload records few scans. |

## Read and write checks

Seven interleaved measured calls on matched disposable layouts exercised raw pages and counts for common, sparse and empty SKU/type intersections. Common counts took 36.4 → 8.7 ms, sparse counts 1.59 → 0.68 ms, and empty counts 2.47 → 1.04 ms. Both layouts used the type index for the common count. The compound key reduced logical block visits from 10,013 to 6,750. Page medians were 5.9 → 6.4 ms, 15.0 → 13.8 ms and 6.4 → 3.5 ms respectively.

The local preview also served these six requests through the authenticated administrator REST API. All returned HTTP 200 and identical ordered JSON. Across five measured requests after one warmup, count medians for common, sparse and empty pairs were 33.4 → 10.2 ms, 3.4 → 2.8 ms and 3.8 → 2.4 ms. Page medians were 11.8 → 12.0 ms, 15.8 → 16.9 ms and 7.1 → 5.9 ms.

Isolating the new direct-amount index on the optimized SQL reduced 60-day count medians from 125 to 97 ms for the administrator, 119 to 91 ms for one company and 123 to 91 ms for the other. Total-only reads fell from 140 to 116 ms, 120 to 102 ms and 136 to 112 ms respectively. The bounded count used an index-only scan to read 54,129 direct amounts over 9,039 matching transaction headers. Without the index the corresponding scan visited all 308,886 amount rows.

Fresh Finances publication and unchanged replay were timed with an archived capture of 654 transactions and 3,567 amounts. Five measured executions per layout followed one warmup, with alternating execution order and rollback. Median fresh publication took 394.9 → 414.1 ms and unchanged replay 242.5 → 247.9 ms. Every replay reused the same versions. All 49,068 existing version digests matched their original hexadecimal encodings after conversion. Existing archives for Finances, invoices, storage, aged storage, removals and the ledger reproduced exactly their previously accepted version IDs.

The two largest indexes retain their default fillfactor. Replaying the observed insertion order with fillfactor 96 increased their combined size from 29.30 to 30.70 MiB, even though a clean rebuild looked smaller. A trial covering `(version_id, amount_number)` with route, SKU, amount part, amount and fee base used 26.72 MiB versus 11.98 MiB for the narrow key. Its unfiltered monthly gain was about 17 ms under the original query and its daily trend read was slower. Including only SKU and route on that unique key still added 7.26 MiB, compared with 5.09 MiB for the dedicated partial index.

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
