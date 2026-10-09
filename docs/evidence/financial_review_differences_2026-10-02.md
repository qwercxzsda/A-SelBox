# Financial review differences across all categories

Investigation date: October 2, 2026. This extends the
[October 1 cost investigation](non_ad_reconciliation_2026-10-01.md) to the current
Financial review's **Settlement**, **Data Kiosk**, and **SelBox** categories.
The previous cost investigation did not cover all three comparisons.

The default dates, maturity policy, source dates, classifications, and payout
calculations remain unchanged. This is an investigation and documentation change.
Advertising invoice investigation remains deferred until Ads API access is available.

## What the current screen measures

Each category compares its signed current source amounts:

```text
difference = Settlement amount - Data Kiosk amount
```

The comparison aggregates all namespaces, marketplaces and SKUs **within one
currency**. It does not compare a company's payout to the account's deposit.
Only the **Data Kiosk category** difference is the accounting reconciliation
amount used by the source policy. The other two category differences are
diagnostic comparisons and do not create further payout adjustments.

All 70 current category/month/currency results matched independent source-record
sums and the real operator's REST responses exactly. There were no arithmetic or
CSV column-alignment discrepancies. Blank-marketplace rows are included in these
signed totals; their grouping cannot explain a nonzero all-marketplace total.

On October 2 the mature cutoff is **August 2**, exclusive. Therefore the newest
August row contains **August 1 only**, not a full August report. July is the latest
full calendar month admitted by the cutoff; that does not certify source coverage.
This is the existing date policy, not
a new investigation window or a proposed date change.

## Missing periods despite some Settlement reports being present

There are 99 current Settlement identities from 100 successful acquisitions.
Every acquisition has a preprocessing version, and all current statements match
their header amount and stored preprocessing row count. Neither repeated current document
hashes nor identical complete transaction payloads across statements were found.
Data Kiosk has 2,196 current daily captures: 18 marketplaces over all 122 days of
June–September, with no capture gaps.

That does not make the retained Settlement history complete. Several June
comparisons begin before the first retained regular statements:

| Currency | June Settlement-category difference | Data Kiosk amount before retained Settlement activity | Remaining difference after isolating that contribution |
| --- | ---: | ---: | ---: |
| USD | -4,153.90 | +4,142.65 on June 1–10 | -11.25 |
| GBP | -5,197.94 | +5,069.15 on June 1–25 | -128.79 |
| EUR | -5,514.03 | +5,204.95 across marketplace-specific uncovered prefixes | -309.08 |
| AUD | -351.63 | +192.48 on June 1–2 | -159.15 |

For example, the original USD difference decomposes as
`-4,153.90 = -4,142.65 - 11.25`. This isolates the contribution of dates with no
retained Settlement transactions; it does not drop those dates or replace the
displayed total. A long-span, five-row US adjustment statement has an earlier
header start, but it does not supply the missing regular June transaction rows.
Header minimum/maximum dates alone would obscure this gap.

The EUR prefixes are before each marketplace's first retained Settlement-category
posting, not one common cutoff: June 1–24 for Germany, France, Spain, Italy and
the Netherlands; June 1–29 for Belgium; all June for Ireland. Their amounts
identify a one-sided comparison, not the exact amount of hypothetical missing
Settlement events. Negative prefix amounts, including refunds and fees, retain
their signs.

For July, the header-date union of reports containing the named marketplace spans
all 31 days for the US, Canada, Australia, UK, Sweden, Germany, France, Spain,
Italy, Netherlands, Belgium and Ireland. That rules out a visible header-period
gap for these markets, not every possible omitted transaction. Singapore's
available statements stop in July. Thus a statement's existence alone is not
sufficient to label either June or July universally complete.

