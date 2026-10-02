# Settlement component categories

An explicit source-type registry and seven settlement/account family validation rules
define the classifier. Unknown transaction/amount-type/description combinations
abort preprocessing before publication. Known retained charges explicitly use `SELBOX`;
there is no fallback category. These rules
are assumptions validated during preprocessing, not universal Amazon guarantees.
The [SKU audit](evidence/settlement_sku_completeness_2026-09-07.md) and
[classification audit](evidence/settlement_classification_audit_2026-09-08.md)
retain the source observations behind the required fields and accounting checks.

The [workflow contract](data_workflows.md) defines archive and preprocessing
validation. The [source policy](source_allocation.md) selects
company amount sources; [live SQL](company_fees.md) resolves
ownership and fees independently of preprocessing.

## Three categories and classification order

Store `SETTLEMENT`, `SELBOX`, or `DATA_KIOSK` in the required `category` field,
using Python's `AllocationCategory` and PostgreSQL's `public.allocation_category`
enum. Settlement accepts only these three categories. Data Kiosk also supports
`ANALYSIS_ONLY` for explicitly recognized diagnostic components. Unknown classifications
are rejected before publication.

| Category     | Settlement SKU contract                                                    | Company amount source                                                          |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `SETTLEMENT` | Known family; nonblank SKU, including zero amounts.                        | Settlement amounts for mature dates through exact SKU ownership.                          |
| `SELBOX`     | Known account families require blank SKU. Explicit retained types preserve any SKU. | No company allocation from this settlement row.                                |
| `DATA_KIOSK` | Explicit cost-family match; preserve any supplied SKU.                     | Data Kiosk amount in this category; Settlement reports provide controls for mature dates. |

1. Resolve the exact source triple through the shared registry, including its
   stored Type, category, family, and accounting subtype.
1. Validate the matched family. Any failure aborts the report; there is no default
   branch. Duplicate source keys are invalid.
1. If any triple is unknown, report its source lines and reject the complete report.
   Preserve the archive and prior current version for review and rerun. Explicit
   retained `SELBOX` types with `family = null` preserve raw SKU without asserting
   that the transaction is an operating expense.

A missing ordinary-order SKU still fails `SETTLEMENT`. A nonzero retrocharge still
fails `SELBOX`. Failed validation cannot change the registered category. Report parsing,
identity, currency, numeric, and control-total checks apply to all three categories.

These are observation-based assumptions, not Amazon guarantees. The workflow
uses **only Settlement Reports and Data Kiosk**. It does not infer missing SKUs
or depend on FBA reports, Finances, or another API.

## Seven explicit family rules

`T`, `A`, and `D` mean `transaction-type`, `amount-type`, and
`amount-description`. Compare after trimming surrounding whitespace while
preserving original cells. Named values are exact and case-sensitive. The table below
describes validation families; the [registry](transaction_type_registry.md) enumerates
accepted exact triples. Matching and validation are separate: missing required fields
reject a registered type rather than changing its category.

| Rule | Family and matching scope                                                                                                                                          | Category     | Checks after matching, in addition to the category SKU contract                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------- |
| F1   | **Ordinary orders/refunds:** `T` is exactly `Order` or `Refund`.                                                                                                   | `SETTLEMENT` | `A` is `ItemPrice`, `ItemFees`, `ItemWithheldTax`, or `Promotion`; registered nonblank `D`.    |
| F2   | **Liquidations:** `T` is `Liquidations` or `Liquidations Adjustments`.                                                                                             | `SETTLEMENT` | `A` is `ItemPrice` or `ItemFees`; registered nonblank `D`.                                     |
| F3   | **Inventory reimbursements:** `T = other-transaction`, `A = FBA Inventory Reimbursement`.                                                                          | `SETTLEMENT` | Registered reasons in `D`, including clawbacks/reversals.                              |
| F4   | **Fulfillment-fee corrections:** `T = AmazonFees`; `A` is `FBA fulfilment fee per unit - Correction` or `FBA fulfilment fee per unit - Reversal`.                  | `SETTLEMENT` | `D = Base fee`.                                                                         |
| F5   | **Cross-account debt:** `T = Debt Adjustment`.                                                                                                                     | `SELBOX`     | `A = Debt Adjustment`; `D` follows the cross-account pattern below.                     |
| F6   | **Account charges and movements:** `T = other-transaction`, `A = other-transaction`; `D` is a named account label or starts with the failed-transfer prefix below. | `SELBOX`     | Retain the accounting subtype; require an explanation after the failed-transfer prefix. |
| F7   | **Tax retrocharges:** `T` is exactly `Order_Retrocharge` or `Refund_Retrocharge`.                                                                                  | `SELBOX`     | Only the tax/withholding components below, in a complete, identifiable zero-net group.  |

