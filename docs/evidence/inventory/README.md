# Inventory source captures — September 29, 2026

Fresh Inventory Planning reports were requested through Amazon SP-API for the
[United States](real_pipeline.json) and [Japan](real_pipeline_japan.json). These aggregate records
contain no seller identifiers, SKUs, business values, report/document IDs, credentials or private
URLs. Their original transport/browser metadata describes the dated checks, not the current UI.

| Source observation         | United States |                               Japan |
| -------------------------- | ------------: | ----------------------------------: |
| Source SKU rows            |            27 |                                  21 |
| Invalid metric diagnostics |             0 |                                   0 |
| Missing optional columns   |          None | Health status and minimum inventory |

Japan omitted `fba-inventory-level-health-status` and `fba-minimum-inventory-level`. Those metrics
remained NULL, distinct from zero. Other absent per-SKU estimates also remained unavailable.

Both reports passed private Storage upload/read-back, archive hash verification and offline
preprocessing. Every normalized field matched PostgreSQL, and exposed fields matched the REST
response. Reprocessing the same acquisition/parser pair reused its capture identity. Re-fetching a
completed report preserved its original source time rather than claiming a newer observation.
Company assignments used for access checks were synthetic and confined to disposable databases.

These observations cover US/Japan source documents only. Inventory remains an approximate Amazon
replenishment observation. The [current inventory contract](../../inventory_daily_captures.md)
defines parsing, publication and access; the [verification guide](../../../services/db/supabase/README.md#live-inventory-verification)
owns the current command and private-output handling. New captures produce separate evidence.
