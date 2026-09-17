# Financial source allocation

Use Settlement amounts for recognized `SETTLEMENT` families and historical Data
Kiosk amounts for explicitly approved `DATA_KIOSK` costs. Other settlement
families default to `SELBOX`, preserving raw SKU and a review signal for unfamiliar
families. SelBox accepts the resulting surplus or shortfall, including the known
Amazon disposal-data discrepancy.

Settlement Reports and Data Kiosk are the only Amazon financial sources. There is
no runtime FBA-report or Finances dependency. The [workflow contract](data_workflows.md)
owns archives, offline preprocessing, versions, and retention; the
[live-fee design](company_fees.md) owns versioned ownership,
complete SKU terms, and live SQL. This undeployed application uses a fresh
database baseline. [Frozen payout reports](company_payout_reports.md) are
implemented; approval and payment execution remain deferred.

## 1. Evidence and assumptions

Classification rules are SelBox assumptions based on observed reports, not Amazon
guarantees. The supported family signatures and their required fields form the
contract; sample counts and observed countries are not admission rules or proof
of universal coverage. A country with no available report or no returned charge
does not establish zero cost or complete company entitlement.

The [Settlement SKU audit](evidence/settlement_sku_completeness_2026-09-07.md)
supports the required-SKU assumptions; the
[country study](evidence/category3_country_evidence_2026-09-13.md) records the
observed Data Kiosk cost families, tax/credit shapes, and coverage limits.

A [family rule](settlement_component_categories.md) matches transaction type,
amount type, and descriptions where needed, then validates the family's required
fields and accounting conditions. Failed known checks abort; they cannot turn
into an unmatched row. Unmatched families alone use `SELBOX` with a nonblocking
review signal. SKU presence never determines source authority.

## 2. The three settlement categories

Every monetary content row belongs to exactly one category. The TSV column header
and first metadata row are not transactions. Preserve source-line/document
references, original signs, amounts, and raw SKU; archives preserve every cell.

| Category     | Settlement treatment                                                          | Company amount                         | View                         |
| ------------ | ----------------------------------------------------------------------------- | -------------------------------------- | ---------------------------- |
| `SETTLEMENT` | Known family requires nonblank SKU                                            | Settlement through exact SKU ownership | `settlement_sku_entries`     |
| `SELBOX`     | Known account families keep blank-SKU checks; unmatched rows preserve any SKU | No allocation from that row            | `settlement_account_entries` |
| `DATA_KIOSK` | Explicit cost family preserves any SKU and its control amount                 | Selected Data Kiosk components         | `settlement_others_entries`  |

Each source has one fact table and three category views. Both store a required
`public.allocation_category` matching Python `AllocationCategory`. Data Kiosk also
permits explicit `ANALYSIS_ONLY` diagnostic facts outside the three views; Settlement
does not. Unrecognized Data Kiosk monetary components fail preprocessing rather
than receiving a provisional category. There is no stored unresolved category.

### SETTLEMENT: amounts from Settlement

Known families cover ordinary Order/Refund components, inventory reimbursements
and clawbacks, liquidations/adjustments, and specifically supported fulfillment-fee
corrections/reversals. The [exact rules](settlement_component_categories.md), not
broad labels such as `AmazonFees`, establish membership.

Require explicit SKU even for zero amounts. A missing SKU aborts the report; do
not allocate only valid rows or substitute Data Kiosk. Include approved principal,
shipping, fee, promotion, and tax components with original signs once. Exclude
Data Kiosk counterparts from company amounts even when dates or values differ.

### SELBOX: retained by SelBox

Recognized account families retain distinct accounting meanings:

- Subscription fees are SelBox operating expenses.
- Reserves, payable-to-Amazon balances, account charges, failed transfers, and
  cross-account debt adjustments are balance/payment movements, not automatically
  current-period income or expense.
- Order/Refund retrocharges require the explicit complete-group, same-currency,
  zero-net contract. Nonzero, incomplete, or unidentified groups fail; zero alone
  does not prove complete acquisition.

Generic adjustments, EPR charges, and other unmatched families remain `SELBOX`
without an asserted subtype. Keep raw SKU, signs, and review signals. Blank SKU
alone is not evidence of account meaning: advertising is an explicit `DATA_KIOSK`
cost despite its settlement billing label.

These rows do not directly allocate company entitlement. A settlement default does
not suppress an independently approved Data Kiosk cost. A recognized account
component with MSKU in Data Kiosk fails preprocessing; it cannot become `SELBOX`
or be promoted to a company expense.

### DATA_KIOSK: amounts from Data Kiosk

Explicit settlement cost families cover storage, long-term storage, disposal,
removal, inbound placement/transportation and associated program fees, coupon/deal
service fees, and advertising. The [family rules](settlement_component_categories.md)
own exact matching fields and allowed base/tax descriptions. Similar wording does
not approve inbound defects, Vine, advertiser refunds, EPR, or generic adjustments;
unmatched families remain `SELBOX`.

