# Data Kiosk EPR and storage-adjustment coverage: 2026-09-13

Historical source observations are retained as evidence. Current preprocessing uses the
[explicit Type registry](../transaction_type_registry.md): reviewed retained charges are
registered as `SELBOX`, and unknown types abort rather than defaulting.

**Finding:** fresh US and GB Economics queries returned ordinary storage fees,
but no explicit EPR service fee, EPR eco-contribution, or storage-adjustment fee
or component. Coverage of the three historical Settlement charges remains
unverified. This evidence supports leaving those unmatched charges with `SELBOX`
under the [current classification rules](../settlement_component_categories.md).

## Query scope

Queries created on September 13, 2026 requested **May 1 through September 6,
2026**, aggregated by **DAY and MSKU**, from
`analytics_economics_2024_03_15`. Both downloads completed on September 13.

| Marketplace | Returned rows | Days with rows | Pages | Pagination and scope validation |
| ----------- | ------------: | -------------: | ----: | ------------------------------- |
| US          |         4,902 |            129 |     1 | Terminal page; passed           |
| GB          |         3,612 |            129 |     1 | Terminal page; passed           |

The queries requested unrestricted fee output and optional fulfillment/storage
component breakdowns. Each response had no next token and passed source
normalization at the time of the investigation. This establishes acquisition of
those query responses; it does not establish complete or final company-payout
coverage.

All returned monetary components in both markets had reviewed mappings at the
time of the investigation.

Amazon's [Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)
returns fee names through `FeeSummary.feeTypeName` and component names through
`FeeComponent.name`, both strings. `includeComponentsForFeeTypes` controls
breakdown generation, not which fees are returned. Its enum is not an exhaustive
list of supported output fees. The public schema does not explicitly establish
EPR or storage-adjustment inclusion.

## Observed costs

| Target                                                 | Result in the checked US and GB responses                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Amazon service fee for EPR Pay on Behalf, GB Packaging | No explicit fee or component found.                                                                                  |
| Eco-contribution for EPR Pay on Behalf, GB Packaging   | No explicit fee or component found.                                                                                  |
| `Fee Adjustment` / `FBAStorageFeeAdjustment`           | No explicit fee or component found.                                                                                  |
| Ordinary monthly storage                               | `FbaStorageFee` was returned in both markets, with `BaseMonthlyStorageFee` and `UtilizationSurchargeFee` components. |
| Long-term storage                                      | `LongTermStorageFee` was returned in both markets.                                                                   |

Monthly storage totals below use each parent charge's `totalAmount` once;
components are not added again. Values preserve source precision.

| Fee date   |  US, USD | GB, GBP |
| ---------- | -------: | ------: |
| 2026-05-31 |  23.3313 | 27.0209 |
| 2026-06-30 | 42.04020 | 26.9303 |
| 2026-07-31 |  48.3396 | 27.3100 |
| 2026-08-31 | 46.32990 | 22.0496 |

There were no negative monthly or long-term storage charges in either response,
and no returned properties identifying an adjustment. Absence of a separate
adjustment or negative charge does not rule out an adjustment already netted into
a positive storage total.

## Limits of the comparison

The [September 6 investigation](blank_marketplace_investigation_2026-09-06.md)
matched one generic Settlement `Fee Adjustment` to Finances
`FBAStorageFeeAdjustment` using timestamp, currency, and amount. That identifies
the observed event's meaning; it does not establish its Data Kiosk representation
or justify mapping every future generic adjustment to storage.

The retained historical summaries do not preserve the three target Settlement
rows' amounts and posting dates, and their referenced raw copies are no longer
available locally. Therefore this check cannot establish a precise-event match
or confirm that each target posting falls within the requested query period.

These findings mean **not found explicitly in the checked responses**, not that
Amazon never returns these costs or never includes them within another total.
The [explicit cost policy](../settlement_component_categories.md) leaves these
unmapped Settlement charges with `SELBOX`. A missing individual Data Kiosk
counterpart alone does not block Settlement preprocessing or create a company
allocation from the Settlement amount.