Fresh October 2 Reports API discovery completed pagination in all five credential
scopes. One newly available UK statement, September 18–October 2, was absent from
the database. Downloading and parsing it locally found 10,851 rows, all posted
September 18–October 2, with **zero dates before the August 2 cutoff**. It therefore
cannot explain any current Financial review difference. It was not published to
the database. All other currently listed reports were already acquired. Eleven
older June EU references remain unavailable in the October 1 investigation;
refreshing the current listing does not restore them.

Japan remains a separate case: there are no imported Japanese Settlement
statements at all. Its Finances API transactions corroborate financial activity
but are not Settlement report coverage or application inputs.

This absence concerns Settlement V2 files, not Japanese financial activity or
every Seller Central report product.

## Settlement category: timing and missing Economics fee amounts

The full-July diagnostic differences include:

| Currency | Settlement amount | Data Kiosk amount | Difference |
| --- | ---: | ---: | ---: |
| USD | 16,817.10 | 15,552.35 | +1,264.75 |
| GBP | 6,991.96 | 7,463.35 | -471.39 |
| AUD | 2,022.48 | 2,309.26 | -286.78 |
| SEK | 707.21 | 1,977.77 | -1,270.56 |
| EUR | 6,078.00 | 6,103.96 | -25.96 |
| CAD | 33.07 | 27.16 | +5.91 |
| PLN | 111.77 | 138.47 | -26.70 |

Native Finances lifecycle links explain part of each comparison. The following
terms add to the **unchanged current difference**. "Remaining" is the comparison
after isolating release timing and the native UTC/local boundary; it is not
automatically an error or a proposed replacement amount.

| Currency | Current difference | Release timing | UTC/local boundary | Remaining comparison |
| --- | ---: | ---: | ---: | ---: |
| USD | +1,264.75 | +1,107.62 | +163.34 | -6.21 |
| GBP | -471.39 | -59.68 | +6.46 | -418.17 |
| EUR | -25.96 | +200.40 | +4.14 | -230.50 |
| AUD | -286.78 | -129.38 | +2.72 | -160.12 |
| SEK | -1,270.56 | -32.77 | 0.00 | -1,237.79 |
| PLN | -26.70 | -19.67 | 0.00 | -7.03 |
| CAD | +5.91 | +5.91 | 0.00 | 0.00 |

Timezone attribution uses each event's native marketplace, including Dublin
separately from continental Europe. Independent order/refund controls match
Settlement and released Finances by native order ID, posting timestamp, event
type and exact amount: 1,818 USD, 2,596 GBP, 2,681 EUR, 451 AUD, 29 SEK and six PLN
groups, with **zero unmatched nonzero groups**. The UK has 11 additional
zero-value Finances groups. This is strong evidence against missing July
order/refund postings in those currencies; it is not a guarantee about every
account fee or historical statement.

The small default EUR net difference also deserves care: +204.54 of timing and
boundary effects offsets a -230.50 remaining comparison. A small net difference
does not prove every source component agrees. EUR's remaining amount includes
product sales/promotions -209.01, referral fees -23.89, fulfillment -3.90, digital
services -3.48, reimbursements +3.04 and other adjustments +6.74.

### Sweden: confirmed discrepancy in Amazon's fee outputs

July Settlement includes fulfillment charges of **SEK -979.75** and referral
charges of **SEK -209.78**. The independent, fully paginated Finances response has
28 released fulfillment fee components and 28 released commission components
with exactly those totals. All 56 fee lines match by native order ID, fee type
and exact amount, not merely by aggregate totals.

Data Kiosk's 28 July daily fulfillment fee rows instead sum to **zero**, and it
returns no `ReferralFee` charges. A fresh October 2 MSKU/RANGE query for the same
July month reproduces both results. This is also present in the September 14 and
October 1 daily captures, so it is not caused by adding daily rows, stale browser
data, local preprocessing, or a fee converted into EUR.

The raw daily fulfillment breakdown contains a negative base amount and positive
fuel amount that cancel to zero. The application preserves the native total.
Refunded referral and refund-administration fees are returned separately and are
already included in the comparison; they do not replace the missing charges.

The complete SEK -1,270.56 difference consists of:

- **-1,189.53** from these missing Economics fulfillment/referral charges;
- **-78.92** from the product-sales comparison, whose full event attribution is
  not established;
- **-2.11** from the shipping comparison.

This establishes a concrete Amazon-source discrepancy for a marketplace with
Settlement reports. It does not establish Amazon's internal cause or guarantee
future correction. It is unsuitable to describe the whole gap as missing
Settlement reports or verified eventual consistency.

#### Public issue matching the Swedish response

An October 2 search found [SP-API issue #5338](https://github.com/amzn/selling-partner-api-models/issues/5338),
filed July 30, 2026 for UK Economics data. It reports the same zero fulfillment
total, negative base fee offsetting positive fuel, zero base quantity and nonzero
fuel quantity. The issue remains open. In its
[support response](https://github.com/amzn/selling-partner-api-models/issues/5338#issuecomment-5142499579),
Amazon requested private account/query diagnostics; it did not confirm an internal
root cause or a fix.

All 28 Swedish July rows match that signature. For example, July 1 has base
**SEK -0.43 / quantity 0**, fuel **+0.43 / quantity 1**, and aggregate
**0 / quantity 0**. July's fuel quantity totals 37 units. Promotions and taxes
are zero throughout, so a fee discount does not explain the cancellation.
The reporter's proposed mechanism is a missing main total treated as zero before
subtracting fuel to derive the base component. That is a plausible explanation
of our pattern, **not an Amazon-confirmed implementation detail**.

Swedish fulfillment totals are also zero in June and August, but two September
28 rows return actual fees totaling SEK 80.55. Referral charges appear on
September 27–29, totaling SEK 44.14. Thus a blanket unsupported-market or currency
explanation does not fit. The July referral omission may be related, but the
shared cause is unproven; #5338 concerns fulfillment aggregation.

[Issue #4928](https://github.com/amzn/selling-partner-api-models/issues/4928)
separately reports missing inbound/AWD fees. Its
[closure response](https://github.com/amzn/selling-partner-api-models/issues/4928#issuecomment-4478138735)
also requests internal support investigation rather than announcing a repair.
Conversely, the author of the superficially similar zero-sales
[issue #5135 retracted the API-bug claim](https://github.com/amzn/selling-partner-api-models/issues/5135#issuecomment-3969660437)
after finding a local parser error. It is not evidence for our diagnosis.

The next step to establish Amazon's internal cause is a Developer Support case
referencing #5338 with our private query IDs, Swedish marketplace, raw examples
and matched Settlement/Finances evidence. No case was submitted. Historical
backfill and eventual correction remain unconfirmed; application dates and source
policy remain unchanged.

### Canada: the complete difference is a purchase/posting boundary

Fresh Orders API reads covered all four orders represented in July's Canadian
Settlement records. One was purchased June 26 in marketplace-local time (June 27
UTC) and posted in Settlement on July 6:

```text
product sales 10.54 - referral fee 0.84 - fulfillment fee 3.79 = CAD 5.91
```

Data Kiosk has the product/referral amounts on June 26 and the fulfillment fee
on June 27. The other three July orders' components match. This native order and
component evidence explains the entire current July CAD +5.91 difference without
requiring a missing statement or a financial adjustment. Both original months
remain unchanged.

### US: most of the July gap is verified release timing

Fresh June and July Finances responses, combined with the previously captured
August–September responses, link deferred originals and releases using Amazon's
`DEFERRED_TRANSACTION_ID` and `RELEASE_TRANSACTION_ID`. All 1,780 July released
shipment/refund events with deferred links across USD/CAD have matching originals
and unchanged amounts.
The remaining July shipment/refund events without a deferred link are 33 direct
refunds and nine zero-amount shipments; they are kept as single events.

For USD, the exact native lifecycle bridge is:

| Cross-month cohort | Contribution to July released minus July original amounts |
| --- | ---: |
| 580 June shipment events released in July | +5,238.72 |
| 367 July shipment events released in August | -4,196.17 |
| Eight June refund events released in July | -126.40 |
| Eight July refund events released in August | +191.47 |
| **Verified net release-timing contribution** | **+1,107.62** |

There is a second identifiable boundary: Settlement's supplied posting dates are
UTC in these statements, while Economics daily dates use marketplace-local time.
The 44 original Finance events on the July UTC/local boundaries contribute
**+163.34**. Both original date conventions remain unchanged in the application.

The complete diagnostic bridge for the displayed difference is:

```text
USD +1,264.75 = +1,107.62 native release timing
                 +163.34 UTC versus marketplace-local month boundary
                   -6.21 remaining source comparison
```

All 1,818 July USD order/refund event groups match Settlement and released
Finances by native order ID, timestamp, event type and amount, totaling
USD 16,618.06. There are no missing Settlement order/refund groups in that control.
The comparison of original Finance events against marketplace-local July
Economics then agrees exactly for fulfillment fees (**-6,147.27**) and refund
administration (**-45.34**). The remaining -6.21 is product sales/promotions
+6.19, net referral fees -12.74, restocking +1.08, reimbursements -3.71 and
liquidation amounts +2.97. Those small residuals are not asserted to share one
verified cause.

This is an explanatory decomposition of the existing **+1,264.75**, not a
replacement total or a date-range change. The later release events have arrived;
the default same-calendar-month difference need not disappear because the
sources preserve different event dates.

### UK: most of the remaining gap is in product-sales amounts

Fresh June Finances pagination and the existing July–September response link
July released events to their originals. For GBP, June shipments released in
July contribute +1,687.18, July shipments released in August -1,736.99, June
refunds released in July -21.26, and July refunds released in August +11.39.
The net release-timing contribution is **-59.68**. Ten original events at the
UTC/London month boundary contribute **+6.46**:

```text
GBP -471.39 = -59.68 native release timing
               +6.46 UTC versus marketplace-local month boundary
             -418.17 remaining source comparison
```

The -418.17 remainder consists of product sales/promotions **-437.78**, net
referral fees +19.71, digital services -4.87, fulfillment -0.03, other adjustments
+1.20, reimbursements +2.29 and liquidations +1.31. Thus the large remaining
comparison is in the sales amounts. Calling the entire UK difference a delayed
Settlement posting would be incorrect.

### Australia: timing explains fulfillment and refund-administration gaps

Fresh June–August Finances responses contain 2,847 distinct transactions. All
451 July released order/refund groups match Settlement by native order ID,
timestamp, type and amount, totaling AUD 2,007.79. No order/refund groups are
missing from that Settlement control.

The native links identify AUD +503.50 of June shipments released in July,
-642.00 of July shipments released in August, and +9.12 from a July refund
released in August. The net release-timing contribution is **-129.38**.
Ten original events on the UTC/Sydney month boundaries add **+2.72**:

```text
AUD -286.78 = -129.38 native release timing
                +2.72 UTC versus marketplace-local month boundary
              -160.12 remaining source comparison
```

On the original-event/local-date diagnostic basis, fulfillment fees **-1,935.03**,
refund administration **-0.64**, and reimbursements **+14.69** match Economics
exactly. The remaining -160.12 consists of **-156.98 in product sales** and
**-3.14 in net referral fees**. It is therefore concentrated in sales valuation
and its related fee comparison, not an absent fulfillment statement.

### Independent order-date control and the remaining sales definition

Six fresh All Orders reports for the existing June/July months returned 14,507
rows. Filtering actual sales channel and local purchase date was necessary:
requesting one marketplace did not make every returned row belong to it.
Native order IDs match **every July-posted product-sale row** in the US, UK and
Australia to a June or July purchase. Every July shipped order with a nonzero item
price has an order-ID counterpart in the retained July–September Settlement data.
This coverage check does not assert item-by-item amount equality. The eight unmatched
US orders have ten units and zero item price; the UK and Australia have none.
This does not establish coverage for unrelated fee types or earlier months.

| Currency | June-purchased product principal posted in July | July-purchased principal posted in August | July-purchased principal eventually in Settlement | Data Kiosk July ordered product sales |
| --- | ---: | ---: | ---: | ---: |
| USD | 10,178.48 | 7,557.03 | 26,280.56 | 26,348.17 |
| GBP | 3,545.34 | 3,477.82 | 12,937.46 | 13,211.98 |
| AUD | 1,100.63 | 1,303.40 | 4,454.59 | 4,658.68 |

This purchase-date control is an **alternative diagnostic**, not another
adjustment to add to the Finance original-event/release bridges above. Purchases,
original financial events, releases and refund requests are different dates.

Australia illustrates why the residual must not simply be called an inflated
item price. July-purchase item principal is 4,454.59; net customer shipping is
**448.34 - 245.89 = 202.45**. Adding that shipping gives 4,657.04, only 1.64 below
Data Kiosk's 4,658.68. But Settlement also charges back that same 202.45 shipping,
so its net effect on the Settlement category is zero. Two same-SKU/day examples
with equal quantities and no cancelled orders show the same near-agreement when
customer shipping is considered. This supports a sales-value-definition
explanation; it does not prove Data Kiosk's exact shipping/allocation formula.

A fresh October 2 Australian MSKU/RANGE July query exactly repeats current DAY
sums: ordered sales 4,658.68, refunded sales 39.76 and net sales 4,618.92. Thus the
observed amount is in Amazon's response, not a local daily-summation bug or a
stale browser value. Cancelled report rows have zero quantity and no original
price, so their presence alone cannot quantify an Economics correction.

Data Kiosk does not expose order IDs. The precise remaining UK/Australian sales
definition and allocation cannot be established from aggregate similarity alone;
it remains unresolved rather than being silently relabeled as timing, missing
reports, cancellations, or a permanent pricing error.
[Official All Orders report fields](https://developer-docs.amazon/sp-api/docs/report-type-values-order).

## SelBox category: unmatched source populations

The current Data Kiosk data has **zero SelBox-category records** in all visible
periods. The only registered Data Kiosk SelBox fee type is `SUBSCRIPTION_FEE`,
which these captures did not return. Settlement contains additional account
charges and balance movements. Therefore these category differences do not have
an established zero-equality expectation.

For July:

- EUR **-762.06** is payable-to-Amazon amounts of -4,117.20 plus successful charges
  of +3,355.14. Reserve and debt-transfer entries cancel in that currency total.
- GBP **-175.09** is inbound-defect charges of -169.80 plus subscription fees of
  -5.29, with no Data Kiosk counterpart.

These are identified Settlement source types, not unexplained extra company
payout costs. Their diagnostic difference is not the separate Data Kiosk
reconciliation amount. Repeatedly downloading an absent Data Kiosk subscription
or balance-movement counterpart cannot be assumed to make this comparison zero.

## Data Kiosk category: advertising and other costs separately

The current full-July differences are unchanged from the October 1 investigation.
They decompose exactly as follows; currencies must not be added together.

| Currency | Total difference | Advertising portion | Non-advertising portion |
| --- | ---: | ---: | ---: |
| USD | -1,633.6631 | -1,660.40 | +26.7369 |
| GBP | -1,441.9327 | -1,379.96 | -61.9727 |
| EUR | -1,529.2600 | -1,355.05 | -174.2100 |
| AUD | -272.8381 | -273.66 | +0.8219 |
| CAD | -8.28 | 0 | -8.28 |
| SEK | -120.58 | -120.58 | 0 |
| PLN | -70.45 | -70.45 | 0 |
| SGD | -5.68 | -5.62 | -0.06 |
| JPY | +333,076.9326 | +310,339.04 | +22,737.8926 |

Advertising remains the largest July cost difference for USD, GBP, EUR and AUD.
This identifies the subtotal, not the invoice-level cause. The separate Ads API
investigation is still required; no new explanation for that subtotal is asserted.
Japan still has no Settlement reports. The independent Finances transactions in
the earlier investigation have not been imported as Settlement documents.

The non-advertising differences in marketplaces with Settlement data have several
different causes, already tied to the source evidence:

| Currency | Exact July non-advertising bridge | Interpretation |
| --- | --- | --- |
| USD | Disposal +20.43; storage +6.2996; deals +0.0073 = **+26.7369** | Repeated native disposal fee payloads, storage service month versus charge month, and a fractional-cent deal difference. |
| GBP | Disposal -54.02; removal -8.33; storage +0.3800; deals -0.0027 = **-61.9727** | The complete disposal/removal residual is linked to June operations charged in July. |
| EUR | Transport/program -184.4071; deals -16.0132; disposal +17.76; storage +8.4503 = **-174.2100** | Transport combines a June cost posted in July and an omitted July SKU allocation; approximately one EUR 16 deal fee is missing; disposal combines later charges and overlapping fee payloads. |
| CAD | Disposal -5.76; coupon -2.00; storage -0.52 = **-8.28** | Disposal links to June orders; the coupon has no Data Kiosk counterpart in the captured history. |
| AUD | Disposal -0.23; storage +1.0519 = **+0.8219** | Small disposal difference and storage month mismatch. |
| SGD | Storage **-0.06** | Insufficient later Settlement evidence to establish a matching storage charge. |

For storage, all 25 comparable June–August marketplace/service-month cohorts
matched their following month's Settlement charge to cents. Specific removal
orders also acquired matching later charges. This demonstrates delayed agreement
for those cohorts; it does not make their original same-calendar-month
comparisons become zero.

Other gaps cannot yet be called eventually consistent. The missing German deal
and Canadian coupon counterparts and repeated disposal fee payloads persist.
The [payout-impact follow-up](data_kiosk_payout_impact_2026-10-02.md#transport-missing-sku-allocations-isolated-by-fresh-queries)
subsequently isolated the German transport problem: child-ASIN queries recover
84.3286 of June and 70.0471 of July costs missing from SKU-level output. July's
remaining 114.36 transport difference is a June 30 expense billed July 1. Those
diagnostics preserve this document's original displayed monthly amounts.
The full-August US inbound-placement excess of USD 833.16, documented on October
1, is another source-level mismatch; it is **not** the amount shown by the current
August 1-only Financial review. Do not substitute that full-August diagnostic for
the current partial month.

See the [non-advertising investigation](non_ad_reconciliation_2026-10-01.md) for
native order/shipment links, fresh API checks, precise attribution limits and
unresolved residuals. Equal fee payloads alone are not safe deduplication keys.

## API semantics and evidence boundaries

Amazon's Economics schema defines net product sales as ordered product sales
minus refunded product sales, with refunds counted by refund request time.
Daily economics uses marketplace-local dates. Fee totals include the fee's
promotion and tax adjustments. These definitions do not promise equality with
every Settlement posting in the same calendar month.
[Official Economics schema](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

Settlement reports expose posting dates and amounts and are generated by Amazon;
the application discovers them using `getReports`. A successfully imported
statement proves neither earlier statement coverage nor matching economics
timing. [Official Settlement report definition](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement).

Finances returns original deferred transactions and their released lifecycle
records. The analysis follows native links and does **not** sum both as additional
revenue. Amazon's payment tutorial uses `RELEASED` transactions to identify the
events belonging to a payment.
[Official payment-transaction guide](https://developer-docs.amazon/sp-api/docs/determine-payment-transactions).

Read-only current database and authenticated API evidence is stored locally under
`output/financial-review-investigation-2026-10-02/`. Source row IDs, document
references and private raw records are retained there for reproducibility, not
copied into this document. The October 1 evidence provides the previously queried
Finances, FBA and archived Economics controls. No monetary source facts, fees,
ownership or payout records were modified for this investigation.