Reviewed Data Kiosk `LabelingFee` is an additional cost observed in Japan; no
unobserved settlement spelling is invented for it. Mapping scope and observed
country coverage remain separate. Missing observations are not proof of zero.

Use selected Data Kiosk costs once, regardless of whether the settlement control
has a SKU. Do not allocate or proportionally redistribute the control amount.
Classification uses stable reviewed rules, not availability of an individual
Data Kiosk counterpart. Required source coverage is checked separately. The
`SELBOX` default can leave a newly named sale/credit with SelBox pending review;
it is not a guarantee of complete company entitlement.

## 3. Abort when an assumption fails

Known-family conflicts, failed SKU/accounting checks, malformed source fields,
identity conflicts, and failed report totals abort complete preprocessing. Apply
the [trailing-field convention](data_workflows.md#trailing-empty-fields) without
relaxing required fields. Every ordinary F1 Order/Refund row requires its own
usable marketplace, including noncommission and zero amounts; never infer it
from API hints, another row, currency, or endpoint.

Publish a complete category partition atomically. Failures keep the successful
acquisition, archives, source diagnostics, and prior current selection; no partial
result or failed-attempt database row is inserted. Administrators must declare
the complete required settlement list and processor definition for a payout.
The database validates that declared scope; it cannot discover an omitted failed
acquisition or decide whether an older retained interpretation meets a new policy.

Unknown Settlement families can classify as `SELBOX` while their meaning remains
under review. This does not waive known-family checks. Acceptance of a financially
different but valid Data Kiosk observation is separate from accepting an unmapped
component, failed download, incomplete parse, or missing coverage.

## 4. Select Data Kiosk components without counting costs twice

Use historical `economics`, not `economicsPreview`. Select individual components,
not whole SKU rows: SKU X can have a Settlement sale and a Data Kiosk storage cost.
Exclude its Data Kiosk sale/referral/fulfillment counterpart while retaining storage.
The current DAY/MSKU query produces no account entries.

| Data Kiosk element/family                                                                      | Company treatment                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `sales`: ordered/refunded/net product sales                                                    | Exclude; use Settlement. Units and average prices are not additional money |
| `ReferralFee`, `FbaFulfilmentFee`, `RefundedReferralFee`, `RefundCommissionFee`                | Exclude Settlement order/refund counterparts                               |
| `DigitalServicesFeeFBA`, `DigitalServicesFeeSOA`                                               | Exclude observed Settlement order/refund costs                             |
| `FBAInventoryReimbursement`, `LiquidationProcessingFee`, `LiquidationReferralFee`              | Exclude Settlement reimbursement/liquidation counterparts                  |
| Other explicitly mapped `SETTLEMENT` fee, tax, credit, or reversal                             | Exclude the full economic component                                        |
| Known account component with MSKU, including `SubscriptionFee`                                 | Abort; never publish `SELBOX` with SKU                                     |
| `DisposalFee`, `RemovalFee`, `LongTermStorageFee`, `FbaStorageFee`, `LabelingFee`              | Include approved costs, credits, promotions, and taxes                     |
| `FbaInboundConvenienceFee`, `FbaInboundTransportationFee`                                      | Include inbound placement/transportation costs                             |
| `CouponParticipationFee`, `CouponPerformanceFee`, `DealParticipationFee`, `DealPerformanceFee` | Include coupon/deal service costs                                          |
| Supported advertising, including observed `SponsoredProductFee`                                | Include once; exclude overlapping fee representations                      |
| `netProceeds`, per-unit amounts, represented parent totals                                     | Summaries/alternative representations, not additional transactions         |
| Seller-provided `cost` values                                                                  | Retain for analysis; outside this Amazon-cost payout policy                |
| Unknown monetary component or missing required amount/collection                               | Abort the entire acquisition's preprocessing before day publication        |

These labels define reviewed mappings, not universal availability. Human-readable
variants require explicit mappings. Digital-services fees map to Settlement
Order/Refund `ItemFees` with SKU. Source authority applies to the family without
requiring matching individual operations or equal amounts across windows.

For selected fees, use `totalAmount = amount - promotionAmount + taxAmount` with
the normalized economic sign exactly once. Do not also add constituents/parents
or negate credits again. [Amazon Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)

Exclusions apply across declared coverage without requiring a same-day Settlement
match. Do not subtract Settlement costs from Data Kiosk totals, switch source when
a date ages, or fill missing Data Kiosk coverage from another API. Keep each current
complete Data Kiosk day once even if selected settlements overlap it.

An explicitly classified settlement cost without an individual counterpart remains
in SelBox's reconciliation difference; do not manufacture a match or allocate its
Settlement amount because SKU is present. Incomplete required source coverage still
blocks authoritative totals. An unmapped returned monetary component aborts
preprocessing, retaining archives and prior current versions for review/rerun.

## 5. Known Amazon Data Kiosk discrepancy and SelBox's decision

The [disposal investigation](evidence/data_kiosk_disposal_discrepancy_2026-09-07.md)
found USD 260.05 in US Settlement disposal deductions versus USD 314.53 in raw
Data Kiosk responses for June–August 2026. Fresh queries reproduced the USD 54.48
difference. Its cause remains unconfirmed; see the
[accepted limitation](known_issues.md#data-kiosk-disposal-discrepancy).

SelBox accepts Data Kiosk authority for approved costs and bears the difference.
A nonzero reconciliation alone does not abort valid preprocessing, justify amount
corrections, or establish that the difference will disappear. Shared FNSKU/ASIN
manufacturer-barcode identifiers do not establish merchant-SKU uniqueness; they
cannot justify deduplicating expenses or dropping SKUs absent from Settlement cells.

## 6. Live calculation and frozen payout reports

Preprocessing retains source facts independently of ownership and fees. Combined
authoritative amounts require complete declared coverage and the same exact
processor definition, currently `v0`, across both selected sources. The
[workflow contract](data_workflows.md) owns publication, acquisition aliases,
marketplace names, source freshness, and retention.

The [live-fee contract](company_fees.md) resolves seller/SKU
ownership and required activity-date rates. Unknown ownership or required rates
remain visible and block complete totals. Approved costs need ownership but no
order-commission schedule. A Data Kiosk SKU need not appear in Settlement.
Frontend date filters do not change source authority.

Payout publication saves exact amounts and source/terms references protected
from retention, including complete empty Data Kiosk days and ownership inputs
used to exclude other companies' rows. Corrections change live reads without
rewriting saved reports. Publication is not approval or payment. Timing/cutoff,
adjustments, negative balances, currency rounding, approval, and payment
execution remain future decisions.

### Deferred refund commission risk

Current live fees apply the refund's own posting-date rate. A $100 sale at 5%
incurs $5 commission; a later full refund at 7% credits $7, returning $2 more
commission than was charged. Amazon's refund amount is unchanged. The
[tracked issue](known_issues.md#deferred-refund-commission-over-credit-risk)
remains deliberately deferred; both live reads and frozen reports preserve the
accepted formula.

## 7. Amount authority and reconciliation

Calculate separately by seller/currency with exact decimals: income/credits are
positive and expenses negative. For declared coverage, define:

| Symbol | Amount                                                            |
| ------ | ----------------------------------------------------------------- |
| `D_c`  | Company's `SETTLEMENT` source amounts                             |
| `H`    | `SELBOX` Settlement amounts                                       |
| `Q`    | `DATA_KIOSK` Settlement control amounts                           |
| `K_c`  | Selected Data Kiosk costs recognized for company c                |
| `F_c`  | Withheld fee in positive-withholding notation: `-sum(fee_amount)` |

```text
T = sum(D_c) + H + Q
E_c = D_c + K_c - F_c
V = Q - sum(K_c)
R = T - sum(E_c) = H + V + sum(F_c)
```

`T` reconciles complete Settlement content to its declared control totals. `E_c`
is new entitlement, not a bank-transfer instruction. `V` is SelBox's cost-source
variance, including any explicitly retained unallocated Data Kiosk amounts.
`R` is the settlement/entitlement residual, not automatically profit: `H` includes
balances/payment movements and `V` can include timing differences. Track deposits,
opening balances, and company payments separately.

For example, `Q = -260.05` and `sum(K_c) = -314.53` give
`V = +54.48`: companies bear USD 54.48 more cost than the compared Settlement
deductions. SelBox bears the opposite shortfall when Data Kiosk understates costs.
Do not scale company amounts to force zero variance. These equations specify
payout reconciliation; saved entitlement reports do not implement bank-transfer
or approval accounting.

## 8. Acceptance examples

The [workflow failure boundaries](data_workflows.md#failure-boundaries) and
[family rules](settlement_component_categories.md) define structural/publication
cases. These examples isolate economic source decisions:

| Situation                                                 | Required result                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Known `SETTLEMENT` family passes required fields          | Allocate Settlement once and exclude its Data Kiosk counterparts             |
| Known family fails SKU, marketplace, or accounting checks | Abort; no fallback category or source                                        |
| Unmatched Settlement family has SKU                       | Preserve SKU, default `SELBOX`, and surface review without direct allocation |
| Explicit Settlement cost family has SKU                   | Keep it as reconciliation evidence; use approved Data Kiosk cost             |
| Same SKU has a Settlement sale and Data Kiosk storage     | Include each from its authoritative source                                   |
| Data Kiosk Settlement counterpart lacks a same-day match  | Still exclude it; counterpart presence does not switch source                |
| Valid Data Kiosk disposal mismatch recurs                 | Preserve amounts and SelBox variance; no inferred deduplication              |
| Required coverage is incomplete                           | Reject authoritative totals; absence is not zero                             |
| A returned Data Kiosk monetary component is unknown       | Abort the whole preprocessing batch; retain evidence for review              |
| Settlements overlap the selected Data Kiosk date window   | Count each complete selected day once                                        |

See [known issues](known_issues.md) for unresolved source limitations and deferred
payout decisions. Live source/fee views remain mutable calculations; frozen
reports preserve entitlements but do not establish approved or paid history.
