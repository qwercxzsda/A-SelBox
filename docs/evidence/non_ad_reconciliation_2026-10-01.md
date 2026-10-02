# Non-advertising reconciliation investigation

Investigation date: October 1, 2026. Advertising is deferred until Amazon Ads
invoice access is available. These findings use real API responses and exact
source amounts. No source rows, payout calculations or fee configuration were
changed during this investigation.

## Decision: retain the current defaults

Keep the application's current default date ranges, source dates, maturity rules
and financial calculations. Do not shift dates, move charges between months, or
change the comparison window to make a difference disappear. This investigation
documents findings only; it does not propose a date-range or calculation change.

Temporary differences are acceptable when the corresponding amounts eventually
arrive and agree. The later postings documented below demonstrate that behavior
for specific storage and removal/disposal cohorts. They are explanatory evidence,
not replacement date ranges for the application. A monthly result may still show
an offset because each source retains its original date.

Record the distinction between **verified later counterpart**, **still unmatched
as of the latest capture**, and **insufficient source coverage**. The unresolved
cases are not assumed to be permanent errors, but eventual agreement has not yet
been established for them. No balancing adjustment or inferred deduplication is
part of this decision. Advertising remains deferred until Ads access is available.

## Scope and interpretation

The source comparison covers June–September 2026 across the 18 marketplace
captures downloaded on October 1. July is a mature full month; August and
September also help identify later postings. Later-month comparisons are not a
claim that every September statement is available.
The fee scope is the non-advertising `DATA_KIOSK` category used by the existing
reconciliation calculation. This is not a comparison of all sales, referral or
fulfillment amounts, which have different source-authority rules.

Non-advertising cost records were observed for the US, Canada, UK, Germany,
France, Spain, Italy, Australia, Japan and Singapore. The other eight captured
marketplaces have no observed non-advertising Data Kiosk category costs in this
window. This is not proof of no financial activity. Blank-marketplace Settlement
rows remain explicit and are included in currency totals, not assigned to a
country from currency alone.

The signed difference is Settlement cost controls minus Data Kiosk costs. Expenses
are negative. The original same-month July comparison, excluding advertising, is:

| Currency | Settlement controls | Data Kiosk costs | Difference |
| --- | ---: | ---: | ---: |
| USD | -1,653.56 | -1,680.2969 | +26.7369 |
| CAD | -63.86 | -55.58 | -8.28 |
| GBP | -286.18 | -224.2073 | -61.9727 |
| EUR | -512.16 | -337.9500 | -174.2100 |
| AUD | -4.47 | -5.2919 | +0.8219 |
| SGD | -0.07 | -0.01 | -0.06 |
| JPY | 0 | -22,737.8926 | +22,737.8926 |

These are separate currencies and must not be added. The following investigation
changes the interpretation of these differences, not the saved financial amounts.

## Monthly storage: verified service-period mismatch

Data Kiosk records these fees on the last day of the storage month. Settlement
posts the corresponding charge in the following month. Comparing the same
calendar month therefore compares different storage periods.

| Marketplace / currency | July Data Kiosk | August Settlement |
| --- | ---: | ---: |
| US / USD | -48.3396 | -48.34 |
| Canada / CAD | -6.06 | -6.06 |
| UK / GBP | -27.3100 | -27.31 |
| Germany / EUR | -26.7704 | -26.77 |
| Spain / EUR | -4.3300 | -4.33 |
| France / EUR | -5.3499 | -5.35 |
| Italy / EUR | -0.1500 | -0.15 |
| Australia / AUD | -4.9319 | -4.93 |

Three fresh `GET_FBA_STORAGE_FEE_CHARGES_DATA` reports returned 997 source rows.
Their actual `month_of_charge` field was July 2026. All 42 ASIN/country groups
across these eight marketplaces matched Data Kiosk's native base amounts exactly.
Australia's final cost comparison also includes tax. A UK-requested report
contained several EU countries, so the investigation grouped actual country
fields instead of treating request metadata as country attribution.

Across June–August, all 25 comparable marketplace/service-month pairs matched the
following month's Settlement charge after rounding to cents; the largest
unrounded difference was 0.0019. All 45 market/day/type groups with both September
14 and October 1 query captures retained identical amounts.

Amazon describes the monthly storage report as **estimated**. Here, the later
Settlement charge independently corroborates the fee. The report alone is not
proof of a posted charge. [Official FBA report definitions](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-storage-fees-report).

