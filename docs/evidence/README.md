# Design decision evidence

These source and implementation investigations support the final [classification](../settlement_component_categories.md),
[source-allocation](../source_allocation.md), and [workflow](../data_workflows.md)
contracts. Each record preserves its observation date, sample scope, and limits.
The contracts define current behavior; the evidence explains the decisions and
helps evaluate future source changes.

| Investigation                                                                                     | Evidence retained                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Blank marketplaces, September 6](blank_marketplace_investigation_2026-09-06.md)                  | Reports API hints versus row names, balance movements, and investigative Finances matches.                                                           |
| [SKU completeness, September 7](settlement_sku_completeness_2026-09-07.md)                        | All 107 raw triples and SKU presence across NA, EU, Australia, and Singapore; [sanitized measurements](settlement_sku_completeness_2026-09-07.json). |
| [Classification audit, September 8](settlement_classification_audit_2026-09-08.md)                | Wider date and marketplace coverage, retrocharge qualifications, and [sanitized measurements](settlement_classification_audit_2026-09-08.json).      |
| [Trailing columns, September 11](settlement_trailing_columns_investigation_2026-09-11.md)         | Acquisition-time evidence for omitted optional suffix cells and limits of the parsing assumption.                                                    |
| [Data Kiosk disposal discrepancy, September 7](data_kiosk_disposal_discrepancy_2026-09-07.md)     | The accepted USD 54.48 source difference and [sanitized controls](data_kiosk_disposal_discrepancy_2026-09-07.json).                                  |
| [Company-cost country evidence, September 13](category3_country_evidence_2026-09-13.md)           | Native labels, tax and credit shapes across 15 countries; [sanitized measurements](category3_country_evidence_2026-09-13.json) and coverage limits.  |
| [EPR and adjustment coverage, September 13](data_kiosk_epr_and_adjustment_coverage_2026-09-13.md) | No explicit counterpart in the checked US/GB Economics responses; mapping remains unverified.                                                        |
| [Frontend table loading, September 19](frontend_table_loading_2026-09-19.md)                      | Local authenticated HTTP timings, database plan evidence, and frontend loading factors; database remediation deferred.                               |

Historical FBA, Finances, and inventory comparisons corroborate specific findings;
those APIs are not inputs to the application. Raw financial documents, seller and
customer identifiers, credentials, and signed URLs are not checked in.