F1 also requires a usable explicit `marketplace-name` on **every** ordinary
`Order`/`Refund` row, including fee, tax, promotion, and zero-amount rows. This is
an observed source-shape assertion independent of commission eligibility.
A blank required name aborts the complete report; it cannot be filled from
metadata or another row. It is deliberately stricter than the minimum fields
needed to attribute a noncommission order expense. Other families may keep a
null marketplace where their source rules permit it; `SETTLEMENT` alone does not
make marketplace mandatory.

For example, registered `Order / ItemFees / Digital Services Fee` and the spelling
`DigitalServicesFee` share F1. A new description within F1–F3 requires an explicit
registry entry; a known family alone does not admit it. Ordinary orders and
retrocharges remain separate types, never an `Order*` wildcard.

Mixed parents such as `AmazonFees` and `other-transaction` need the additional
matching fields above. Their other components require an explicit cost rule to enter `DATA_KIOSK`.
Other components require an explicit retained `SELBOX` entry or are rejected.

### Account and retrocharge details

Registered F5 descriptions follow this complete pattern:

```text
Cross-Account Debt Adjustment (against|for) <country-code>[, <country-code> ...]
```

Each code is two uppercase ASCII letters. Each accepted full description is registered;
a new country-list variant requires review. Preserve the direction and original text;
these codes do not establish a row marketplace or authorize currency conversion.

Registered F6 types use these labels or explicit full failed-transfer descriptions:

- `Subscription Fee`: an account operating expense.
- `Current Reserve Amount`, `Previous Reserve Amount Balance`,
  `Payable to Amazon`, and `Successful charge`: balance/payment movements.
- `Transfer of funds unsuccessful:`: a failed transfer. Each accepted full description
  is registered and must contain a nonblank explanation.

These share a category and SKU expectation, but retain their accounting subtype.
A balance or transfer is not a new sale or operating expense.

After matching F7, accept `A = ItemPrice` only with `D = Tax` or `ShippingTax`, and
`A = ItemWithheldTax` only with `D` of
`MarketplaceFacilitatorTax-Principal`, `MarketplaceFacilitatorTax-Shipping`,
`MarketplaceFacilitatorVAT-Principal`, or `MarketplaceFacilitatorVAT-Shipping`.
All components must pass the group contract below. Tax in an ordinary F1 order
remains `SETTLEMENT`; the word `Tax` alone does not determine a category.

## Explicit `DATA_KIOSK` cost rules

The implementation uses the following exact matching scopes. For `AmazonFees`,
`FBAFees`, and `ServiceFee`, register each complete `T`, `A`, and `D` triple in the
listed set. An unexpected component of a recognized family aborts rather than
defaulting. All values retain their original sign, including credits and zero.

