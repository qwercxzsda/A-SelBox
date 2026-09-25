# Indexes outside transaction tables — September 25, 2026

Reviewed every index on the other **19 application-owned tables** in `public` and `private`:
50 indexes before, **44 afterward**. All 35 constraint-backed indexes remain. Secondary indexes
fall from 15 to 9. The 13 indexes on the two transaction fact tables, including their nine dedicated
read indexes, are unchanged. Supabase-managed Auth/Storage tables are outside this audit.

The [complete review](index-review.json) records every original index, its exact definition,
constraint ownership, decision, and reason. Source scan counters are context only: the seeded
payout tables are empty, so zero scans cannot establish that an index is unnecessary.

## Changes

| Table                                       | Change                                                                                                      | Reason                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `private.data_kiosk_preprocess_versions`    | Remove `data_kiosk_versions_batch_idx(batch_id)`                                                            | Existing `UNIQUE(batch_id, day_id)` serves batch inventory and version lookup.                               |
| `private.settlement_preprocess_versions`    | Remove `settlement_versions_acquisition_idx(acquisition_id)`                                                | Maintained reads select versions by ID or Settlement identity; acquisition parents are immutable.            |
| `public.company_payout_reports`             | Replace `(company_id, start_date, end_date)` with `(company_id)` and `(created_at DESC NULLS LAST, id ASC)` | Match the actual global administrator list while retaining company FK lookup.                                |
| `public.company_payout_report_components`   | Remove separate indexes on `seller_sku_id`, `terms_version_id`, and `fee_period_id`                         | Reads are scoped by `report_id`, already covered by constraint indexes; referenced terms/fees are immutable. |
| `private.payout_report_settlement_versions` | Remove `payout_settlement_version_idx(version_id)`                                                          | No maintained reverse reader; referenced versions are immutable.                                             |
| `private.payout_report_terms_versions`      | Remove `payout_terms_version_idx(terms_version_id)`                                                         | No maintained reverse reader; referenced terms are immutable.                                                |

The payout header definitions are:

```sql
create index company_payout_reports_company_idx
on public.company_payout_reports (company_id);

create index company_payout_reports_created_idx
on public.company_payout_reports (created_at desc nulls last, id asc);
```

The frontend's unchanged default query orders **all** administrator-visible reports by creation
time and ascending ID ties. A company-leading creation index cannot provide that global order.
The company index has a separate purpose: companies remain mutable through trusted SQL, so reverse
foreign-key checks are legitimate. The old period-date suffixes had no maintained caller.

## Retained indexes and guarantees

- All primary, unique, and exclusion indexes remain. Composite unique keys still serve composite
  FK targets and enforce correct identity/version pairings, even when the UUID is separately unique.
- All 13 account, company, seller/SKU, terms, fee-period, and revision-token indexes remain. They
  cover identity lookups, current ownership, company joins, fee intervals, and revision lookup.
- Source identity, current-pointer, document-hash, and Data Kiosk batch/acquisition indexes remain.
- Report-leading primary/unique indexes cover report components, ordering by `row_number`, complete
  manifests, and inventory validation. Additional report-only indexes would duplicate their prefix.
- `payout_data_kiosk_version_idx(version_id)` remains. Pruning actively checks it for pinned source
  versions, including empty days that have no payout component rows.

Removing a referencing-side index does **not** remove a foreign key. Insert checks use the referenced
primary/unique key. Such indexes also help when a parent key is updated/deleted; here the removed
uncovered paths lead to immutable parents whose normal mutations are rejected before reverse FK
checks. The behavioral tests exercise that assumption. This reasoning must be revisited if future
features add reverse readers or permit parent mutations.
[PostgreSQL foreign keys](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK),
[multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html)

## Payout benchmark

[Measurements](payout-results.json) use a fresh isolated database with **100,000 report headers**,
100 companies (80 with reports), and **240,000 components** across 600 populated reports. Remaining
headers are valid empty reports. One company owns half the headers, and creation timestamps have
25-row ties. Publishers created the source/template reports; controlled copies expanded them.
Normal triggers were restored, and every FK, manifest inventory, copied payload, and exact header
total was checked before measurement. This tests index access paths rather than predicting the
future frequency of those report shapes.

