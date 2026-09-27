# Company-cost country evidence: 2026-09-13

Historical source observations are retained as evidence. Current preprocessing uses the
[explicit Type registry](../transaction_type_registry.md): reviewed retained charges are
registered as `SELBOX`, and unknown types abort rather than defaulting.

**Finding:** Economics responses in the September 13, 2026 snapshot contain 24,768 daily MSKU rows across 15 countries. The approved company-cost families have concrete native fee evidence, including Japan's reviewed `LabelingFee` family.

This note preserves the source observations supporting the
[source-allocation policy](../source_allocation.md) and
[classification rules](../settlement_component_categories.md). Those contracts
define the current implementation and policy; the observations below establish
coverage only for the acquired sample.

## Scope and acquisition

On September 13, 2026, Sellers `getMarketplaceParticipations` was called for all five configured credential scopes. The active countries were:

| Credential scope | Active countries                               |
| ---------------- | ---------------------------------------------- |
| NA               | US, CA, MX                                     |
| EU               | AE, BE, DE, ES, FR, GB, IE, IT, NL, PL, SA, SE |
| JAPAN            | JP                                             |
| SINGAPORE        | SG                                             |
| AUSTRALIA        | AU                                             |

Economics queries requested **May 1 through September 6, 2026, inclusive: 129 marketplace-local days**, using `analytics_economics_2024_03_15`, `DAY`, and `MSKU`. They requested all returned fees, ads, sales, seller-provided costs, and net proceeds, with optional fulfillment and storage component breakdowns. `includeComponentsForFeeTypes` selects additional breakdowns; it does not filter the fee output. This behavior and the string-valued fee names are defined by the [official Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

US and GB reuse exact responses acquired earlier on September 13 for the same pinned query and date window. Other countries use new country-specific queries. The lifecycle uses `createQuery`, bounded `getQuery` polling, `getDocument`, signed-document download, and complete result pagination. A subsequent `getQueries` inspection distinguishes EU submission failures from previously created queries before retrying.

| Country | Acquisition result | Full normalization | MSKU rows | Days with rows | Pages |
| ------- | ------------------ | ------------------ | --------: | -------------: | ----: |
| AE      | no_data            | Not applicable     |         0 |              0 |     1 |
| AU      | data               | passed             |     2,709 |            129 |     1 |
| BE      | data               | passed             |       645 |            129 |     1 |
| CA      | data               | passed             |     1,290 |            129 |     1 |
| DE      | data               | passed             |     1,548 |            129 |     1 |
| ES      | data               | passed             |     1,161 |            129 |     1 |
| FR      | data               | passed             |     1,161 |            129 |     1 |
| GB      | data               | passed             |     3,612 |            129 |     1 |
| IE      | data               | passed             |       645 |            129 |     1 |
| IT      | data               | passed             |     1,161 |            129 |     1 |
| JP      | data               | passed             |     3,741 |            129 |     1 |
| MX      | no_data            | Not applicable     |         0 |              0 |     1 |
| NL      | data               | passed             |       645 |            129 |     1 |
| PL      | data               | passed             |       258 |            129 |     1 |
| SA      | no_data            | Not applicable     |         0 |              0 |     1 |
| SE      | data               | passed             |       645 |            129 |     1 |
| SG      | data               | passed             |       645 |            129 |     1 |
| US      | data               | passed             |     4,902 |            129 |     1 |

**No-data countries:** AE, MX, SA. A terminal no-data response establishes the result of that request. It does not prove fee support, absence of all charges, or complete company-payout coverage.

The committed [sanitized JSON](category3_country_evidence_2026-09-13.json) retains country aggregates, source-query hashes, archive hashes, component names, availability flags, and source-evidence digests. Private identifiers and raw SKU/order values are omitted.

## Germany signed-refund observation

On June 9, one German source row reports EUR114.42 ordered sales, EUR−0.93 refunded sales, and EUR115.35 net sales. These values satisfy the [documented Amazon formula](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql#L346-L364): `netProductSales = orderedProductSales - refundedProductSales`, so `114.42 - (-0.93) = 115.35`. Using the refund magnitude would incorrectly expect EUR113.49.

All 24,768 archived rows satisfy the signed formula; this German row is the only observed negative refund amount. The JSON retains the original sales values. The observation does not identify why the refund is negative.

## Observed company-cost families

Countries below had at least one **nonzero native parent fee or advertising charge**. A name appearing only with zero amounts is recorded separately in JSON. The matrix records empirical coverage; it is not a country whitelist for classification or a promise of Amazon support.

| Family                         | Native Data Kiosk labels                         | Countries with nonzero charges                         | Countries with nonzero tax | Countries with negative charges |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------ | -------------------------- | ------------------------------- |
| Disposal                       | `DisposalFee`                                    | AU, CA, DE, ES, FR, GB, IT, JP, US                     | AU, JP                     | None observed                   |
| Removal                        | `RemovalFee`                                     | GB, US                                                 | None observed              | None observed                   |
| Monthly storage                | `FbaStorageFee`                                  | AU, CA, DE, ES, FR, GB, IT, JP, SG, US                 | AU, JP, SG                 | None observed                   |
| Long-term storage              | `LongTermStorageFee`                             | AU, CA, GB, JP, SG, US                                 | AU, JP, SG                 | None observed                   |
| Inbound placement              | `FbaInboundConvenienceFee`                       | US                                                     | None observed              | None observed                   |
| Inbound transportation         | `FbaInboundTransportationFee`                    | DE, GB, US                                             | None observed              | None observed                   |
| Inbound transportation program | `FbaInboundTransportationProgramFee`             | DE, GB                                                 | None observed              | None observed                   |
| Coupon fees                    | `CouponParticipationFee`; `CouponPerformanceFee` | US                                                     | None observed              | None observed                   |
| Deal fees                      | `DealParticipationFee`; `DealPerformanceFee`     | DE, ES, FR, GB, IT, JP, US                             | None observed              | None observed                   |
| Advertising                    | `SponsoredProductFee`                            | AU, BE, DE, ES, FR, GB, IE, IT, JP, NL, PL, SE, SG, US | None observed              | None observed                   |
| Labeling                       | `LabelingFee`                                    | JP                                                     | JP                         | None observed                   |

Amounts use each parent charge's `totalAmount` once, preserving `amount - promotionAmount + taxAmount` and source signs. Positive source costs become negative company components; negative source charges remain credits. Fulfillment and storage breakdown components are retained as explanation and are not added to their parent amount. Promotions and tax observations are recorded independently for every label/currency in JSON.

Referral, fulfillment, digital-service, refund-commission, reimbursement, and other approved `SETTLEMENT` economic components remain represented by Settlement; their Data Kiosk copies are excluded from company-cost selection. Seller-entered cost fields remain analysis-only.

## Japan labeling review

Japan returned **seven `LabelingFee` charges across seven dates**, all on rows with nonblank MSKU. They cover **1,948 units**, with **JPY38,960 base + JPY3,896 tax = JPY42,856 total**. Every charge has JPY20 base and JPY2 tax per unit; the native `amountPerUnit` is JPY22. Promotions are zero, `amountPerUnitDelta` and `components` are null, properties are empty, and each charge retains its own identifier and same-day subperiod.

Amazon's [Japan FBA service description](https://sellercentral-japan.amazon.com/help/hub/reference/external/G201074400) identifies barcode application to inventory as an optional per-item service. The source label and consistent unit pattern support the reviewed inference that these entries represent that labeling service. This is sufficient to explicitly approve `LABELING_FEE` for Data Kiosk company costs; the help page does not publish a machine-label crosswalk.

The seven rows independently contain referral and fulfillment parent fees. Labeling is not a nested fulfillment component in those responses. No corresponding Settlement labeling triple was found in the checked reports or retained catalog, so no Settlement label is invented. This does not establish that every possible future Settlement shape is free from `SETTLEMENT` overlap.

## Settlement evidence and explicit classification

The read-only Reports discovery used the preceding 90 days of creation dates and all configured marketplace candidates in each credential scope. It returned **87 report records**: EU 62, NA 15, Australia 8, Singapore 2, Japan 0, with no identity anomalies. These broad metadata marketplace lists do not establish row-level country coverage.

Twelve `getReportDocument` downloads succeeded: nine EU, two NA, and one Singapore, adding 21,248 content rows. Together with 27 historical TSVs and four previously retained recent documents, the replay covers **43 unique decoded reports and 43 settlement identities, containing 58,261 content rows**. No different body reused the same settlement identity. The data includes 14 canonical marketplace names, `Non-Amazon US`, and 449 rows with blank marketplace name. Country claims come from row content, not discovery metadata.

The fee-candidate review contains **254 rows across 18 exact triples**; all 254 have blank SKU. Of these, **250 rows across 16 triples** match the approved `DATA_KIOSK` registry. The remaining three Vine enrollment rows and one advertiser-refund row default to `SELBOX` under the policy. The historical 107-triple catalog is independent evidence; its counts are not added to these replay counts.

At this review, the explicit cost registry contained **23 approved triples** (now part of the [shared Type registry](../../services/sync/src/transaction_types/settlement.py)), including previously retained variants not present in this particular replay. Its families cover storage, aged storage, disposal, removal, inbound placement and transportation, coupons, deals, and advertising. Matching a known family precedes validation of its permitted description, so a malformed known charge cannot escape through the default.

The following remain outside the explicit Settlement `DATA_KIOSK` registry: inbound defect charges, Vine enrollment, `Refund for Advertiser`, EPR service fees, EPR eco-contributions, and generic `Fee Adjustment`. Ordinary storage observations do not prove storage-adjustment coverage, and advertising observations do not prove that an advertiser refund is represented in Data Kiosk. One historical advertiser-refund candidate is a positive USD5.27 credit; that sign alone does not establish its Data Kiosk representation.

Fresh discovery found no Japan Settlement reports in its 90-day creation window, despite active Sellers participation and substantial Japan Data Kiosk output. The MXN report contains only blank-marketplace content, and there is no AE or SA content in the retained Settlement sample. These gaps are not evidence that corresponding countries cannot support the fees.

## Evidence limits

The observations support explicit fee mappings, including `LabelingFee`; they
do not support fuzzy matching or approval of unknown components. Observed
country coverage is not a whitelist, and a missing individual Data Kiosk
counterpart does not determine a Settlement row's category.

Broad source queries establish observed shapes, signs, taxes, and country
coverage. They do not prove complete or final payouts, or equality to Settlement.
The [accepted disposal discrepancy](data_kiosk_disposal_discrepancy_2026-09-07.md)
and [source limitations](../known_issues.md) still apply. Required coverage and
unknown-component handling are defined by the
[workflow contract](../data_workflows.md).
