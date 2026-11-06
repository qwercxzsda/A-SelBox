# Transaction type registry

The [Python registry](../services/sync/src/transaction_types/) defines the accepted
native Finances monetary paths and Data Kiosk components. It drives preprocessing
and generated frontend Type menus. Unknown monetary paths reject the complete
preprocessing publication; the archived capture remains available for investigation.
There is no fallback category based on a missing SKU or a familiar label.

## Native Finances admission

A Finances key is the exact native `transactionType` plus the ordered
`breakdownType` path within its selected item partition. For example:

| Native type and path                            | Stored component    | Category     |
| ----------------------------------------------- | ------------------- | ------------ |
| `Shipment / ProductCharges / OurPricePrincipal` | `PRODUCT_SALES`     | `FINANCES`   |
| `Refund / ProductCharges / OurPricePrincipal`   | `PRODUCT_REFUNDS`   | `FINANCES`   |
| `Shipment / AmazonFees / Commission / Base`     | `REFERRAL_FEES`     | `FINANCES`   |
| `ProductAdsPayment / Base`                      | `ADVERTISING`       | `DATA_KIOSK` |
| `SellerDealPayment / AmazonFees / RunLightningDealFee / Base` | `DEAL_FEES` | `DATA_KIOSK` |
| `ServiceFee / AmazonFees / Subscription / Base` | `SUBSCRIPTION_FEES` | `SELBOX`     |
| `DebtRecovery / DebtPayment`                    | `DEBT_RECOVERY`     | `SELBOX`     |

The complete accepted paths are in
[finances.py](../services/sync/src/transaction_types/finances.py). A registered leaf
under one wrapper does not authorize a different wrapper or transaction type.
Semantic Type names remain stable across the explicitly reviewed native paths.
The registry is an application contract, not a claim that Amazon's vocabulary is closed.

Native `SellerDealPayment` lightning-deal base charges are cost controls in the same
`DEAL_FEES` family as the reviewed service-fee deal paths. They do not create a product
commission or invent SKU attribution. The exact 2024 path is supported by retained native
captures; Amazon also identifies `RunLightningDealFee` as a deal-payment fee in its
[Finances event model](https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/financesV0.json).
Other wrappers and unobserved leaves remain unsupported.

## Component categories

| Category     | Accepted purpose                                                                                                   | SKU treatment                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `FINANCES`   | Product/shipping amounts, taxes, rebates, transaction fees, reimbursements, liquidations and reviewed corrections. | Requires a native product SKU for allocation.                            |
| `DATA_KIOSK` | Advertising, storage, disposal, removal, inbound placement/transportation, labeling, coupon and deal controls.     | Preserve any native SKU; company allocation still comes from Data Kiosk. |
| `SELBOX`     | Reviewed account charges, adjustments, debt/reserve movements and tax reclassification.                            | Preserve native SKU without assigning these amounts to a company.        |

`accounting_subtype` distinguishes `OPERATING_EXPENSE`, `BALANCE_MOVEMENT` and
`TAX_RECLASSIFICATION` where the explicit mapping supplies one. These labels do
not decide lifecycle inclusion. A bank transfer is retained as a native record
and its reviewed component, but excluded from activity totals. Debt recovery
and cross-account adjustments remain included when they are ordinary activity.

Finances `items` and top-level breakdowns describe alternative partitions.
Preprocessing selects the item partition when present, recursively validates
child sums, and sums each terminal monetary component once. Every item must
match its amount; items must match the native transaction total. Nonzero amounts
without monetary detail fail rather than receiving invented balancing components.
Reviewed zero items remain explicit, including the evidenced missing-currency
zero-item representation whose currency comes from the native parent.

Only `PRODUCT_SALES` and `PRODUCT_REFUNDS` carry a signed `fee_base`. Other
components have no sales commission. Python stores this decision explicitly;
SQL uses the stored base directly.

Native IDs, account type, status, links, page/record ordinals, item position and
breakdown path preserve provenance. Components have deterministic keys that retain
legitimate repeated amounts. Source position is not a financial identity.

## Shared menus

Generate catalogs from the repository root:

```sh
conda run -n A-SelBox python -m services.sync.src.transaction_types.generate
conda run -n A-SelBox python -m services.sync.src.transaction_types.generate --check
```

Do not edit generated JSON or maintain another source Type registry. Marketplace choices and
`marketplace-timezones.json` come from the canonical retail and native-channel definitions.
Inventory ages use the same calendar boundaries as source capture. The
[Finances contract](finances_transactions.md#acquisition-scope-and-archives) defines native-channel identities and
control grouping; grouping does not rename stored marketplaces.

Company menus omit SelBox account types. Transaction menus contain only registered
source types; raw source menus restrict them to their source. Static options can legitimately match zero rows. Search resolves
catalog labels and exact keys, while database permissions authorize each result.

## Adding a type

1. Inspect retained native evidence and determine its exact path and economic role.
1. Add an explicit registry entry and a test for complete amount partitioning,
   source identity and category treatment. Add no catch-all entry.
1. Regenerate catalogs and run Python, database and frontend checks.
1. Reprocess the retained capture with the current shared preprocessing definition.

Refer to [source allocation](source_allocation.md) for authority and
[Finances transactions](finances_transactions.md) for successful observations and immutable transaction versions,
release exclusion and Amazon Summary reconciliation.
