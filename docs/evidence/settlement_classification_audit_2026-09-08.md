# Settlement classification audit: 2026-09-08

**Finding:** no observed row contradicted the F1–F7 SKU and
component assumptions in **116 structurally valid, distinct settlement documents
containing 174,249 content rows**. Rows outside those families were counted separately. This
supports the [seven-family classification policy](../settlement_component_categories.md)
where those families were observed; it is not a guarantee across every marketplace
or future transaction. Retrocharge identity/completeness remains a separate
qualification described below.

This was a read-only audit of settlement documents. Sellers API calls established
account participation for audit coverage; application financial amounts come
from Settlement Reports and Data Kiosk.

The strict counts below describe the parser used for this audit. The current
[trailing-empty-field convention](../data_workflows.md#trailing-empty-fields)
accepts optional omitted suffixes, supported by the
[acquisition evidence](settlement_trailing_columns_investigation_2026-09-11.md).
The [metadata and row contract](../data_workflows.md#metadata-and-transaction-rows)
also treats valid out-of-period postings as diagnostics. Neither policy changes
the historical audit populations reported here.

## Acquisition and date coverage

On September 8, fresh Sellers and Reports API calls covered all five configured
credential scopes. Sellers returned **18 active canonical marketplaces**. Each
scope was queried for completed V2 settlement reports created from
**2026-06-10 03:22:54 UTC through 2026-09-08 03:22:54 UTC**, with complete pagination
and no marketplace filter. A second listing using active marketplace IDs returned
the same report identities in every scope. No discovery identity anomalies or
uncovered current report references remained.

| Credential scope | Active canonical marketplaces                                                                       | Listed reports |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------------: |
| NA               | US, Canada, Mexico                                                                                  |             18 |
| EU               | UAE, Belgium, Germany, Spain, France, UK, Ireland, Italy, Netherlands, Poland, Saudi Arabia, Sweden |             66 |
| Japan            | Japan                                                                                               |              0 |
| Singapore        | Singapore                                                                                           |              2 |
| Australia        | Australia                                                                                           |              8 |
| **Total**        | **18 marketplaces**                                                                                 |         **94** |

The 90-day range follows the documented `getReports` discovery window. These API
parameters select **report creation dates**, not the dates of rows inside the
report. This audit did not test whether an already known settlement document ID
remains downloadable after that window; it establishes neither universal day-91
expiration nor indefinite retrieval. Marketplace filtering is optional and
matches at least one supplied ID; it does not establish an individual row's
marketplace. The audit therefore kept every content row of each selected
document. [Official Reports API model](https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json)

Of the 94 current references, **49 were downloaded again on September 8 and had
identical decoded-content hashes to their retained copies**. The remaining
**45 EU documents used September 7 raw downloads**, matched to the current
listing by credential scope, report/document identity, and available reference
metadata. No hash differences occurred in the refreshed subset. The other 45
bodies were not independently refreshed on September 8; matching identities do
not establish a general document-immutability guarantee. Reuse avoided redundant
downloads after the documented default `getReportDocument` burst of 15 and rate
of 0.0167 requests per second. [Official document retrieval reference](https://developer-docs.amazon/sp-api/reference/getreportdocument)

One pair of Australian report references contained the same settlement body.
Counting it once leaves **93 distinct current documents and 150,809 rows**, with
posting timestamps from **May 13 through September 5**. There were no conflicting
bodies for a settlement within the same credential scope.

The audit also inspected 27 older locally retained TSVs associated with earlier
Reports API acquisition logs. **23 passed the audit's strict parser**, adding
23,440 rows posted from **February 18 through May 7**. Their provenance is weaker
than the recent downloads: no retained acquisition digest manifest proves that
the historical bytes are unchanged. The other four are reported separately below.
This describes the evidence available to the September 8 audit. The September 11
follow-up later matched all 27 archives to the original logged SDK document
strings, providing stronger provenance without authenticating historical HTTP
transport bytes or establishing the exact historical SDK version.

The combined strict sample therefore contains **116 documents**, with posting
timestamps ranging from **February 18 through September 5, 2026**. This is an
incomplete historical extension of an exhaustive current listing, **not continuous
seven-month coverage**. Older settlements cannot simply be regenerated for this
audit: Amazon automatically produces settlement reports and does not permit
requesting or scheduling them. [Settlement report documentation](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement)

## Classification results

The audit applied the documented positive family matches before validating SKU
and component fields. A failed known-family check could not fall through to
the unmatched population. Source SKU values were preserved.

| Rule    | Family                                           | Combined strict rows | Observed check failures |
| ------- | ------------------------------------------------ | -------------------: | ----------------------: |
| F1      | Ordinary orders and refunds                      |              172,788 |                       0 |
| F2      | Liquidations and liquidation adjustments         |                   92 |                       0 |
| F3      | FBA inventory reimbursements                     |                  380 |                       0 |
| F4      | Recognized fulfillment-fee corrections/reversals |                    8 |                       0 |
| F5      | Cross-account debt                               |                   83 |                       0 |
| F6      | Recognized account charges and movements         |                  163 |                       0 |
| F7      | Tax retrocharges; observed group checks only     |                   24 |                       0 |
| Default | Everything outside F1–F7                         |                  711 |  No admission allowlist |

- **F1–F4: 173,268 rows.** Every row contained SKU and passed its component
  checks, including 16,020 zero-amount rows.
- **F5–F7: 270 rows.** Every row had blank SKU and passed the observed
  component checks. Retrocharges require the additional qualification below.
- **Outside F1–F7: 711 rows.** All happened to have blank SKU in this sample. This
  does not imply a blank-SKU requirement for unmatched rows. The current cost
  registry and `SELBOX` default determine their allocation category.

All 116 strict documents reconciled their signed content amounts to their TSV
control totals. This is an internal arithmetic check, not independent verification
of Amazon's amounts or of company ownership.

The historical extension added three combinations beyond the previous
107-combination snapshot: two cross-account debt country-list variants and
`Order_Retrocharge / ItemWithheldTax / MarketplaceFacilitatorTax-Shipping`.
All three already fit the existing family rules; no new classification rule was
needed. The strict sample contains 110 observed combinations.

### Marketplace evidence

This table uses each row's actual nonblank `marketplace-name`, without inferring
marketplaces from currency, endpoint, neighboring rows, or Reports API IDs.
All listed F1–F4 rows had SKU; no known-family row failed the audited checks.

| Marketplace name                 | Content rows |       F1–F4 |   F5–F7 | Outside F1–F7 |
| -------------------------------- | -----------: | ----------: | ------: | ------------: |
| Amazon.com                       |       30,398 |      30,301 |      13 |            84 |
| Amazon.ca                        |           84 |          75 |       0 |             9 |
| Amazon.co.uk                     |       79,094 |      78,891 |       7 |           196 |
| Amazon.com.be                    |        1,772 |       1,772 |       0 |             0 |
| Amazon.de                        |       19,237 |      19,195 |       4 |            38 |
| Amazon.es                        |        1,730 |       1,721 |       0 |             9 |
| Amazon.fr                        |       24,420 |      24,408 |       0 |            12 |
| Amazon.ie                        |          599 |         599 |       0 |             0 |
| Amazon.it                        |        9,166 |       9,154 |       0 |            12 |
| Amazon.nl                        |          791 |         791 |       0 |             0 |
| Amazon.pl                        |          118 |         118 |       0 |             0 |
| Amazon.se                        |          537 |         537 |       0 |             0 |
| Amazon.com.au                    |        5,259 |       5,221 |       0 |            38 |
| Amazon.sg                        |           14 |          11 |       0 |             3 |
| **14 named Amazon marketplaces** |  **173,219** | **172,794** |  **24** |       **401** |
| Non-Amazon US                    |            2 |           2 |       0 |             0 |
| Blank marketplace name           |        1,028 |         472 |     246 |           310 |
| **All rows**                     |  **174,249** | **173,268** | **270** |       **711** |

The two `Non-Amazon US` rows occur alongside `Amazon.com` rows in one archived
document and fit ordinary-order F1. They are not evidence for a fifteenth Amazon
marketplace. Nor does their classification by itself decide whether SelBox commission applies to that sales channel.

Japan returned no reports. Mexico, UAE, and Saudi Arabia had no Amazon-named
content rows in this evidence. The five NA documents denominated in MXN contained
13 blank-marketplace account rows; they do not establish SKU-family behavior in
Mexico. **These four active marketplaces cannot be empirically confirmed for
F1–F4 by this audit.** Small samples, such as Singapore's 11 F1 rows,
also provide less evidence than the larger marketplaces. No marketplace should
be described as having exercised every family merely because it appears above.

### Retrocharge qualification

The current documents contain six candidate retrocharge groups and 20 rows. The
strict archive adds one group and four rows. All **seven candidate groups / 24
rows** had supported tax/withholding components, blank SKU, required observed
identity fields, and a signed total of zero; every group included both tax and
withholding components.

These results support the observed neutral treatment for the observed groups.
They do **not independently prove original event identity or source completeness**
for every possible retrocharge group. A zero total alone cannot certify that no
offsetting rows are missing. The current preprocessor requires the
[retrocharge group contract](../settlement_component_categories.md#retrocharge-group-contract),
including reviewed complete source-line coverage, before accepting a group.

## Separate structural and date findings

**Four historical documents failed the parser used for this audit.** Fifteen
physical rows had 23 values under a 24-column header, consistent with an omitted
final `promotion-id` value. They are excluded from the 116-document strict
result. A separate diagnostic pass supplied only that final empty cell in
memory and inspected all 27 archives: **35,698 rows, zero observed classification
violations**. This supplemental result was not a strict parse pass under the
audit's parser. The September 8 evidence did not
establish whether Amazon or later file handling caused the shorter rows.

The [September 11 follow-up](settlement_trailing_columns_investigation_2026-09-11.md)
subsequently found the same short rows in logged SDK-returned documents and in
three identical downloads of one affected report. This supports the current
[trailing-empty-field convention](../data_workflows.md#trailing-empty-fields),
subject to required-field and family validation.
The likely Amazon serialization cause remains an inference; the strict and
supplemental audit samples above remain separate historical measurements.

The supplemental data also contained three `Vine Enrollment Fee` rows and one
`Refund for Advertiser` row. They remained outside F1–F7.
These descriptions occur only in the supplemental sample, and their Data Kiosk
coverage was not checked here.

**Six otherwise valid F6 reserve rows were posted 8–9 seconds after the
TSV settlement end timestamp.** All were `Current Reserve Amount` rows: three
in the current documents and three in the strict archive. This contradicts an
unconditional rule requiring every content timestamp to fall inside the header
window. It does not contradict the F6 family check.

The current policy preserves these rows and their original timestamps
with diagnostics, without inventing a time tolerance or a reserve-only exception.
Both timestamp and calendar-date containment are diagnostic; malformed dates,
contradictory date fields, identity failures, and reconciliation failures remain
validation errors. See the [metadata contract](../data_workflows.md#metadata-and-transaction-rows).

## Interpretation and retained evidence

The observed expansion supports the seven family/SKU assumptions without
adding new family rules. These audit groups do not choose the current source of
company amounts; the explicit cost registry and named categories govern that
separate decision.

This audit validates observed structural relationships in settlement content. It
does not establish Data Kiosk completeness, correct source exclusions, eventual
consistency, correct fees, immutable SKU-company ownership, or correct company
payouts. Those are separate assumptions and checks in the
[source-allocation contract](../source_allocation.md).

The [sanitized audit evidence](settlement_classification_audit_2026-09-08.json)
retains acquisition coverage, classification counts, component combinations,
document checks, and qualifications. Seller/order/report identifiers, credentials,
download URLs, and private archive locations are not included in this document.
