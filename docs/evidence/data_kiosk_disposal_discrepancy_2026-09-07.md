# Accepted Data Kiosk disposal discrepancy

**Finding date: 2026-09-07. Source-policy decision date: 2026-09-08.**

The current [source policy](../source_allocation.md) uses Data Kiosk costs for companies
and assigns their mature-date difference from Settlement controls to SelBox. This note preserves the evidence for the accepted
USD 54.48 disposal discrepancy. Historical FBA and inventory controls were used
only to investigate that difference; they are not acquisition dependencies.

## What the investigation established

For US disposal costs from 1 June through 31 August 2026, Amazon's raw historical
Data Kiosk response contains USD 54.48 more expense than the corresponding
settlement deductions. The amounts below use positive expense values.

| Disposal scope                                                                | Settlement | Data Kiosk | Data Kiosk minus settlement |
| ----------------------------------------------------------------------------- | ---------: | ---------: | --------------------------: |
| Charges associated with the investigated product; Data Kiosk SKUs S12 and S15 |  USD 70.37 | USD 124.85 |                   USD 54.48 |
| All remaining disposal charges, compared in aggregate                         | USD 189.68 | USD 189.68 |                    USD 0.00 |
| Total                                                                         | USD 260.05 | USD 314.53 |                   USD 54.48 |

S12 and S15 are anonymized aliases for two distinct merchant SKU strings. Data
Kiosk assigns USD 61.29 to S12 and USD 63.56 to S15. The settlement cohort was
reconstructed through 30 customer-order references totaling USD 68.10 and one
FBA removal-order reference totaling USD 2.27. Those references identify S12 in
supporting records. The 31 disposal settlement rows themselves have blank SKU
and quantity fields. No settlement amount was divided between S12 and S15; the
combined Data Kiosk amount was compared with the reconstructed cohort. Equality
of the USD 189.68 remainders does not verify every remaining SKU allocation.

The customer-returns report independently corroborates 30 relevant returned
units: 29 have observed donation status and one disposal status. The manual
removal contributes one further disposed unit. These operation records were
investigative evidence, not the source selected for future company payouts.

The raw-source controls found:

- Independent decoding of 4,773 raw rows and 1,822 fee records exactly matched
  the parser and normalizer used in the investigation. Local processing introduced
  no duplicate pages, fact identities, or charge keys.
- The raw Amazon document contains both SKU strings. The query neither names
  those SKUs nor performs separate per-SKU requests. Disposal components are
  empty; taxes and promotions are zero, ruling out those summation explanations.
- Fresh minimal historical `DAY`, `MONTH`, and `RANGE` queries with `MSKU`
  aggregation each return USD 314.53, including USD 124.85 for S12 and S15.
  All returned fee-type totals agree across these date aggregations.
- A fresh `CHILD_ASIN`/`RANGE` query returns USD 315.37 for disposal. Changing
  product aggregation therefore does not fix the difference. Referral fees also
  differ by USD 0.58 between ASIN and MSKU; other returned fee totals agree.
- The all-category audit checked 27,028 settlement rows across 18 reports and
  reconciled every report to its TSV header total. No supported offset was found
  elsewhere. Extending to all available US settlement dates gives USD 265.43
  versus Data Kiosk's USD 319.91, preserving the USD 54.48 difference. Available
  history is bounded; this is not a claim about all past or future settlements.

The discrepancy is confirmed in Amazon's returned data, rather than caused by
the local SDK, downloader, parser, or normalizer. Overlapping SKU attribution is
a supported hypothesis; Amazon's internal mechanism remains unconfirmed. The
finding does not establish that every Data Kiosk fee category is inaccurate or
that any difference must eventually disappear.

## Why a shared FNSKU does not establish duplicate charges

An unfiltered inventory response independently contains both SKUs. They share
an ASIN and FNSKU, and their current records differ only in the merchant SKU.
Their shared FNSKU **equals the ASIN itself**. A third SKU for the same ASIN uses
an X-prefixed FNSKU. The shared value is consistent with manufacturer-barcode
tracking; it does not independently identify one seller-specific inventory pool
or prove that two fee entries describe the same physical operation.

