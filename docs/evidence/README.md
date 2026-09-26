# Source and performance evidence

These investigations support the current [classification](../settlement_component_categories.md),
[source-allocation](../source_allocation.md), and [workflow](../data_workflows.md) contracts.
Source observations retain their dates and coverage limits; they are evidence for active rules,
not additional runtime requirements.

| Investigation                                                                        | Purpose                                                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [Blank marketplaces](blank_marketplace_investigation_2026-09-06.md)                  | Distinguish source row names from Reports API hints and account-level activity.                                      |
| [SKU completeness](settlement_sku_completeness_2026-09-07.md)                        | Observed SKU-bearing families; [aggregate measurements](settlement_sku_completeness_2026-09-07.json).                |
| [Classification audit](settlement_classification_audit_2026-09-08.md)                | Wider country/date coverage and retrocharge checks; [measurements](settlement_classification_audit_2026-09-08.json). |
| [Trailing columns](settlement_trailing_columns_investigation_2026-09-11.md)          | Optional suffix-cell omissions and the limits of the parsing convention.                                             |
| [Data Kiosk disposal discrepancy](data_kiosk_disposal_discrepancy_2026-09-07.md)     | Accepted source variance and [sanitized controls](data_kiosk_disposal_discrepancy_2026-09-07.json).                  |
| [Company-cost country evidence](category3_country_evidence_2026-09-13.md)            | Native cost labels, taxes, credits, and [coverage measurements](category3_country_evidence_2026-09-13.json).         |
| [EPR and adjustment coverage](data_kiosk_epr_and_adjustment_coverage_2026-09-13.md)  | Why the checked sources do not establish an approved counterpart mapping.                                            |
| [Current metadata and read performance](simple_metadata_access_2026-09-26/README.md) | Current-reference access contract, exact-result checks, million-row fixtures, and concurrent-reader measurements.    |

The [performance guide](../database_performance.md) describes the current query design and remaining
costs. New measurements use the [maintained benchmark harness](../../services/db/supabase/benchmarks/README.md).
Superseded query experiments and intermediate performance snapshots are not part of the maintained
codebase. The retained performance report is a dated local checkpoint, not a production guarantee.

Historical FBA and Finances comparisons corroborate source findings; those APIs are not application
inputs. Evidence excludes raw financial documents, seller/customer identifiers, credentials, and
signed URLs.
