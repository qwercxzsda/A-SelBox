# Expanded Finances and Data Kiosk comparison

The expanded comparison separates delayed billing, different source definitions and incorrect
upstream amounts. More history explains some monthly gaps, but does not make every Data Kiosk
amount converge to Finances. In particular, completed US disposal operations have excess SKU
allocations, and Sweden still lacks older ordinary fulfillment and referral charges.

## Scope and verification

The requested range is **January 1–October 15, 2026**: nine complete calendar months and an
explicitly partial October. October 15 is the common complete-day cutoff across the participating
time zones. The investigation does not move accounting dates, change maturity or ownership rules,
or insert balancing amounts. October remains provisional because recent API activity can arrive
late. [Finances posting filters and availability](https://developer-docs.amazon/sp-api/reference/listtransactions).

Finances preprocessing has completed for all five credential scopes and all **19 native
marketplaces/channels**, including Non-Amazon US. Its 50 acquisitions provide **5,472 complete
marketplace-days**, **126,883 native transactions** and **807,283 components**. All **190 monthly
Summary controls match exactly**, including October 1–15. These controls compare native activity
totals with Amazon Summary; they do not establish that each SKU has the correct Data Kiosk costs.
Previously successful July/August and North American September acquisitions were reused; the
remaining Finances months were downloaded for this expansion. Each control refers to the Summary
captured with that acquisition, not a guarantee that Amazon will never revise historical data.

Data Kiosk is complete for all **18 retail marketplaces**, with **5,184 fresh marketplace-days**
from **45 successful selected acquisitions**, **47,123 native product/day rows** and **82,140
typed components**. All **180 market/month segments** have matching coverage in both sources,
including the partial October segment. Mexico, Saudi Arabia and UAE each returned 288 successful
empty days; failed requests were not converted to zero. The [comparison extract](expanded_source_comparison_2026-10-17.json)
records 100 monthly currency comparisons and cumulative non-advertising cost differences.

The participating retail markets are US, Canada, Mexico, UK, Germany, France, Italy, Spain,
Netherlands, Belgium, Ireland, Poland, Sweden, UAE, Saudi Arabia, Japan, Singapore and Australia.
Brazil, Egypt, India, Turkey and South Africa are absent from this seller's participation list;
bounded Finances probes also return no accessible account group. This is account-specific
availability, not a claim that those countries lack Finances API support. Non-Amazon US is
retained separately in Finances and included in account-wide currency comparisons; it has no
separate retail Data Kiosk counterpart.

Every acquisition is retained before production preprocessing publishes complete daily versions.
Successful empty days are recorded explicitly. European Data Kiosk requests run sequentially,
as Amazon limits simultaneous queries in the same domain. One stalled query created by this
investigation was cancelled and its unfinished work retried in calendar quarters; already
published results were retained. [Data Kiosk query workflow](https://developer-docs.amazon/sp-api/lang-en_us/docs/data-kiosk-workflow-guide).

All monetary differences below use **Finances minus Data Kiosk**, with costs stored as negative
amounts. Thus a positive cost difference means Data Kiosk deducts more. Currencies are never
combined. Equivalent fee aliases, corrections and reversals are grouped before comparing them.
Account movements and product sales definitions are not forced into equivalent categories.

## US disposal: September's difference is fully explained

September Finances disposal is **−$32.03**, versus **−$865.67** in Data Kiosk: a **+$833.64** gap.

| Cause | Contribution to September difference |
| --- | ---: |
| September operation billed in October | +$403.20 |
| Same 480-unit operation allocated to a second SKU | +$403.20 |
| Twelve customer-return units allocated to an additional SKU | +$27.24 |
| Unexplained remainder | $0.00 |

The largest removal order requested 480 units on September 30 and completed all 480 on October 9,
with no units still in progress. Removal Order Detail reports one SKU and a **$403.20** fee.
October Finances carries the same native order ID and charges **$403.20 once**. September Data
Kiosk assigns **480 units and $403.20 to each of two SKUs sharing the ASIN**, totaling $806.40.
One half is delayed billing; the other half is excess allocation.

The other September billed cohorts are also linked: all 16 native disposal transactions match order IDs
in operational reports. The actual SKU amounts agree, but Data Kiosk adds **12 units/$27.24**
to another SKU of the same ASIN. This is supported by executed quantities and operational fees,
not merely two similar monetary amounts.

Consequently **$430.44 of September Data Kiosk disposal costs is excess allocation in the checked
cohorts**. These costs belong to the Data Kiosk category and can affect mature company payouts.
The precise company impact still depends on SKU ownership and report inputs; the source discrepancy is
not itself a company payout calculation.

Data Kiosk does not expose the native removal order ID on these fee rows. The proof combines
complete operational cohorts with SKU/ASIN, request date, executed quantities and billed totals.
It does not justify automatically deleting arbitrary equal-valued rows.

## Australia disposal: the same excess-allocation problem

Australia's January–October 15 disposal totals are **−AUD 133.50 in Finances** and
**−AUD 157.06 in Data Kiosk**, a **+AUD 23.56** difference. Two closed cohorts explain it:

- An August 6 order requested 108 units, cancelled seven and disposed of 101. Its three native
  charges share the report's order ID and total **AUD 23.33**. Data Kiosk assigns **101 units and
  AUD 23.33 to each of two SKUs sharing an ASIN**, although the completed operation charged once.
- A September 3 one-unit disposal similarly charges **AUD 0.23 once** and appears against two
  Data Kiosk SKUs of the same ASIN.

Native operation totals agree with Removal Order Detail throughout the observed range. The two
extra allocations total **AUD 23.56**, exactly the full-period difference. October's separate
463-unit/AUD 106.95 disposal matches across the operational report, Finances and Data Kiosk.
This is another established Data Kiosk cost discrepancy, not an unresolved billing delay.

## Japan disposal: a genuine billing delay

The September 28 order requested 43 units, cancelled eight, and disposed of 35, completing on
October 9. Data Kiosk assigns **¥2,100** to September. Four October Finances charges totaling
**¥2,100** carry that same native order ID. An April 29 one-unit operation similarly appears as
**¥60** in Data Kiosk during April and in Finances on May 9.

Across **January 1–October 15**, disposal totals are **−¥4,860 in each source**. The checked
native operations match operational report fees, and all nonzero Data Kiosk disposal rows match
the corresponding SKU, request date and executed quantity. Here the broader period resolves the
gap, with matched operations establishing why; aggregate cancellation alone would not prove it.

## Japan's historical Data Kiosk response changed

The October 3 broad capture selected in the preview lacked these July fees:

| Fee returned again on October 17 | JPY |
| --- | ---: |
| Fulfillment | 206,451 |
| Referral | 65,904 |
| Disposal | 60 |
| Total | 272,415 |

This was a change in Amazon's raw monetary response. July native `netProceeds` changes from
**¥393,720.6974 to ¥121,305.6974**, exactly **−¥272,415**; net product sales remain
**¥722,064.63**. Our preprocessing did not create that change.

Three fresh controls agree on all 13 July type totals: a July-only query, January–October 15,
and an exact repeat of the old June 1–October 2 window. This demonstrates changed historical
source contents for an unchanged query. It does not reproduce a date-window-dependent error
or reveal Amazon's internal cause.

The older October 2 monthly audit already contained these ordinary fees. The later October 3
capture omitted them, and the October 17 capture restores them. These are distinct baselines:
the sequence demonstrates that completeness can regress and recover, not guaranteed monotonic
eventual consistency. The dated [earlier comparison](finances_data_kiosk_differences_2026-10-14.md)
must not be interpreted as using the October 3 preview selection.

## Sweden: historical ordinary fees remain missing

Fresh January–September Data Kiosk captures omit **SEK 4,458.13** of ordinary fulfillment and
referral charges present in Finances. July alone remains **SEK 1,311.20**. Referral refunds and
refund administration are present; this finding is specifically about ordinary fee charges.

The first nonzero ordinary referral charge in these Data Kiosk results appears on September 27,
and fulfillment on September 28. September 27–30 aggregates match Finances at **−SEK 153.83**,
despite a one-day referral date difference. October 1–15 also matches exactly: fulfillment
**−SEK 150.70** and referral **−SEK 31.60**. Earlier months have not repaired themselves.

The discrepancy is visible before preprocessing. July returns 28 fulfillment fee entries whose
parent amount and quantity are zero; base fee **−SEK 15.91** plus fuel surcharge **+SEK 15.91**
net to zero. Ordinary referral charges are absent. Other countries also contain some zero-parent
base/fuel patterns while their aggregate fulfillment fees match, so this pattern alone cannot
be used to estimate missing money or declare every such row incorrect.

Amazon's public repository contains reports of historical fees disappearing and of the same
zero-parent/base-and-fuel pattern in UK data. They corroborate an observed symptom, not a proved
shared cause or a promised correction. A closed issue is not evidence of a fix.
[Historical fee report](https://github.com/amzn/selling-partner-api-models/issues/4928),
[UK fulfillment fee report](https://github.com/amzn/selling-partner-api-models/issues/5338).

The observed late-September boundary is not a 30-day historical limit. The Economics schema's
`resultRetention` describes query/document retention, not a limit on the age of economic facts.
[Official Economics schema](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

These ordinary fees are in the Finances category. Current company calculations use Finances for these categories at every date. The omission affects
Data Kiosk comparisons without causing an additional deduction from company amounts.

France also retains ordinary fulfillment differences: **−€63.56 in August** and **−€4.54 in
September**, while October 1–15 matches. August's three SKU deficits correspond to 28 fewer
parent-fee units. Three raw zero-parent fee groups on August 4 concentrate the anomaly, but
adjacent-day timing prevents an exact order-level bridge. France has no native fee correction
or reversal that accounts for it. This remains a source discrepancy with an unresolved internal
cause; the fuel surcharge quantities do not prove the number of missing billed units.

## Storage: wider ranges still have opening and closing boundaries

Monthly storage compares a service month with a later financial billing month. Across US
January–September, the **−$45.70680** same-period difference consists of **−$45.7096** from the
opening and closing service-month boundary, plus only **+$0.00280** between the interior matched
months. Extending the period cancels interior timing offsets without necessarily removing the
first and last unmatched service month.

The interior comparison residuals are also small in Canada (**−CAD 0.0001**), Japan
(**+JPY 0.0038**), Australia (**+AUD 0.0158**), Singapore (**−SGD 0.0050**) and France (**EUR 0**).
This is an explanatory comparison, not a change to application accounting dates.

US removal fees total **−$39.50 in both sources** across January–September, despite **$23.70**
of absolute monthly differences. That establishes aggregate timing cancellation; unlike the
matched Japan disposal operations, it does not by itself prove every SKU allocation.

## UK: most disposal differences cancel, but a small excess is proved

UK January–September disposal has **£636.08 of absolute monthly differences**, yet the combined
difference is only **+£8.32**: Finances **−£481.96**, Data Kiosk **−£490.28**. Through October 15,
the residual is **+£8.26**. Removal fees cancel exactly across January–September at **−£8.82**
per source; transport, transport-program, aged-storage and deal totals agree within **£0.003**.

A completed September 23 disposal requested and executed one unit for **£2.28**. Finances bills
that order ID once on October 3. Data Kiosk assigns **one unit/£2.28 to each of two SKUs sharing
the ASIN** in September. This proves **£2.28 of excess allocation** within the full-period gap,
in addition to its month-boundary timing effect.

The remaining **£5.98 net residual is not fully attributed**. The broader check links 27 removal
order IDs to **£449.66** of native charges and 30 customer-order disposal IDs to **£31.44** of
native shipment/refund item contexts. Three January removal IDs totaling **£7.58** do not appear
in the request-period report; an opening-boundary explanation is possible but unproved. SKU case
changes on two reported items do not change their amounts and are not monetary discrepancies.

## Germany transport: unallocated cost survives the longer period

January–September transport and transport-program costs have a combined **−€527.2310**
Finances-minus-Data-Kiosk difference. Finances deducts more than the returned SKU allocations:

| Unallocated cost cohort | EUR |
| --- | ---: |
| April shipment | 76.3780 |
| Three May shipments | 296.4770 |
| June product cost exposed in retained ASIN results, absent from current SKU allocation | 84.3286 |
| July product cost exposed in retained ASIN results, absent from current SKU allocation | 70.0471 |
| Explained unallocated cost | 527.2307 |
| Remaining precision difference | 0.0003 |

The April charge is **€149.54** versus **€73.162** allocated by Data Kiosk. The three May charges
are **€105.56, €131.95 and €105.56**, versus **€9.8253, €26.9424 and €9.8253** allocated. Each
expense/billing date pair stays within its calendar month, so the April/May gaps are not
month-boundary timing.

Five live [Fulfillment Inbound shipment-item reads](https://developer-docs.amazon/sp-api/reference/getshipmentitemsbyshipmentid), including every continuation page, confirm
80 shipped and 80 received units of the same SKU in the shortfall cohorts. That SKU is absent
from Data Kiosk's allocation, while the other shipment SKU quantities match. A shipment using
the plain SKU alias does receive its product allocation. This supports a SKU association/grain
problem, but does not reveal Amazon's internal mapping logic. The exact April/May monetary
assignment to the omitted SKU is an inference from the shipment remainder, not a native per-SKU
invoice. Retained June/July ASIN-grain results independently expose those product amounts.

The **€114.36 June/July** and **€35.19 August/September** billing offsets cancel within the
expanded period. Both transport families must be retained: July's combined gap is still
**−€184.4071**, comprising transport **−€152.4004** and program **−€32.0067**. Comparing the old
combined amount to today's transport-only amount would incorrectly suggest an improvement.
No source-grain switch or automatic company allocation was applied.

## Other costs and limits

US inbound placement retains a **+$832.32 January–September** difference, dominated by
**+$833.16 in August**: Finances **−$636.92** versus Data Kiosk **−$1,470.08**. September and
October 1–15 match at **−$307.20** and **−$341.66**, respectively. Extending the dates does not
remove August's previously investigated excess allocation.

Canada's May, July and August coupon charges total **CAD 6** in Finances and zero in Data Kiosk.
The previously checked native coupon billing therefore remains absent in the expanded product
economics comparison. These costs, like disposal and inbound placement, belong to the category
still sourced from Data Kiosk in mature payouts.

Canada also has a **CAD 55.80 January disposal charge** without a matching Data Kiosk amount.
Its native order ID is absent from the January–October removal-request report. That leaves its
request date and source-allocation cause unresolved; it is not classified as a proven timing
offset. Smaller deal and ordinary-fee residuals are preserved in the comparison extract rather
than silently treated as rounding or eventual corrections.

Several independent cost controls agree: Japan's **¥42,900 labeling** and **¥5,249 aged storage**
match exactly across January–September, as does Canada's **CAD 495.18 aged storage**. US inbound
transport differs by only **$0.0001**, aged storage by **−$0.0001**, and coupon totals match.
The observed discrepancies are specific fee families and operations, not a uniform failure of
all Data Kiosk cost amounts.

Advertising differences are quantified separately; their underlying cause remains deferred
until Ads API access is available. Product sales still have purchase-versus-posting dates and
component-definition differences, while debt recovery, reserve movements and failed payouts
are account activity. A combined account-minus-product-economics gap is not a payout-error score.
See the [earlier component and timing bridge](finances_data_kiosk_differences_2026-10-14.md).

## Source representations and reproducibility

The longer Finances history exposed additional native gift-wrap, Vine, disposal-promotion,
shipping-tax and zero-value aged-storage representations. Explicit reviewed mappings now admit
those paths, preserving the established allocation categories. Gift-wrap amounts do not create
product units or commission bases; disposal promotions retain both charge and offset; nonzero
fees still require monetary detail. Unknown monetary paths remain errors. The frontend type
catalog includes readable gift-wrap labels. No reconciliation balancing rule was introduced.

All **47,123** raw Data Kiosk product/day rows'
net proceeds equal returned sales minus fees and ads, independently of our component signs. Internal
arithmetic consistency cannot establish that Amazon returned every fee, as the Japan history
and Swedish omissions demonstrate.

Reproducible private evidence is in `output/expanded-source-review-2026-10-17/`: the complete
coverage and monthly comparison, independent analysis, Summary controls, identical-window Japan
controls, Sweden native fee timeline, and `disposal/` operational bridges. Raw order/SKU/account
identifiers and document locations remain in ignored private files. The historical backfill also exposes an **April payout configuration blocker for both companies**:
three native SKU identities have no configured ownership. Their 244 US Finances components are
121 liquidation fees (**−$38.50**), 121 liquidation proceeds (**+$53.57**) and two offsetting tax
rows (**+$0.01/−$0.01**), for **+$15.07 net**. Diagnostics report missing ownership, with no missing
fee periods and no commission base on these rows. Source coverage and Summary checks pass;
correct ownership for these identities is required before April reports can publish. No company
assignment was inferred. Exact identities and dates are retained in
`output/expanded-source-review-2026-10-17/april-payout-block.private.json`.
