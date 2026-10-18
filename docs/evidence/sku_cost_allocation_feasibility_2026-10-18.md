# SKU cost allocation feasibility

A partial replacement of Data Kiosk cost allocations is feasible. Removal-order reports and
aged-storage reports supply actual SKU amounts for identifiable operations or assessments.
Mixed-SKU transport can be approximated from independently retrieved product measurements, but
an exact independent reproduction of Amazon's split has not been established. Other shared fees
still need more evidence, a Seller Central export, or an explicitly chosen allocation rule.

This investigation evaluates the current `DATA_KIOSK` cost category. It does not change the
[source policy](../source_allocation.md), transaction dates, SKU ownership or company amounts.
Advertising account access remains unavailable; its API findings are documentation checks.

## Meaning of exact allocation

Following the requested criterion, allocation is direct when Amazon supplies each SKU's own
monetary share, or the charge's verified complete item set contains one SKU. Quantities, weights,
volume, sales and an account total alone do not establish the actual shares of a multi-SKU charge.
Reconstruction from those inputs remains **difficult**, even when it is easy to program.

An exact operation-level SKU total is distinct from an exact SKU for every partial posting.
Where all postings belong to the same month, operation-level amounts can establish that month's
SKU totals; they need not establish the split for an arbitrary day range.

## What Amazon documents about Data Kiosk