| Family                 | T            | A                                                          | Allowed D                |
| ---------------------- | ------------ | ---------------------------------------------------------- | ------------------------ |
| Coupon                 | `AmazonFees` | `Coupon Participation Fee`, `Coupon Performance Based Fee` | `Base fee`               |
| Deal                   | `AmazonFees` | `Deal Participation Fee`, `Deal Performance Based Fee`     | `Base fee`               |
| Inbound transportation | `FBAFees`    | `FBA Amazon-Partnered Carrier Shipment Fee`                | `Base fee`               |
| Inbound placement      | `FBAFees`    | `FBA Inbound Placement Service Fee`                        | `Base fee`               |
| Storage                | `FBAFees`    | `FBA Inventory Storage Fee`                                | `Base fee`, `Tax on fee` |
| Aged storage           | `FBAFees`    | `FBA Long Term Storage Fee`                                | `Base fee`, `Tax on fee` |
| Disposal               | `FBAFees`    | `FBA Removal Order: Disposal Fee`                          | `Base fee`, `Tax on fee` |
| Removal                | `FBAFees`    | `FBA Removal Order: Return Fee`                            | `Base fee`               |
| Transportation program | `FBAFees`    | `Inbound Transportation Program Fee`                       | `Base fee`               |
| Advertising            | `ServiceFee` | `Cost of Advertising`                                      | `TransactionTotalAmount` |

For `T = other-transaction` and `A = other-transaction`, match these exact
`D` values:

| Family                 | D                                                           |
| ---------------------- | ----------------------------------------------------------- |
| Disposal               | `DisposalComplete`                                          |
| Inbound placement      | `FBA Inbound Placement Service Fee`                         |
| Inbound transportation | `FBAInboundTransportationFee`, `Inbound Transportation Fee` |
| Transportation program | `FBAInboundTransportationProgramFee`                        |
| Removal                | `RemovalComplete`                                           |
| Storage                | `Storage Fee`                                               |
| Aged storage           | `StorageRenewalBilling`                                     |

These scopes are recorded as `C3_<FAMILY>`. They are stable classification rules
independent of Data Kiosk row availability or observed country coverage.
The [country study](evidence/category3_country_evidence_2026-09-13.md) records
the observed cost signatures and their limits, including Japanese `LabelingFee`
and base/tax representations.

Do not classify generic `Fee Adjustment` as storage from its name. Reviewed EPR charges,
Vine enrollment, advertiser refunds, and inbound defect types have explicit `SELBOX`
entries. Their amount, SKU and source evidence remain available for review. Any
unregistered variant aborts preprocessing; registry coverage does not prove payout completeness.
The [EPR and adjustment investigation](evidence/data_kiosk_epr_and_adjustment_coverage_2026-09-13.md)
explains why ordinary storage observations do not establish these missing mappings.

Data Kiosk `LabelingFee` is separately approved from Japanese source evidence.
No settlement labeling spelling is invented: the settlement classifier requires
an observed, reviewed signature before adding another rule.

A Settlement report row in the Data Kiosk category may contain SKU. Preserve it without
reclassification or company allocation. The [source policy](source_allocation.md) selects Data
Kiosk amounts for companies and retains the daily difference with SelBox; no per-row match is required.

## Validation and source selection

