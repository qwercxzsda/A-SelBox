# Verification evidence

These records identify the source, date and scope of each check. They are evidence for the maintained
[Finances contract](../finances_transactions.md), [workflow](../data_workflows.md) and
[inventory contract](../inventory_daily_captures.md), rather than alternative setup instructions.

| Record | Scope |
| --- | --- |
| [Source refresh and review visibility](source_refresh_2026-10-18.md) · [results](source_refresh_2026-10-18.json) | Fresh October captures, complete January 1–October 16 daily coverage, Summary agreement, and maturity/pagination explanations for apparently missing months. |
| [SKU cost allocation feasibility](sku_cost_allocation_feasibility_2026-10-18.md) · [results](sku_cost_allocation_feasibility_2026-10-18.json) | Independent fee-allocation APIs, live removal/aged-storage/Finances checks, transport formula tests, and limits of reproducing Data Kiosk SKU shares. |
| [Expanded source comparison](expanded_source_comparison_2026-10-17.md) · [amounts](expanded_source_comparison_2026-10-17.json) | January–October history across all 18 retail markets, native Summary controls, changing Data Kiosk responses, and operation-level explanations of disposal and fee gaps. |
| [Finances verification](finances_verification_2026-10-14.md) | Newly acquired real API pages through offline preprocessing and the SQL baseline, independent Summary equality, earlier PDF/API controls, and separate Auth/Storage/REST/browser regression checks. |
| [Finances and Data Kiosk differences](finances_data_kiosk_differences_2026-10-14.md) | Exact July difference decomposition, account movements, purchase/posting timing, native component scope, a fresh Sweden query, and remaining cost discrepancies. |
| [Data Kiosk cost discrepancies](data_kiosk_payout_impact_2026-10-02.md) | Dated upstream cost/ownership findings that remain independent of Finances Summary agreement. |
| [Inventory verification](inventory/README.md) | Dated real US/Japan Inventory Planning captures and responsive UI checks; current behavior remains defined by the inventory contract. |

The Finances aggregate JSON files contain marketplace/account scopes, currencies, amounts and
counts. They exclude seller/customer identifiers, SKUs, credentials and private document locations.
Original API responses, PDF extracts and raw archives remain in ignored private output directories.
Obsolete source-format and removed-schema investigations are not maintained as application contracts.

Historical role labels in inventory evidence retain their dated meaning: `operator` is the current
Administrator (`administrator`) and `company_member` is Member (`member`). Current code and access
contracts use Administrator, Member and Unassigned.
