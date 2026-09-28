# Source and performance evidence

These records support the current [classification](../settlement_component_categories.md),
[source allocation](../source_allocation.md), and [workflow](../data_workflows.md) contracts.
Source observations retain their dates and coverage limits. Performance evidence records the
current SKU identity model; superseded query and index experiments are not maintained.

| Record | Purpose |
| --- | --- |
| [Global SKU performance](global_sku_identity/README.md) | Shared-SKU authenticated reads across namespaces, index sizes, and query plans. |
| [Type registry validation](type_registry_2026-09-26/README.md) | Real-seed coverage and complete Settlement replay for the active explicit registry. |
| [Blank marketplaces](blank_marketplace_investigation_2026-09-06.md) | Source names, Reports API hints, and account-level activity. |
| [SKU completeness](settlement_sku_completeness_2026-09-07.md) | Observed SKU-bearing families and their coverage. |
| [Settlement classification](settlement_classification_audit_2026-09-08.md) | Country coverage, retrocharge groups, and out-of-period postings. |
| [Trailing columns](settlement_trailing_columns_investigation_2026-09-11.md) | Source rows supporting optional trailing-omission parsing. |
| [Data Kiosk disposal discrepancy](data_kiosk_disposal_discrepancy_2026-09-07.md) | Measured variance, fresh-query controls, and unresolved cause. |
| [Company-cost countries](category3_country_evidence_2026-09-13.md) | Source cost labels, taxes, credits, and observed country coverage. |
| [EPR and adjustments](data_kiosk_epr_and_adjustment_coverage_2026-09-13.md) | Checked responses and the limits of individual cost mapping. |

The [performance guide](../database_performance.md) describes current access paths and remaining
costs. The [benchmark package](../../services/db/supabase/benchmarks/README.md) measures installed
queries on disposable local clones.

Historical FBA and Finances comparisons corroborate source findings; those APIs are not application
inputs. Evidence excludes raw financial documents, seller/customer identifiers, credentials, and
signed URLs.
