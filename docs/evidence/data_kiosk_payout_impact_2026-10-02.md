# Data Kiosk cost discrepancies

These are dated findings from the October 2, 2026 investigation of the `DATA_KIOSK` allocation
category. They remain relevant because Data Kiosk still supplies company costs at every age.
The Finances replacement does not correct these upstream values or establish missing SKU ownership.
Historical billed controls included archived account statements, native Finances events and FBA
operation reports. They are evidence for the stated cohorts, not newly measured October 14 totals.

The audit covered 5,135 then-current category rows: 647 fee rows and 4,488 Sponsored Products rows.
Stored signs, exact amounts, currencies, quantities and component identities matched the native
Data Kiosk payloads. Fees used their final `totalAmount` once, without adding its tax/promotion
breakdown again. Faithful ingestion does not establish completeness or correctness of Amazon's
allocations. The current [type registry](../transaction_type_registry.md) is the maintained catalog.

## Why account reconciliation does not repair a company payout

A company's Data Kiosk cost enters its amount directly, without another service-fee percentage.
The account reconciliation difference remains with SelBox. For example, a real cost of 10 should
reduce 1,000 to 990. If Data Kiosk supplies 20, the company calculation becomes 980 while SelBox
retains a +10 control difference. Account totals can balance while the company allocation is wrong.
Missing costs can overstate company amounts; duplicated costs can understate them. Moving the same
cost to a different company can misstate both without changing the account net. See
[source allocation](../source_allocation.md) and [payouts](../company_payout_reports.md).

## Verified differences

| Cohort | Observation | Remaining qualification |
| --- | --- | --- |
| German June transport/program | MSKU query 144.3912 EUR; CHILD_ASIN query 228.7198 EUR; 84.3286 absent at SKU level. | Child-ASIN amounts matched independently billed shipment cohorts; Data Kiosk did not provide native shipment IDs. |
| German July transport/program | MSKU query 53.0129 EUR; CHILD_ASIN query 123.06 EUR; 70.0471 absent at SKU level. | Shipment contents, ASIN, units and fees corroborate the missing product allocation. This does not justify switching every query to child-ASIN level. |
| Canadian July coupon participation | An independently identified native Finances charge was 2 CAD; both MSKU and CHILD_ASIN queries omitted coupon fees. | No later counterpart appeared through the captured September history. SKU/company attribution and Amazon's internal cause remain unresolved. August had the same observed omission. |
| German July deal | Participation charges totaled 32 EUR versus 16.0006 allocated; performance was 6.17 versus 6.1702. | Net missing deduction 15.9992 EUR; the deal-to-SKU link was unavailable. |
| US July disposal | Data Kiosk 219.12 USD versus billed 198.69; matching-payload excess 20.43. | Equal fee payloads do not establish a universally safe duplicate-removal rule or the correct company. |
| EUR July disposal | The 17.76 EUR difference included 5.18 of verified later postings and 12.58 of matching-payload excess. | The timing portion is not another excess cost. |
| US August disposal | Both product aggregation levels returned 57.50 USD versus billed 33.96. | The 23.54 difference persists in Amazon's parent totals. |
| US August placement | Both product aggregation levels returned 1,470.08 USD versus an independently corroborated 636.92. | Extra 833.16 affected then-current estimates; native missing event IDs prevent a general automatic deduplication rule. |
| Australia August disposal | A corroborated 101-unit fee of 23.33 AUD appeared twice in Data Kiosk, totaling 46.66. | A separate 0.23 charge makes the whole-month gap 23.10. The repeated cohort itself differs by 23.33. |

German June and July missing SKU allocations total **154.3757 EUR**. The July account comparison
also included **114.36 EUR of June 30 activity billed July 1**. Consequently the full July comparison
of 184.4071 was not a July company correction: 114.36 concerned timing and 70.0471 concerned missing
July SKU cost. Two distinct same-amount shipment charges were distinguished using native shipment
contents, rather than amount-only matching.

Fresh child-ASIN queries reproduced the US disposal/placement and Australian disposal totals. A
global product-aggregation switch would therefore leave those excesses unresolved. Checked monthly
storage cohorts matched following-month billing to currency precision. Checked Japanese labeling
amounts agreed with Finances, including tax; repeated same-value charges had separate native billing
identities and were not duplicates.

## Historical report exposure and unresolved ownership

At the investigation date, 2,723 Data Kiosk-category components in the latest saved reports were
authoritative, with zero service fee and company amounts equal to source amounts. All 1,336 July
category rows were preserved in those reports. The suspected costs were therefore inputs to company
calculations, rather than merely diagnostic display rows.

The frozen local fixture terms assigned both missing German allocations to the same company,
identifying 84.3286 and 70.0471 EUR of possible downward corrections for June and July. Other repeated
costs involved either one company or competing SKU aliases assigned to different companies. Those
historical assignments are not proof of real business ownership or permission to change current
source rows. No correction or automatic duplicate-removal rule was approved by the investigation.

Eleven September Japanese Sponsored Products rows totaling 6,888.51 JPY lacked ownership and were
blocked from complete company calculations. This was a configuration gap, not a silently deducted
amount or proof that a payment was made. Advertising invoice scope and per-SKU attribution remain
separate work pending Ads API access.

## Evidence and current boundaries

Private queries and comparisons remain under `output/data-kiosk-payout-audit-2026-10-02/`,
`output/non-ad-reconciliation-2026-10-01/` and
`output/financial-review-investigation-2026-10-02/`. This condensed record preserves the findings;
it does not relabel historical controls as new Finances pipeline measurements.

The [October 14 verification](finances_verification_2026-10-14.md) establishes agreement between new
Finances activity and Amazon Summary for its tested scopes. It does not negate the Data Kiosk
omissions, extra amounts, date differences or ownership gaps described here.
