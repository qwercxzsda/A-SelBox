# Reconciliation investigation after the October 1 source refresh

This investigation compares real Settlement and Data Kiosk source amounts. It
keeps currencies separate, uses current source versions for the refreshed
comparison, and preserves previously generated payout snapshots.

The later [non-advertising investigation](non_ad_reconciliation_2026-10-01.md)
uses fresh FBA reports, Finances transactions and shipment items to distinguish
period differences from persistent source mismatches across marketplaces.
The agreed scope is documentation only: retain the current default date ranges
and calculations. Verified later matching charges are acceptable; cross-month
diagnostics do not redefine the application's date ranges. Unmatched cases remain
unconfirmed rather than assumed eventually resolved.

## Completed refresh

- Data Kiosk: 18 fresh marketplace queries covering June 1–September 30,
  2,196 complete daily captures and 39,997 component rows. No daily coverage gaps.
- Settlement: 38 newly downloaded documents plus retained archives, resulting
  in 99 current statements and 150,871 rows. All current source versions use v2;
  every statement's row count and signed header total match its source rows.
- All currently downloadable statements were processed. Eleven older EU
  references remain unavailable. Japan returned no statements. A July EU
  document that initially failed was recovered on retry.
- June and July payouts regenerated through the existing automatic worker.
  Their refresh queues have no pending revisions or errors. August onward
  remains immature under the existing two-month rule.

The refresh fixed the reviewed F7 zero-tax case and registered three exact new
source labels under existing policies: an [MCF pricing credit](mcf_preferred_pricing_credit_2026-10-01.md)
and two [F5 country lists](debt_adjustment_country_lists_2026-10-01.md). Unrecognized
variants continue to fail preprocessing. No reconciliation allocation rule changed.

## What the difference measures

The calculation is:

```text
difference = Settlement DATA_KIOSK-category controls
           - Data Kiosk DATA_KIOSK-category costs
```

Both inputs use signed amounts: an expense is negative. The calculation groups
by seller namespace, activity date, marketplace and currency. Settlement uses
its posting date; Data Kiosk uses the economics activity date. Missing inputs
are currently treated as zero. This is narrower than comparing the complete
Settlement statement with the complete Data Kiosk dataset.

The separate `accounted_total = settlement_total` invariant follows from adding
this difference back into the total. That identity validates the allocation
arithmetic; it does **not** prove that the sources agree or are complete.

A report's administrator reconciliation includes all currencies from its selected
seller/month inputs. Those account controls can repeat in several company or
currency reports. Do not add different currencies, repeated report snapshots,
or absolute daily differences to obtain a monetary reconciliation total.

## Confirmed preprocessing defect: two missing US statements

The original imported sample retained two acquired US statements without a
published preprocessing version. Their independently reviewed F7 tax events
included an exact-zero `ItemPrice / ShippingTax` line without a matching zero
withholding line. The parser rejected the whole statement, although the
nonzero principal tax and withholding balanced exactly.

| Statement period | Omitted Data Kiosk-category Settlement controls |
| --- | ---: |
| July 6–20 | USD -5,746.47 |
| August 4–18 | USD -3,264.93 |

The fix admits only that exact zero subgroup and checks each nonzero tax pair
as well as the event total. Unknown types and nonzero unmatched tax rows still
fail closed. Both statements were replayed through preprocessing v2.

July's USD difference changed from **+4,112.8069** to **-1,633.6631** after restoring
the missing statement. July's refreshed Data Kiosk costs remained exactly
**-8,555.7569**.

## Remaining July USD difference

| Charge family | Settlement | Data Kiosk | Difference |
| --- | ---: | ---: | ---: |
| Advertising | -8,535.86 | -6,875.46 | -1,660.40 |
| Disposal | -198.69 | -219.12 | +20.43 |
| Monthly storage | -42.04 | -48.3396 | +6.2996 |
| Deals | -174.60 | -174.6073 | +0.0073 |
| Placement, inbound transport, coupons and aged storage combined | -1,238.23 | -1,238.23 | 0 |
| **Total** | **-10,189.42** | **-8,555.7569** | **-1,633.6631** |

Advertising is the main unresolved source difference, not a rounding error.
Settlement contains 17 generic advertising charges, approximately USD 500 each,
posted July 2–30. Data Kiosk contains 187 Sponsored Products components across
all 31 July dates and 10 SKUs. Their July total is identical in the previous and
new captures; tax and promotion fields do not explain the gap.
Independent sums from the archived source bytes exactly match both database
amounts, ruling out dropped rows or a sign conversion in this comparison.

