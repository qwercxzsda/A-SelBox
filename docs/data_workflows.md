# Data workflows

The sync first archives Finances responses and validates complete days against Summary. Invoice, promotion and shipment requests are built from the accepted charge IDs. Campaign requests use the billed campaign ID and the profile on the invoice line. Sponsored TV uses its alternate Ads query ID and keeps the billed ID for ownership.

Warehouse storage, aged storage, removal and monthly ledger requests run per regional seller account. Completed empty periods record coverage. Each run revisits removal requests from the preceding twelve months. It requests the three preceding finished months of storage and aged storage. Ledger retrieval starts with the available history and then revisits the three preceding finished months. Parsing a saved answer takes no Amazon request. Publication is atomic per answer. A later sync retries missing IDs and changed sources can refresh an eligible report.

See [sync commands](../services/sync/README.md) and [source allocation](source_allocation.md).