Four layouts were compared with normal planner choices, one warmup, and three measured repetitions.
REST reads use authenticated operator claims; component/publication probes use maintained trusted
backend paths. All response hashes match across all variants. Indexes were rebuilt consistently,
and sizes were captured **before** rolled-back publication probes to avoid counting their dead
index entries as design overhead. An earlier exploratory run exposed this measurement issue and
was superseded by the normalized results retained here.

| Request                                            | Before (ms) | After (ms) |
| -------------------------------------------------- | ----------: | ---------: |
| Newest 25 reports, REST                            |      39.101 |      3.248 |
| Next 25 reports, REST                              |      40.484 |      3.544 |
| Offset 50,000, REST                                |      55.261 |     11.291 |
| Oldest 25 reports, REST                            |      33.343 |     32.680 |
| Separate exact count, REST                         |       7.522 |      7.463 |
| Read 400 report components                         |       3.551 |      3.335 |
| Publish, validate, and roll back a complete report |      31.775 |     31.377 |

All payout indexes together decrease from **43.633 to 42.398 MiB** on this fixture. Adding only the
global-order index while keeping unnecessary indexes would instead use 47.531 MiB. The tested
company-leading creation alternative uses 48.586 MiB and leaves the global first page around 41 ms.

Oldest-first still sorts because the existing payout UI keeps ID ties ascending in both directions.
This change preserves that contract and does not add an opposing index. Counts still process the
matching rows; deep offsets still traverse skipped rows. Small publication-time differences are
not evidence of a precise write-throughput gain.

Access checks show the operator can read reports while company members and unregistered identities
cannot. Bad report/company, component/terms, seller/terms, fee-period, and manifest references still
fail. A pinned noncurrent empty Data Kiosk day remains protected from pruning.

## Source metadata benchmark

[Measurements](metadata-results.json) use another isolated database with **100,000 zero-fact
versions**, 500 day identities, 333 acquisitions, and 1,599 batches. Batch sizes are 1, 10, 90, and
500 days. Repeated observations exercise latest-compatible-version and three-observation comparison
queries. Publication/inventory triggers were temporarily disabled only for fixture expansion and
restored before reads; constraints stayed enabled and inventories were verified.

Four alternating baseline/removal rounds include one warmup and three measured repetitions. All
eight query outputs match. Normal plans select the existing `UNIQUE(batch_id, day_id)` index after
removal; a new timestamp or latest-observation index was not justified by these paths.

Removing the narrow batch index saves **761,856 bytes (0.727 MiB)**. The tradeoff is small but real:
100 batch inventory lookups changed from **1.287 to 1.650 ms** locally, an extra 0.363 ms. Individual
batch server execution remained 0.016–0.048 ms without the index. Latest-compatible-version lookup
changed from about 0.535 to 0.497 ms. Retention-candidate reads changed from 328 to 344 ms; neither
plan used the removed index, so this difference is not attributed to losing that access path.
The retention experiment reads candidates; it does not benchmark the pruning mutation loop.

The Settlement acquisition-index removal is based on maintained callers and immutable-parent
behavior, not a claim of measured Settlement import acceleration. Forward version-to-acquisition
joins use the acquisition primary key, which remains.

## Installation and validation

The undeployed baseline now contains the final definitions in
[source versions](../../../services/db/supabase/migrations/20260912072531_live_source_versions.sql)
and [payout reports](../../../services/db/supabase/migrations/20260914062544_company_payout_reports.sql).
[Local application](application.json) dropped only the eight reviewed non-constraint indexes and
created the two replacements in one transaction. Every other index, table/column, constraint,
function, policy, grant, trigger, and type matched the before snapshot. All table row counts and
migration history are unchanged. No source reset or frontend/runtime query change was needed.

[Validation results](validation.json) record fresh-install database tests, real Auth/API workflow
tests, and lint checks. [Security advisors](advisors.json) report the same three previously reviewed
scalar-helper warnings and no new warnings. Temporary benchmark databases, REST containers, and
credentials were removed.

These are warm, sequential local measurements on synthetic distributions. They do not establish
cold-cache latency, sustained concurrency capacity, or a universal optimum for future workloads.