Archive the original TSV with all its raw cells. Store typed TSV metadata and
classified facts in a successful preprocessing version, without intermediate
parsed-row tables. Validate signed amounts, currency, source identity, and
settlement control totals, then apply the family checks. The
[trailing-empty-field convention](data_workflows.md#trailing-empty-fields)
allows a missing suffix to become empty only where the row role and family
permit empty values. Use the complete header's actual order, preserve supplied
cells, and keep required-field and excess-field checks strict. The column-name
header and first metadata data row are not classified monetary entries.

Use the document and settlement ID for membership. Preserve the TSV's declared
period and each row's actual posting dates separately; out-of-period postings
produce diagnostics and remain in the report's exact reconciliation. API
descriptive metadata does not override row identity or validation, as defined in
the [metadata contract](data_workflows.md#metadata-and-transaction-rows).

Preserve zero amounts. Structural failures, conflicting rules, unknown types, and
failed family checks reject preprocessing of the complete report. No partial source
version is published; payout requests use the available accepted versions under the
[coverage policy](company_payout_reports.md#empty-aggregates).
Required explicit marketplaces remain source checks. Missing business ownership
or fee coverage does not invalidate source preprocessing; live calculations
retain those facts as unresolved and reject incomplete financial totals.

Financial source selection follows the [source policy](source_allocation.md), using the
preprocessed category and the activity date's relation to the mature cutoff date rather than
shared SKU presence. A Data Kiosk value with SKU must never be `SELBOX`;
a known account component with MSKU aborts preprocessing.
Data Kiosk `ANALYSIS_ONLY` facts retain that explicit category and remain available in
diagnostics. Unknown fee or advertising types and missing required monetary
amounts or collections abort Python preprocessing of the whole acquisition
before publication. Preserve the archive and error diagnostic for review and
rerun; prior current versions remain unchanged. Only reviewed cost rules can
assign `DATA_KIOSK`; unknown components cannot enter that category
provisionally or be excluded as analysis-only.

An explicit `DATA_KIOSK` rule does not prove that every settlement event has an
individual Data Kiosk counterpart. Its
Settlement amount remains a reconciliation control regardless of SKU presence.
Do not require a per-row Data Kiosk match to admit it. Data Kiosk
component selection is a separate step: unknown or overlapping Data Kiosk
monetary mappings fail preprocessing, and incomplete required source coverage
still blocks authoritative totals.
A missing counterpart is not the same as a failed download or incomplete parse.

### Retrocharge group contract

The `SELBOX` policy requires blank SKU and an exactly zero-net event. It adopts
zero net as an assumption to validate, not as an Amazon promise.

Use actual source identity: seller/credential account, currency, retrocharge
transaction type, order ID, available adjustment ID, and posting timestamp.
Retain report/settlement and source-line references and deduplicate repeated
copies of the same source document. Do not combine unrelated postings or
currencies simply to obtain zero. Group all tax and withholding components
belonging to the event; an absent adjustment ID is allowed only when the other
identifiers establish an unambiguous reviewed group. These identifiers alone
do not prove that all source components have been acquired.

A processing manifest must establish the required source coverage and include
the complete group. If a group crosses a report boundary or its completeness
cannot be established within the declared coverage, do not silently use the
available subset. Reject preprocessing until complete evidence or a reviewed
grouping policy is available. Require exact zero using decimal source
amounts in one currency. Nonzero, unidentified, incomplete, or unexpected groups
abort; they are neither reassigned to SKU nor absorbed as SelBox variance.

For each principal or shipping component present, require exactly one `ItemPrice`
tax row and one `ItemWithheldTax` row. The reviewed exception is one explicit zero
`ItemPrice / ShippingTax` row without a withholding counterpart; preserve that row.
Require monetary zero for each matched pair and across the complete
event. Principal and shipping imbalances must not offset one another. Multiple withholding rows fail even if their
sum offsets the tax. The [retrocharge limitation](known_issues.md#retrocharge-validation)
records the evidence required to change these checks.

### Tax and base-fee handling

The distinction is financial meaning, not the word `Tax`:

- Ordinary order/refund tax, withholding, and `TaxDiscount` belong to `SETTLEMENT`
  because their explicit SKU requirement and settlement source are part of that
  family's contract. These records still need the separately defined payout and
  tax-accounting treatment; their category is not a claim that tax is profit.
- The observed `Tax on fee` rows for storage, aged storage, and disposal belong
  to the Data Kiosk category alongside their base fees. Data Kiosk supplies company costs in this category
  using its reviewed base, promotion, tax, and total mapping. For mature dates,
  Settlement controls supply the corresponding difference. If a Data Kiosk total
  already includes tax, do not add tax twice.
- `SELBOX` retrocharge tax is retained in the complete zero-net group. Do not
  drop its positive tax or negative withholding separately.

These rules do not decide tax recoverability or assert that a Data Kiosk tax
field matches every regional settlement tax. An unreviewed base/tax coverage
relationship blocks the affected payout source mapping.

## Rule maintenance

The classifier is implemented in
[`classification.py`](../services/sync/src/settlement_preprocess/classification.py),
with explicit source signatures in
[`transaction_types`](../services/sync/src/transaction_types/)
and event checks in
[`retrocharges.py`](../services/sync/src/settlement_preprocess/retrocharges.py).
Change a rule only with reviewed source meaning, required-field expectations,
and accounting treatment. Preserve the archived input for reruns and publish
a complete new preprocessing version through the [workflow](data_workflows.md).
Do not turn a failed known-family check into an unmatched-row fallback.
