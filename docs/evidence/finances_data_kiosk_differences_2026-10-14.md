# Finances and Data Kiosk differences

The July 2026 comparison mixes product economics, account movements, posting dates and
upstream Data Kiosk discrepancies. Its combined difference is not an accounting-error score.
Finances agrees with the independently captured Amazon Summary controls; that does not make
Data Kiosk's product amounts equivalent to an account activity statement.

This investigation keeps July 1–31 and the October 2 Data Kiosk snapshot unchanged. All
marketplaces and source namespaces are aggregated separately by currency. A fresh Sweden
DAY/MSKU query repeats the same July dates. Existing adjacent-month captures identify event
timing; they do not change the comparison or calculation dates. No application rules, database
facts or payout inputs were modified.

## Exact decomposition

Every value below is signed **Finances minus Data Kiosk**. Account items are the Finances
SelBox-category amounts; July Data Kiosk returned no corresponding category rows. Values are
rounded for display; the private numerical evidence retains exact decimals.

| Currency | Sales and transaction fees | Advertising | Other allocated costs | Account items | Total difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| USD | -5.64 | -1,660.40 | +26.74 | -8.46 | -1,647.76 |
| EUR | -230.50 | -853.18 | -174.21 | +3,355.14 | +2,097.25 |
| GBP | -420.96 | -1,379.96 | -61.97 | +1,550.06 | -312.83 |
| JPY | +54,694.37 | +10,032.04 | +307.89 | -1,036.00 | +63,998.30 |
| AUD | -160.12 | -273.66 | +0.82 | -11.62 | -444.58 |
| CAD | 0.00 | 0.00 | -2.52 | +9.04 | +6.52 |
| PLN | -7.03 | -70.45 | 0.00 | +44.96 | -32.52 |
| SEK | -1,237.79 | -120.58 | 0.00 | +12.89 | -1,345.48 |
| SGD | 0.00 | -5.62 | -0.06 | +80.93 | +75.25 |
| MXN | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

For USD, the old direct-category gap of **+1,264.75** offset much of the unchanged
**-1,633.6631** cost gap. The new direct-category gap is **-5.64**. Removing the old offset
increased the absolute combined gap even though sales and transaction fees now agree much more
closely. Comparing only the size of the combined difference conceals this improvement.

## Account movements explain large apparent differences

The EUR account subtotal is **3,355.14 of debt-payment credits**, with reserve and cross-account
offsets netting to zero. GBP is debt-payment credits **1,725.95**, less inbound defect charges
**169.80**, subscription **5.29**, and a liquidation tax adjustment **0.80**. CAD is a failed
disbursement credit **15.38** less subscription **6.34**. SGD consists of two failed-disbursement
credits, **40.50** and **40.43**. These amounts are not missing product sales or profit.

The old EUR source also included **-4,117.20 of Payable to Amazon entries**; these do not appear
as equivalent native activity in the Summary-matching calculation. The old Singapore statements
ended July 20 and omitted the July 23 credit of **40.43**. Thus both source scope and missing old
statement coverage explain changes in the combined comparison.