The retained Settlement advertising rows do not identify invoices, campaign
types or the advertising service period. Amazon documents billing by threshold
or monthly cycle, and SKU Economics documents Sponsored Products advertising.
These provide plausible timing and scope explanations, but they do not prove
which explains this account's USD 1,660.40. August also has an advertising gap,
so it is not justified to claim that the July difference disappears next month.

Official references:

- [Amazon Ads billing cycles](https://advertising.amazon.com/help/GY3YNTWRZYVPLADL).
- [Amazon Ads payment methods](https://advertising.amazon.com/help/GMELNQQNEEVLX456).
- [SKU Economics report fields](https://sellercentral.amazon.de/help/hub/reference/external/GZ8Y22NL2FSRY8M5).

### Follow-up: official API contracts and live invoice references

The subsequent documentation review was checked against additional real API
responses, without changing the financial database or payout calculations.

The [Economics GraphQL schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)
defines advertising spend aggregated by product and date range. Its historical
advertising name is an open string, not a fixed enum; the linked SKU Economics
help page lists Sponsored Products charges as supported. The query requests all
returned products and advertising types. It applies no selected-SKU or ad-type
filter. The total is amount minus promotion plus tax, and daily aggregation uses
marketplace local time. The schema does not supply advertising invoice IDs,
campaign IDs or a guarantee that these product totals equal payments posted in
the same calendar month. It does not explicitly define the ad date as click date.

The [Finances v0 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/financesV0.json)
defines `ProductAdsPaymentEvent` as a Sponsored Products payment event, with a
posting timestamp, invoice ID, base amount, tax and total. A fresh
`listFinancialEvents` query completed all 20 pages for July. It returned 17 charge
events and 17 distinct invoice IDs. Every event matches exactly one current
Settlement advertising row by UTC timestamp, currency and signed amount, with
no duplicate match keys. The base and total are both **USD -8,535.86**; tax is
**zero**. Thus tax does not explain the July gap. The event label provides no
positive evidence that the difference consists of Sponsored Brands or Display;
the actual campaign mix still needs invoice details.

Two additional complete Data Kiosk queries tested aggregation directly:

| Product/date aggregation | Product facts | Advertising entries | USD advertising cost |
| --- | ---: | ---: | ---: |
| Existing MSKU / DAY | 1,178 July facts | 187 | 6,875.46 |
| Fresh MSKU / RANGE | 38 | 10 | 6,875.46 |
| Fresh CHILD_ASIN / RANGE | 26 | 9 | 6,875.46 |

Each fresh query completed in one terminal data page, with no product or ad-type
filter. Both return only `SponsoredProductFee`, with zero tax and promotion.
Changing daily aggregation or product identity therefore does not recover the
missing USD 1,660.40. This does not exclude an upstream omission common to all
three query modes.

An additional date-window test found that no fixed 0–30-day lag reconciles July
or August. That excludes a simple fixed date shift, but does not exclude variable
billing cycles or older unpaid balances. Amazon documents threshold-based
invoicing in its [billing-cycle guide](https://advertising.amazon.com/help/GY3YNTWRZYVPLADL).
This establishes why payment posting dates need not equal the underlying cost
period, but does not quantify how much of this account's gap comes from timing.

The remaining evidence is the 17 corresponding Ads invoices. The official
[Ads Billing API](https://advertising.amazon.com/API/docs/en-us/billing) exposes
`GET /invoices/{invoiceId}` with `invoiceSummary.fromDate/toDate`, campaign lines
including `programName` and cost, adjustments, promotions, payments and tax.
`POST /invoiceSummaries/list` alone does not provide that breakdown. Ads access
requires separate advertiser authorization; an SP-API token is not evidence of
Ads billing access. Invoice periods and campaign lines are needed to distinguish
older billed costs, other advertising products, adjustments, or missing product
spend. **The exact allocation of USD 1,660.40 remains unproven.**

Private invoice references, repeatable read-only scripts, raw diagnostic query
documents and sanitized aggregate proofs are retained in
`output/advertising-doc-investigation-2026-10-01/`. No invoice/customer identifiers
are included in this document.

The previous [disposal investigation](data_kiosk_disposal_discrepancy_2026-09-07.md)
found actual duplicate logical disposal events in Amazon's Data Kiosk output.
Its USD 54.48 finding covered June–August, not July alone and not advertising.
No blind deduplication or balancing entries were introduced here.

## July after the EU backfill

The previous frontend sample had deliberately omitted some listed EU reports.
Retrieving all currently available statements changed the July controls:

| Currency | Previous difference | Refreshed difference | Advertising contribution after refresh | Other cost contributions |
| --- | ---: | ---: | ---: | ---: |
| USD | +4,112.8069 | -1,633.6631 | -1,660.40 | +26.7369 |
| EUR | +4,062.6300 | -1,529.2600 | -1,355.05 | -174.2100 |
| GBP | +1,250.5273 | -1,441.9327 | -1,379.96 | -61.9727 |

Each row is a separate currency; these values must not be added together. More
complete imports correct the comparison but do not necessarily reduce its
absolute value. Advertising remains the largest contribution in all three.

## Grouping can make individual rows look much larger

After restoring the US statements, July's USD controls split as follows:

| Marketplace group | Settlement controls | Data Kiosk costs | Difference |
| --- | ---: | ---: | ---: |
| Amazon.com | -1,483.46 | -8,555.7569 | +7,072.2969 |
| Unspecified in Settlement | -8,705.96 | 0 | -8,705.96 |
| **USD total** | **-10,189.42** | **-8,555.7569** | **-1,633.6631** |

The unspecified group contains advertising and an inbound transportation charge.
These positive and negative rows offset at account/currency level. Assigning an
invented marketplace to the source rows would conceal the source limitation.
The earlier [blank-marketplace investigation](blank_marketplace_investigation_2026-09-06.md)
corroborated US billing for advertising charges, but that does not identify their
campaign scope or service period.

## Missing Settlement coverage is not a zero charge

Japan returned no Settlement reports in fresh discovery. Its July Data Kiosk
costs are **JPY -333,076.9326**, while imported Settlement controls are zero.
The resulting **JPY +333,076.9326** is entirely an absent-counterpart difference,
not evidence of a SelBox gain. The available data does not establish why this
seller returns no Settlement reports.
An additional unfiltered discovery omitted marketplace and processing-status
filters at the actual SDK request layer. Both the current V2 type and deprecated
flat-file/XML types still returned zero reports across the available 90-day
window, with no API errors or additional pages. Those filters and formats do not
explain the absence.

Eleven retained older EU report references cannot be downloaded. A fresh probe
returned `InvalidInput`; no recoverable copies were found among 201 local file
candidates. Amazon's [Reports API reference](https://developer-docs.amazon/sp-api/reference/getreports)
states a maximum report retention of 90 days. June EU coverage therefore cannot
be described as complete.

## Eligibility limitation

`private.assert_payout_source_versions` verifies supplied Settlement versions
and complete compatible Data Kiosk daily coverage. It does not establish that
all Settlement reports were discovered, downloaded and preprocessed. In
particular, an empty Settlement version list can pass. Maturity alone does not
repair missing source acquisitions.

This explains how earlier monthly reports could be generated while the two US
statements remained rejected, and why reports can still be generated for scopes
with unavailable Settlement evidence. A successful automatic report refresh is
not a completeness certificate. Follow-up should track Settlement discovery and
processing completeness and show unavailable controls explicitly, rather than
treat every absent Settlement counterpart as a confirmed monetary difference.

## Verification evidence

Private acquisition checkpoints, immutable source archives, aggregate analysis,
backup and preservation checks are retained under
`output/financial-refresh-2026-10-01/`. That ignored directory is not a portable
source-data fixture. No fee configuration, SKU ownership or historical payout
snapshot was rewritten during the refresh.

Final checks passed:

- 315 Python unit tests; targeted Ruff/Pyright checks and generated type-catalog
  drift verification.
- Exact authenticated comparison of 31 latest company/currency reports with live
  estimates: 562 type groups, 67,459 records, including 5,553 zero-amount records.
- Independently calculated source sums match 920 current reconciliation groups
  and 14,230 frozen reconciliation rows. This checks implementation arithmetic,
  separately from the source completeness limitations above.
- Four financial browser tabs, row details and reloads succeeded with real Auth
  and API responses, no JavaScript/API errors and no configuration writes.
- Backup comparison across 14 tables preserved every existing configuration,
  inventory and frozen report row. Automatic generation appended 49 reports.