Historical inventory records corroborate the identifier relationship across
4,032 rows. They do not provide an operation-level fee identity. Of the other
shared-FNSKU groups and fee types inspected, none showed the same exact
cross-SKU fee overlap as this pair. This is a sample result, not a general
guarantee about SKU or FNSKU uniqueness.

## Exact arithmetic overlap is not a safe correction

Twenty pairs of raw fee payloads under S12 and S15 match in day, fee period,
quantity, and full financial detail. One copy of each pair totals USD 54.48 and
24 reported units. Subtracting those copies is an explanatory arithmetic check:

| Month  | Raw Data Kiosk disposal | Matching-pair amount | Subtraction result, also settlement total |
| ------ | ----------------------: | -------------------: | ----------------------------------------: |
| June   |               USD 38.75 |            USD 11.35 |                                 USD 27.40 |
| July   |              USD 219.12 |            USD 20.43 |                                USD 198.69 |
| August |               USD 56.66 |            USD 22.70 |                                 USD 33.96 |
| Total  |              USD 314.53 |            USD 54.48 |                                USD 260.05 |

This does not establish that each pair duplicates a physical charge. On 3
August, one customer return and a separate manual removal provide two genuine
operations with USD 2.27 fees. Their settlement charges post on 4 and 14 August,
respectively. Data Kiosk has two equal-looking USD 2.27 entries on 3 August and
does not identify the underlying operations. Return receipt time, status at
download, removal request time, and settlement posting time have different
meanings. Even after the arithmetic subtraction, eight August days still differ
from the settlement posting-day comparison, despite matching monthly totals.

The native fee `identifier` is not a unique charge identity: all 92 disposal fee
records in the wider original response reuse one value. It cannot justify
deduplication. Neither matching amounts nor shared ASIN/FNSKU authorize merging
SKUs, removing fees, or reallocating historical company ownership.

Filtering Data Kiosk by the SKUs explicitly present in the available settlement
rows also fails as a verified correction. It removes USD 68.60 of disposal,
leaving USD 245.93: USD 14.12 less than settlement. The removed amount includes
USD 5.04 of independently verified legitimate expenses for two other SKUs.
Applied to removal fees, the same filter excludes USD 23.70 that already agrees
with settlement. A missing settlement SKU appearance is not evidence of an
invalid expense or absent company ownership.

## Accepted decision

Use the validated historical Data Kiosk disposal amounts without an inferred
SKU merge or matching-pair subtraction. For this comparison, charging companies
USD 314.53 against USD 260.05 of settlement deductions leaves USD 54.48 with
SelBox; other periods may produce a shortfall. Classification failures and
incomplete source coverage are separate from accepting this source discrepancy.
See the [source policy](../source_allocation.md#company-amounts-and-selbox-reconciliation)
for the current daily reconciliation and company-entitlement calculation.

## Evidence and primary references

The checked-in [sanitized evidence summary](data_kiosk_disposal_discrepancy_2026-09-07.json)
preserves the numerical controls, limits, decision, and hashes of the private
audit summaries. It contains no seller, customer, order, document, SKU, ASIN,
or FNSKU values; aliases are used instead. Private source files are not committed.

- [Amazon historical Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)
  defines supported historical date/product aggregations and distinguishes
  historical economics from estimated preview data.
- [Amazon FBA report definitions](https://developer-docs.amazon/sp-api/docs/report-type-values-fba)
  describe removal-order and customer-return fields used as corroboration.
- [Amazon inventory summaries API](https://developer-docs.amazon/sp-api/reference/getinventorysummaries)
  supplies the inventory identifier control.
- [Amazon explanation of manufacturer-barcode FNSKU values](https://sellercentral.amazon.com/seller-forums/discussions/t/a2344b68-0812-43c9-a533-0ae510b21111)
  explains why an ASIN can appear in the FNSKU field. It does not confirm the
  cause of this Data Kiosk discrepancy.
- [Amazon settlement report documentation](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement)
  and [getReports reference](https://developer-docs.amazon/sp-api/reference/getreports)
  describe report acquisition and its retention limits.
