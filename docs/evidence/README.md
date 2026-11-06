# Amazon-source evidence

These dated records preserve independently observed Amazon amounts, source limitations and native
field behavior. They support the current contracts but are not deployment instructions or evidence
that the old implementation remains installed. Original aggregate files retain the fields and
terminology of their capture date.

| Record                                                                                                                                        | Source finding                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Finances verification](finances_verification_2026-10-14.md)                                                                                  | Native activity agrees with independent Summary/PDF controls; original/release rules, marketplace availability and historical-query probes. |
| [Finances and Data Kiosk differences](finances_data_kiosk_differences_2026-10-14.md)                                                          | Component definitions, posting dates, account movements and persistent cost discrepancies.                                                  |
| [Expanded source comparison](expanded_source_comparison_2026-10-17.md) · [amounts](expanded_source_comparison_2026-10-17.json)                | January–October observations across retail markets, operational disposal evidence and fee/timing gaps.                                      |
| [Source refresh](source_refresh_2026-10-18.md) · [results](source_refresh_2026-10-18.json)                                                    | New captures, Summary agreement and changes between overlapping Data Kiosk responses.                                                       |
| [SKU cost allocation feasibility](sku_cost_allocation_feasibility_2026-10-18.md) · [results](sku_cost_allocation_feasibility_2026-10-18.json) | Independent fee-allocation sources and limits of reconstructing exact SKU shares.                                                           |
| [Data Kiosk cost discrepancies](data_kiosk_payout_impact_2026-10-02.md)                                                                       | Verified missing/extra costs and unresolved ownership, independent of account-level Summary agreement.                                      |
| [Inventory captures](inventory/README.md)                                                                                                     | Real US/Japan report fields, missing metrics, exact-value ingestion and replay observations.                                                |

Aggregate files exclude credentials, private document locations and raw customer/SKU identifiers.
Original API responses, PDFs and XZ archives remain in ignored private output directories.
Obsolete preview screenshots, old HTTP replay reports and superseded test-suite totals are removed;
current reproducible checks are documented in the [database guide](../../services/db/supabase/README.md#verification)
and [sync guide](../../services/sync/README.md#verification).