**Consistency conclusion:** the later charges are verified counterparts of the
earlier storage costs. This is acceptable delayed consistency under the decision
above. Both dates remain unchanged; the cross-month comparison explains the
offset rather than replacing the default monthly comparison. Singapore's July
SGD 0.01 lacks a later Settlement counterpart in available coverage; its eventual
agreement remains unconfirmed.

## Aged storage: checked charges agree

A fresh UK `GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA` report returned
three SKU rows assessed August 15, totaling GBP 1.81. The three SKU amounts match
Data Kiosk dated August 19; their total matches the Settlement charge on that
date. July/August aged-storage aggregates
also match for USD, CAD, GBP and AUD. This is a check of those cohorts, not a
blanket guarantee about every past or future aged-storage charge.

## Disposal and removal: verified later postings

The fresh removal-order reports link operational orders to Settlement through
native order IDs. Charge amounts below are positive expense magnitudes.

| Cohort | Data Kiosk / operation | Settlement | Finding |
| --- | --- | --- | --- |
| UK disposal | August 28; 345 disposed units; GBP 255.30 | September 6: 0.74; September 9: 94.72; September 11: 159.84 | Same native order; charges total 255.30 |
| UK removal | June 22 request; 18 units; GBP 8.82 | June 27: 0.49; July 1: 7.84; July 2: 0.49 | July's 8.33 comes from a June operation |
| Canada disposal | Two June 22 orders; 15 + 1 disposed units; CAD 5.76 | Three July 1 postings totaling 5.76 | July difference is a later charge for June operations |
| UK July disposal | Nine June removal orders | GBP 54.02 charged in July | Explains the complete July disposal residual |
| Germany/Spain disposal | Two July 29/30 order cohorts; seven units; EUR 5.18 | August 5, 8 and 9 postings | Explains the timing portion of July's EUR 17.76 residual |

The UK disposal report shows 350 requested, 345 disposed and five cancelled
units, with completion on September 11. The same order ID links all three
Settlement charges. Data Kiosk has the same SKU, 345 units and GBP 255.30 on
August 28. This explains GBP 255.30 of August's GBP 256.78 disposal difference;
it is not a guess based solely on similar totals.
The EUR 17.76 July disposal difference decomposes into EUR 5.18 of these verified
later postings and EUR 12.58 of matching source-payload overlaps described below.
One disposal order spans Germany and Spain; it is counted once at order level,
while its individual SKU/quantity/fee rows retain their source marketplaces.

Amazon's removal-order detail report provides order status, requested/cancelled/
disposed quantities and fee amounts. Removal shipment detail excludes disposed
items, so it was not used as a disposal-fee control.
[Official removal report definitions](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-removal-order-detail-report).

**Consistency conclusion:** these specific operations did acquire matching later
charges. This is acceptable delayed consistency. Their original monthly
differences retain those month boundaries; no date-range change is needed or
proposed. This does not explain all disposal differences.

## Persistent repeated source amounts

### US inbound placement

August Data Kiosk placement costs total USD 1,470.08; Settlement and Finances
both contain USD 636.92 of charges, leaving USD 833.16 of additional Data Kiosk
expense. Four released Finances placement events match the Settlement entries
using shipment/order references and Settlement identities. The complete August–
September Finances query contains no additional placement charge offsetting the
USD 833.16.

Repeated Data Kiosk fee payload amounts account for the difference:

- USD 210.76 appears for July 31 and again on August 3.
- The same three-SKU amounts totaling USD 200 appear on August 18 and August 20.
- USD 211.20 appears on August 19, 20 and 21, adding two additional copies.

The extra August amounts sum exactly to USD 833.16. A fresh MSKU/RANGE query for
August also returns USD 1,470.08, so this is not caused by our summing daily rows
instead of requesting a monthly range. The raw archived Amazon data contains the
repetitions.

Three live FBA shipment-item reads corroborate the implicated SKU/quantity
cohorts. The 479-unit shipment agrees with USD 210.76, and the 480-unit shipment
with USD 211.20. One SKU's current received quantity differs by one unit from the
quantity in the USD 200 charge cohort, so complete unchanged receipt quantities
are not claimed for that cohort.