The Economics schema describes product/date aggregates. It gives the arithmetic
`totalAmount = amount - promotionAmount + taxAmount` and
`amountPerUnit = totalAmount / quantity`, but no general operation that accepts a financial
transaction and returns its SKU allocation. The per-unit value is a derived average. Fee
properties/components are optional; component expansion currently supports fulfillment and
storage, not transport or disposal. The current aggregation enum contains MSKU, CHILD_ASIN and
PARENT_ASIN. [Official Economics schema](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

Amazon's SKU Economics help documents a crucial limitation: **when multiple MSKUs share one
FNSKU, the same storage fee can be displayed for each MSKU**. Such rows are not a partition of
the account bill. The page also describes daily storage estimates as a monthly amount divided
across the service month's days, with billing in the following month. Its transport description
uses the greater of dimensional and shipment weight, with dimensional weight based on current
product dimensions. It does not specify the complete mixed-SKU allocation formula.
[SKU Economics help](https://sellercentral.amazon.se/help/hub/reference/external/GNG95QWKFKSAMYJV?mons_sel_locale=en_GB),
[report definitions](https://sellercentral.amazon.se/help/hub/reference/external/GZ8Y22NL2FSRY8M5?mons_sel_locale=en_GB).

The storage statement must not be generalized to every fee. In the proved US and Australian
disposal duplicates, both Data Kiosk SKU rows have `fnsku = null`; the operational report has
one nonempty FNSKU. Shared ASIN identity is established, but the returned fields cannot prove
that both SKU rows share that FNSKU or explain Amazon's internal disposal mapping.
Separate retained removal history does associate both US SKU strings with the same FNSKU,
supporting a historical alias explanation. This does not prove concurrent ownership or that
the storage display rule is intended for disposal. The additional Australian SKU lacks that
operational FNSKU association in the retained reports.

## Fee by fee decision

| Fee or circumstance | Independent source | Decision under the requested rule |
| --- | --- | --- |
| Completed removal/disposal operation | Removal Order Detail: order ID, SKU/FNSKU, executed quantities, removal fee and currency | **Direct operation/SKU amounts available**, subject to complete financial reconciliation. Single-SKU operations also resolve their partial postings. |
| Multi-SKU removal operation with partial postings | Same report, but no native financial item link for the partial charges | **Direct operation/month totals when every posting is in that month; individual posting/day allocation remains difficult.** |
| Customer-return disposal | Returns report and financial shipment/refund item contexts | **Difficult unless the complete billed item set identifies one SKU.** The returns report supplies no disposal price. |
| Aged storage | Long Term Storage Fee Charges report: SKU, FNSKU, quantity and amount charged | **Direct SKU amounts available.** Live tests pass some ledger controls; a four-cent US January residual prevents an unconditional replacement. |
| Monthly storage | Storage Fees report: ASIN/FNSKU and estimated monthly fee | **Difficult for exact billed SKU shares**, especially shared FNSKUs. Estimates and one-to-one identity mappings require separate validation. |
| Single-SKU transport with a verified reference | Finances charge plus complete shipment items | **Direct by the single-SKU exception.** Missing references remain unresolved. |
| Mixed-SKU transport | Inbound items/boxes/options, Catalog Items and FNSKU measurements | **Difficult.** A billable-weight approximation is close in tested cases, but no exact source-provided SKU freight share was found. |
| Ordinary labeling/prep | Inbound item prep instructions and fee fields | **Difficult for multi-SKU billed shares.** Planned/service fee fields do not establish completed historical charges. |
| Placement | Inbound placement-option fees; Seller Central actual-fee CSV | **Difficult using the documented SP-API alone.** A separate console export can supply actual SKU charges. |
| Coupons/deals | Performance reports and the new Promotions API | **Difficult for multi-SKU fees.** These identify selections, performance and fee rates, not each SKU's charged share. Verified single-SKU promotions are an exception. |
| Advertising | Ads Reporting v1 SKU dimension and reconciled cost metric | **Documented direct-SKU-cost candidate, untested without access.** Billing scope and unsupported/missing SKU rows still need checks. |

## Removal and disposal evidence

In the retained January 1–October 15 observations, financial `ORDER_ID` values match
removal-report `order-id` values. Grouping each eligible
financial posting once and comparing the complete operation to all report item fees gives:

| Market | Completed operations with one cost-bearing SKU | Completed operations with several cost-bearing SKUs | Corresponding native fee amount |
| --- | ---: | ---: | ---: |
| US | 24 | 2 | USD 703.93 |
| Japan | 5 | 1 | JPY 5,050 |
| Australia | 16 | 0 | AUD 133.50 |
| UK | 26 | 2 | GBP 458.48 |
| Canada | 4 | 0 | CAD 7.74 |

These are matched subsets, not universal coverage. Zero-cost operations are retained separately.
Japan includes a return operation as well as disposal. Other customer-order or unmatched
operations remain in the evidence and are not treated as zero.
The table counts cost-bearing SKUs. Before applying the single-SKU exception to individual
postings, the complete billed item set must also be verified; a zero-net SKU could otherwise
hide offsetting charges and credits.

One completed US disposal operation costs **$157.67**, with report SKU amounts **$132.72,
$22.68 and $2.27**. Its six July financial postings include three separate **$0.84** charges
without SKU links. The operation's July SKU totals are known, but the report does not identify
which SKU belongs to each $0.84 posting. An observed equal amount is insufficient identity.

The Inventory Ledger Detailed report is a further candidate for item execution evidence. Its
documented movement dates, reference ID, MSKU/FNSKU and quantities do not themselves promise a
native financial posting ID or fee amount. That distinction remains necessary when testing a join.
[Removal Order Detail and Inventory Ledger report contracts](https://developer-docs.amazon/sp-api/docs/report-type-values-fba).

A live July US Ledger report returned **3,788 movements**. All **213 VendorReturns** rows had
blank reference IDs. The target operation's FNSKUs show expired-removal quantities **27, 1 and
158**, exactly matching its three removal-report item quantities, but there is no monetary fee
column or billing-item link and the returned timestamps are local midnight. One FNSKU's ledger
MSKU differs from the removal report's SKU by more than letter case. This corroborates physical
execution without establishing the individual financial-posting split or interchangeable ownership.

## Transport reconstruction tests

Three completed German shipment cohorts were matched through native references, v2024 inbound
plans/shipments, fully paginated item and box records, and selected UPS transport options. In
these cases, selected quotes equal the native totals **€114.36, €114.36 and €105.56**; the API
still defines quotes as estimates, so the observed equality is not a universal contract.

The comparison targets are complete CHILD_ASIN/DAY observations captured on October 2. Each
product maps to one SKU within the corresponding shipment. These retained product partitions
provide the quantities and reference amounts; they are distinct from the incomplete latest MSKU
allocations described in the [expanded source comparison](expanded_source_comparison_2026-10-17.md).

Independent inputs include current Catalog Items dimensions/weights, declared carton
weights/volumes and retained German FNSKU measurements from a Storage Fees report. All boxes in
these three cohorts contain a single SKU, making their declared carton shares testable.
Quantity-only, catalog weight/volume, carton weight/volume and simple FNSKU weight/volume rules
fail to reproduce every SKU within one cent. In the first cohort, quantity allocation alone
misallocates one product's carrier fee by **€75.85**.

A motivated hypothesis is much closer:

```text
driver for SKU = shipped quantity × max(unit weight kg, unit volume cm³ / 5000)
allocated cost = financial cost × SKU driver / sum of shipment drivers
```

The divisor appears in Amazon's FBA product dimensional-weight rules; applying proportional
drivers to inbound transport is the tested hypothesis, not a published allocation contract.
[Amazon dimensional-weight explanation](https://sellercentral.amazon.de/seller-forums/discussions/t/1bafad3b1fbdbd7a0269d3d0c0b391d8).

| Shipment economic date | Largest carrier-fee difference for one product | Largest difference including transportation-program fee |
| --- | ---: | ---: |
| June 8 | €0.11386 | €0.13782 |
| June 30 | €0.13495 | €0.16330 |
| July 2 | €0.11955 | €0.14467 |

These tests use independently retrieved, rounded FNSKU measurements rather than fitting weights
to Data Kiosk's costs. They support a similar allocation approach, but do not establish exact
Amazon rounding, measurement versions, or generality beyond the three cohorts.

FNSKU identity matters: two products can have the same current ASIN-level catalog dimensions
while their labeled/stickerless FNSKUs have different measured packages. In the two June cohorts,
the product counts and carrier bill are identical, but one FNSKU changes and its Data Kiosk
carrier allocation changes from **€4.2028 to €17.6662**. The retained FNSKU measurements capture
a corresponding packaging-volume difference that current Catalog Items alone misses.

Fitting weights to June 30 Data Kiosk amounts predicts July 2 closely, but that is calibrated
reproduction using Data Kiosk, not independent evidence of the rule. Exact total conservation
also proves only that the bill was fully distributed, not that each SKU received the right share.

Across the wider 15-event German sample, 13 events expose a usable shipment reference inside an
opaque item-level `TRANSACTION_ID`; two do not. There is no populated top-level `SHIPMENT_ID`
or native SKU freight price in those events. Such references need validation against shipment
records rather than unconditional parsing of every financial transaction.
[Shipment item API](https://developer-docs.amazon/sp-api/reference/getshipmentitemsbyshipmentid),
[current inbound model](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json).

## Additional APIs and live checks

Five narrow Finances v0 requests reproduced known US disposal, Japanese labeling and German
transport charges, including an ambiguous $0.84 partial disposal and Canada's unmatched January
CAD 55.80 disposal. All five complete pages omitted `SellerSKU`, `FnSKU` and `ASIN` for the target
charges. Optional fields in the schema therefore do not resolve these observed gaps.
[Finances v0 model](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/finances-api-model/financesV0.json).

The aged-storage report was retrieved for July and January. July directly identifies US **$4.83**
and Canadian **CAD 49.52** charges; both match Finances and their Data Kiosk SKU amounts. January
returns **12 US SKUs** and **3 Canadian SKUs**. Canada totals **CAD 60.33**, matching Finances.
US report lines total **$41.23**, while Finances is **$41.19** and Data Kiosk **$41.1899**. The
four-cent ledger residual is retained rather than spread across products without evidence.
No tax or promotion explains it. Four report SKU totals are one cent above their rounded Data
Kiosk counterparts. Two occur on single report lines, so summing rounded age buckets alone is
not an established explanation. The exact rounding or upstream allocation cause remains open.
Reports returned multiple countries even when requested with the US marketplace, so country and
currency filtering are essential. The report supplies source SKU shares, but no native financial
transaction ID. [Aged-storage report](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-long-term-storage-fee-charges-report).

The new Promotions API exposes promotion selections and fee snapshots. It can help establish
which SKUs are eligible, including the single-SKU exception. Its performance reports do not
supply each product's actual participation/performance fee. Discounts, revenue and redemption
counts must not be substituted for Amazon fee allocations.
[Promotions API](https://developer-docs.amazon/sp-api/docs/promotions-api),
[performance report contracts](https://developer-docs.amazon/sp-api/docs/report-type-values-performance).

Ads Reporting v1 documents `advertisedProductSku.value` with `metric.totalCostReconciled`, a
promising source-provided monetary share. Its `date.value` dimension documents 24 months of history
and a 120-day request span. No Ads account query was made. SKU availability by ad product,
invoice linkage, taxes, credits and billing dates remain unverified; campaign-level or ASIN-only
rows are not automatically SKU shares.
[SKU dimension](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/dimensions/product/advertised-product-sku),
[reconciled costs](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/metrics/costs-and-fees/costs),
[date coverage](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/dates).

Ordinary labeling differs from unplanned prep/noncompliance. The Inbound Performance report has
SKU and fee-total fields for inbound problems, but that is not proof it covers ordinary labeling.
Those defect fees currently belong to `SELBOX`; this investigation does not reclassify them.
The placement service fee help documents a separate Seller Central download of actual charges
by SKU. A corresponding public SP-API report type was not found; option-level API quotes are not
a replacement for those billed item rows.
[Inbound Performance report](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-inbound-performance-report),
[placement fee help](https://sellercentral.amazon.com/help/hub/reference/external/GC3Q44PBK8BXQW3Z?itemid=211&locale=en-us).

## Decision for A SelBox

**Deferred on October 18, 2026:** the user postponed handling the cost-allocation issue.
The current source policy remains in place. The alternatives below are retained as findings
for later consideration, not an active implementation plan.

We do not need Data Kiosk to determine the account charge: Finances already supplies that amount
and its posting date. Nor do we need it for every SKU allocation. Matched removal/disposal
reports and reconciled aged-storage assessments are concrete independent alternatives.

For difficult families, a chosen weighted allocation is implementable and can conserve the
financial total, but it must be labeled as our policy rather than an Amazon-provided share.
If the requirement is Amazon's exact SKU split, those cases still need Data Kiosk, an itemized
operational document/export, or additional evidence. Data Kiosk itself is not guaranteed to
provide an additive or correct split, so keeping it does not remove the validation requirement.

A future implementation should keep the original financial amount/date once, attach versioned
allocation evidence, distinguish direct allocations from policy estimates, and retain unresolved
amounts. It should not scale unreliable Data Kiosk rows to force a matching total, infer ownership
from ASIN alone, or treat a complete report as proof of complete item-level billing lineage.

The [aggregate evidence](sku_cost_allocation_feasibility_2026-10-18.json) records the tested
cohorts, API routes, amounts and limitations without private identifiers.
Reproducible scripts, private captures, model comparisons, API coverage and reconciliations are
under `output/sku-cost-allocation-review-2026-10-18/`. This investigation made no production-code,
database-publication, fee-policy or ownership changes.