Data Kiosk describes product sales, fees, advertising and product costs. Its schema has no
debt-recovery, failed-disbursement or reserve transaction collection. Subscription fees may be
supported; their absence in this July snapshot is not a universal exclusion.
[Official Economics schema](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

## Japan mostly compares different monetary components

Japan's direct-category difference is exactly:

| Contribution | JPY difference |
| --- | ---: |
| Product and shipping tax | +71,590.00 |
| Promotions | -15,027.00 |
| Points | -8,436.00 |
| Shipping credits less chargebacks | +7,871.00 |
| Combined product and shipping refunds | 0.00 |
| Ordered sales | -1,609.63 |
| Referral fees | +306.00 |
| Other direct fees and reimbursements | 0.00 |
| Total | +54,694.37 |

One July 25 product/day has **873 product sales in both sources**, while Finances separately
records **87 tax** and **-10 points**. All seven refund SKU/day groups match when product and
shipping refunds are combined. One July 8 Data Kiosk refund of **1,823** equals two **873**
product refunds plus **77** shipping in Finances.

The remaining **-1,303.63** causal difference is ordered sales **-1,609.63** plus referral fees
**+306**, limited to four product SKUs. Its underlying cause is unresolved; it is not established
as timing or as an eventual correction. These details prevent attributing the entire gap to tax.

## Sweden has a persistent source discrepancy

For original July activity, Finances contains fulfillment fees **-1,100.68 SEK** and referral
fees **-210.52 SEK**. Data Kiosk returns zero fulfillment fees and no ordinary referral-fee
charge rows; referral refunds and refund administration are present and match.
Other direct lines offset **+73.41**, leaving the direct-category gap **-1,237.79**.

A fresh query completed on October 14 using the unchanged July DAY/MSKU query: one complete
page, 155 product/day rows, 28 fulfillment charges totaling zero, and no ordinary referral charges.
The fulfillment components sum base **-15.91** plus fuel **+15.91** to zero. The behavior matches
the retained September 14 and October 1 captures, 75 days after July ended.

For a July 14 product/day, both sources report **104.86 sales**. Finances deducts **58.28
fulfillment** and **10.48 referral**, while Data Kiosk reports zero and no row respectively.
The discrepancy is already in Amazon's returned parent fee amounts, not introduced by our
parser. Amazon's internal reason is unproved; waiting has not corrected the observed data.

## Original posting dates still differ from purchase dates

Native order identifiers joined to retained AllOrders reports establish timing differences even
after linked release copies are excluded. Every nonzero original July product-sale principal
in the checked US, UK, Australian and EU cohorts matched a known purchase cohort.

For the UK, July original financial postings contain **336.19 of June purchases**, while
**498.53 of July purchases first post in August**. The difference is **-162.34**. Original
activity date is therefore not necessarily purchase date.

| Currency | Posting versus purchase timing | Same-purchase sales basis difference | Refund difference | Product promotions | Net sales difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| USD | +143.62 | -67.61 | -25.47 | -44.35 | +6.19 |
| GBP | -162.34 | -274.52 | +8.61 | -9.53 | -437.78 |
| EUR | +200.52 | -399.49 | +9.96 | -20.00 | -209.01 |
| AUD | +43.12 | -204.09 | +3.99 | 0.00 | -156.98 |
| PLN | -24.38 | +14.35 | 0.00 | 0.00 | -10.03 |
| SEK | +126.38 | -44.26 | -6.53 | 0.00 | +75.59 |

The same-purchase basis column remains unresolved source-value or definition differences.
For Australia, **202.45 net customer shipping** nearly accounts for the **204.09** basis gap,
leaving **1.64**; this does not establish a universal conversion rule. Refund timing differs by
contract: Data Kiosk uses refund request time, while Finances selects financial posting time.
[Economics sales fields](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql),
[Finances posting filters](https://developer-docs.amazon/sp-api/reference/listtransactions).

## Non-advertising costs include timing and actual missing or excess amounts

- **Storage:** Data Kiosk assigns a service month while billing commonly occurs the following
  month. US July Data Kiosk storage is **48.3396**, billed as **48.34 in August**; the July
  financial charge **42.04** corresponds to June. The same-month **+6.2996** difference is
  explained without moving the calculation dates. Japan's **+308 storage-month difference**,
  offset by **-0.1074** of other precision differences, explains its **+307.8926** non-ad cost gap.
- **UK disposal and removal:** the **-54.02** and **-8.33** July gaps correspond to prior-month
  removal orders charged in July. With storage **+0.38** and deal precision **-0.0027**, these
  explain the **-61.9727** non-ad cost total.
- **German transport:** the July gap **-184.4071** comprises **-114.36** for June service billed
  in July and **-70.0471** of July SKU allocation missing from Data Kiosk. Fresh earlier MSKU
  queries missed the amount while CHILD_ASIN queries returned it; native shipment contents
  corroborated the product/quantity groups. This does not authorize switching all query grains.
- **Canadian coupons:** a native **2 CAD** July charge is absent from both reviewed Data Kiosk
  product grains. Together with storage timing **-0.52**, it explains **-2.52**.
- **German deals:** two distinct **16 EUR** participation charges versus **16.0006** allocated
  leave an approximately **16 EUR** missing cost. This persists across the reviewed query grains.
- **US disposal:** Data Kiosk reports **219.12** against **198.69** independently billed,
  giving **+20.43**. Repeated fee payloads explain arithmetic overlap, but lack of unique native
  billing IDs in those Data Kiosk rows prevents a universal automatic deduplication rule.

These cost findings retain their original verified cohorts and limits in the
[Data Kiosk cost investigation](data_kiosk_payout_impact_2026-10-02.md). Advertising differences
are quantified in the first table; their cause remains deferred pending Ads API access.

## Implications and remaining work

Company calculations use Finances for the direct category at every date. Sweden's missing Data Kiosk
transaction fees and the direct sales comparison gaps therefore affect comparisons without adding
a further deduction to company amounts. Data Kiosk-category costs remain
authoritative even for mature payouts: missing or excessive costs can still misstate company
amounts. An account-level comparison does not repair SKU allocation.

No blanket eventual-consistency conclusion is justified. Matched operation cohorts explain
timing, while Swedish fees and the reviewed SKU/coupon/deal omissions persist across captures.
Unresolved sales/referral bases and advertising require separate evidence; totals must not be
forced to match with balancing entries.

The October 14 investigation found two non-monetary implementation observations: zero-value
Singapore disposal records were not admitted by the zero-item registry, and failed-disbursement
credits carried an operating-expense subtype. The analytical comparison retained the former as
explicit zero exceptions and described the latter as balance credits. Neither changes these amounts.
The October 17 preview backfill added explicit support for the observed zero-value `FBADisposal`
representation, with a regression check that nonzero amounts still require monetary detail.
The failed-disbursement subtype remains unchanged.

Private reproducible evidence is under `output/replacement-difference-comparison/`:
`july-difference-decomposition.json`, `july-selbox-account-detail.json`,
`direct-category-bridge.json`, `japan-minor-differences.json`, `direct-investigation.json`,
`direct-sales-proof.json`, and `sweden-fresh-2026-10-14/`. Earlier operation and fee proofs remain
under `output/non-ad-reconciliation-2026-10-01/` and
`output/data-kiosk-payout-audit-2026-10-02/`. Raw seller, order and SKU identifiers remain private.