Data Kiosk's fee identifiers are generic fee labels, not unique shipment/event
IDs. The excess and repeated payloads are demonstrated; automatically deleting
lookalike fees would still require a defensible event identity or Amazon's
correction. There is no evidence that merely waiting will eliminate this gap.
The all-type reference audit found no matching SelBox adjustment or reversal for
the three implicated shipment references. However, the same 480-unit/0.44-rate
payload also legitimately incurred USD 211.20 in July for a different shipment.
Payload equality across dates therefore cannot be a general deduplication key.

### Disposal overlaps

Exact matching native fee payloads across SKU/date groups explain these expense
overlaps in the current Data Kiosk data:

| Marketplace / period | Extra matching-payload amount | Scope limitation |
| --- | ---: | --- |
| US July | USD 20.43 | Equals the current monthly disposal difference |
| US August | USD 23.54 | Equals the current monthly disposal difference; previous investigation measured 22.70 |
| Australia August | AUD 23.33 | Current net difference is 23.10; a separate Settlement charge offsets 0.23 |
| Australia September | AUD 0.23 | Equals the current monthly difference in available coverage |
| Germany/Spain July | EUR 12.58 | Explains part of the EUR 17.76 disposal difference |
| UK August | GBP 1.48 | The remainder after the verified GBP 255.30 later posting |

The [earlier disposal investigation](data_kiosk_disposal_discrepancy_2026-09-07.md)
explains why equal amounts, shared ASIN/FNSKU, or repeated generic fee identifiers
are not sufficient to delete a physical charge. It found genuine separate
operations with equal fees as well. The fresh investigation links all 76 current
US disposal Settlement rows in June–September to removal orders or customer
returns through exact source order references.

The fresh Australian removal report identifies 101 disposed units costing AUD
23.33 on August 6. Six Settlement base/tax rows on August 6–7 link to that exact
order and total 23.33. Data Kiosk contains two identical 101-unit/23.33 payloads
under two SKUs, totaling 46.66. A separate July 9 removal order was charged 0.23
in August. Its Data Kiosk SKU match is absent, so that small remainder is not
claimed as a verified Data Kiosk timing match.

For the additional US 0.84, a three-unit removal order costing 2.52 links to
August 23/28 Settlement charges totaling 2.52. Data Kiosk's same-product/day
entries total 3.36 and include an extra matching 0.84 payload.

**Consistency conclusion:** later captures still contain these differences.
The August US difference increased by USD 0.84 between the September 7
investigation and September 14 capture; it did not increase in the October 1
refresh. US July/August, UK August and Australian August disposal amounts are
unchanged between the September 14 and October 1 captures. These observations
do not support a guarantee of automatic convergence. No inferred deduplication
was applied.

The September boundary has a separate coverage problem: three released US
Finances disposal events on September 29/30 total USD 6.81 and link to fresh
customer-return records, but have no corresponding charge in the currently
available Settlement statements. Those recent differences cannot be classified
as persistent cost disagreement from the current statement inventory.
After the verified timing and overlap diagnostics, August EUR retains an
unexplained -0.74. September still has residuals in GBP, USD and EUR, with
incomplete current statement coverage; those are not claimed as resolved.

## Transport, deals and coupons: remaining source mismatches

### EU inbound transport

The July EUR difference is **-184.4071** across transportation and transportation
program fees. Finances confirms the Settlement charges and supplies shipment
references. Two live shipment-item reads corroborate their contents, but Data
Kiosk does not expose shipment IDs for these fees.

One July 3 shipment charge totals EUR 105.56. The shipment contains 80 units of
one SKU and 780 of another (778 currently received for the latter). The July 2
Data Kiosk allocation includes only the latter SKU, costing EUR 35.5129. This
supports investigating incomplete product allocation, but is not an exact native
event match. Another candidate charge of EUR 114.36 resembles an earlier Data
Kiosk total of 114.3599; the shipment's product mix differs, so that coincidence
is explicitly rejected as proof of timing.

August's +35.19 and September's -35.19 transportation/program differences offset.
Data Kiosk dates the 35.19 allocation August 31 and Finances dates a matching
charge September 1. The amount/date pattern is consistent with timing, but the
missing Data Kiosk shipment ID prevents the same identity proof available for
the removal-order cases. **The exact July EUR 184.4071 decomposition remains
unresolved.** No amount-only shipment match was used to correct data.

### German deals and Canadian coupons

Germany's July Settlement and Finances records contain two distinct deal
references, each charged EUR 16 for participation. One also has a EUR 6.17
performance charge. These entries match by native deal/Settlement identifiers
and amount. Data Kiosk's complete June–September capture includes approximately
one EUR 16 participation charge, leaving another EUR 16 without a counterpart.
The data does not establish whether the missing allocation relates to a
zero-sales deal or another Amazon behavior.

Across EUR marketplaces, July's deal difference is -16.0132: the missing 16 plus
-0.0132 of native allocation/precision difference. Smaller US, UK, French and
Italian deal differences are at fractional-cent/cent scale and exist in the
exact source decimals; they are not Python/JavaScript floating-point errors.
The precise Amazon allocation/rounding rule is not established for every deal,
so this remainder is not described as a universally verified rounding rule.

Canada's July and August Settlement reports each charge CAD 2 for coupons.
The August event independently matches Finances by native coupon and Settlement
identifiers. The current Canadian raw Data Kiosk archive covers June 1–September
30 and 1,220 product/day facts, with **zero coupon fee entries**. The July amount
is backed by its archived Settlement statement, not a fresh July Finances query.
There is no evidence proving that a lack of redemptions caused the omission.

**Consistency conclusion:** these missing deal/coupon counterparts persist in a
complete historical Data Kiosk capture. A later billing date is not demonstrated
as the explanation. The EUR transport case also remains unresolved; waiting is
not a verified remedy for either class of issue.

## Japan: released fees exist despite missing Settlement documents

Fresh Finances v2024-06-19 queries returned 1,755 July and 1,863 August transactions
with complete terminal pagination. The relevant fee transactions are explicitly
`RELEASED`. They establish financial activity even though Settlement report
listing returns no downloadable Japanese statements.

- July labeling totals JPY 17,094 in both Data Kiosk and the two Finances
  warehouse-preparation transactions. Their item breakdown explicitly identifies
  `LabelingFee`, including base and tax. Japan-local dates also match. August's
  JPY 22 matches too. The Finances SKU and ASIN fields are empty, so this is fee
  type/date/amount corroboration rather than a native SKU-level join.
- July disposal is JPY 60 in both sources; July aged storage is JPY 159 and August
  aged storage is JPY 2,884 in both sources.
- July Data Kiosk storage, JPY 2,244.0007, corresponds to the August Finances
  charge of JPY 2,244. June's JPY 1,936.0001 similarly matches July's JPY 1,936.
- July deal fees are JPY 3,180.8919 in Data Kiosk and JPY 3,181 in Finances,
  agreeing after rounding to whole yen.

For diagnosis only, matching these independently returned fees and July storage
to its August charge gives signed controls of JPY -22,738 versus Data Kiosk
JPY -22,737.8926. Their difference is **-22,738 - (-22,737.8926) = JPY -0.1074**,
rather than the application's absent-Settlement comparison of
JPY +22,737.8926. Finances is an investigative control here, not a newly published
production source or a replacement for the default date ranges, displayed
reconciliation or existing source-authority policy.

**Consistency conclusion:** this is predominantly missing report coverage in the
comparison. It is not evidence that the fees are uncharged or awaiting release.
Waiting for daily Data Kiosk refreshes cannot supply an absent Settlement source.
The reason Amazon does not expose those Japanese Settlement documents is still
unresolved.

## Evidence and boundaries

Private request checkpoints, source bytes, native reference matches, response
inventories and aggregate proofs are under
`output/non-ad-reconciliation-2026-10-01/`. All queried data stayed local to the
investigation. No source or payout rows were rewritten, and no account actions,
charges, shipments or payments were created by these read/report requests.

The live controls included:

- Eight completed FBA reports: three monthly-storage, one aged-storage, three
  removal-order and one customer-return report.
- Full Finances v2024-06-19 transaction pagination for NA August–September,
  EU July–September, and Japan July and August, without transaction-type filters.
- Five shipment-item investigations using native Finance shipment references.
- A fresh US August MSKU/RANGE Economics fee query, with terminal pagination and
  no ad analysis or database publication.

The [Finances API reference](https://developer-docs.amazon/sp-api/reference/listtransactions)
defines transaction status and pagination. Raw responses were retained privately;
only non-advertising fee controls were analyzed. Advertising invoice investigation
remains deferred until Ads access is supplied.

The investigation separates three questions: whether later amounts arrive,
whether the corresponding event amounts agree, and whether a frozen same-month
difference becomes zero. Verified later agreement is acceptable even when the
original monthly difference remains. Current defaults stay in place; a blanket
eventual-agreement guarantee remains unproven for the unresolved cases.
