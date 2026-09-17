# Blank Settlement marketplace investigation

Verified on 2026-09-06 using live Amazon SP-API data and the installed
`python-amazon-sp-api` 2.1.20 package in the `A-SelBox` conda environment.
The observations support keeping source marketplace names separate from report
discovery filters and economic classification. The
[workflow contract](../data_workflows.md) governs
current processing: keep permitted source blanks and require explicit marketplace
names on ordinary `Order`/`Refund` rows. No external marketplace inference is
performed. Finances matching below was an investigation, not a runtime dependency.

## Findings

The 18 NA Settlement reports returned by the US-filtered discovery query contain
27,028 content rows, including 292 with a blank `marketplace-name`.

- **283 rows match Finances transactions that explicitly identify a marketplace.**
  The matches cover 241 distinct transactions, with exact amount conservation.
- **The other nine rows are opening `Payable to Amazon` balances.** They have no
  separate matching transaction at their posting timestamp. Their payment and
  carry-forward behavior is supported by the report chronology.
- **17 rows are payment or balance movements; nine are subscription expenses.**
  The other 266 concern inventory, advertising, or related operating costs.
  Missing marketplace text is therefore not a valid account-expense classifier.

These conclusions concern this NA sample. They do not establish an attribution
rule for every seller, region, or future report.

## Report scope

The US filter selects complete existing reports; it does not filter document
rows. Amazon documents that a returned report need match only one requested
marketplace. See [getReports](https://developer-docs.amazon/sp-api/reference/getreports).

A subsequent live comparison called `getReport(reportId)` for each of the same
18 reports. Every response confirmed the same report and document IDs and
returned the same nine marketplace IDs as its individual `getReports` entry.
Using the single-report endpoint therefore does not narrow the marketplace list
in this sample. The audit's listing parser read each report object's own array;
it did not combine arrays across reports or substitute the requested filter.
See [getReport](https://developer-docs.amazon/sp-api/reference/getreport).

The documents in this audit are separated as follows:

| Report currency | Reports | Content rows | Blank marketplace rows | Nonblank names in each document |
| --------------- | ------: | -----------: | ---------------------: | ------------------------------- |
| USD             |       9 |       26,941 |                    269 | Amazon.com only                 |
| CAD             |       6 |           79 |                     15 | Amazon.ca only                  |
| MXN             |       3 |            8 |                      8 | None                            |
| Total           |      18 |       27,028 |                    292 |                                 |

**No audited document mixes US and Canadian marketplace names.** The Canadian
rows came from separate CAD documents returned by the same US-filtered listing.
The presence of both names across the collection does not imply mixed names
inside any one audited document.

Currency and the sole observed name are useful context. They are not independent
proof that every unnamed fee belongs to that retail marketplace. In particular,
the three MXN documents have no named row from which to inherit a marketplace.
The regional endpoint also cannot distinguish US, Canada, Mexico, and Brazil;
they share the NA endpoint. See [SP-API endpoints](https://developer-docs.amazon.com/sp-api/lang-es_ES/docs/sp-api-endpoints).

## Evidence from other Settlement rows

Exact order, adjustment, and shipment references were compared with named rows
within the same report and across all 18 reports. References were anonymized
consistently before local analysis.

| Blank-row description         | Unique named reference match across reports | Within the same report |
| ----------------------------- | ------------------------------------------: | ---------------------: |
| REVERSAL_REIMBURSEMENT        |                                          15 |                      1 |
| FREE_REPLACEMENT_REFUND_ITEMS |                                           7 |                      0 |
| DisposalComplete              |                                           2 |                      2 |
| Total                         |                                          24 |                      3 |

All 24 lead to Amazon.com, without conflicting marketplace candidates in this
sample. All use an exact order reference. Fifteen also share an adjustment
reference, which is corroboration rather than another 15 matches. The 22
reimbursement rows additionally match SKU, but their posting dates differ from
the named order or refund rows. The two disposal rows do not contain SKUs.

Transitive reference links through other blank rows add no further matches.
The remaining 268 rows have no such named transaction reference in the fetched
Settlement window. Older records might provide additional links.

SKU alone is insufficient: 40 blank reimbursement rows use SKUs observed under
both Amazon.com and Amazon.ca. All 64 liquidation rows have SKUs, but none of
those SKUs appears on a named row in this sample. Adjacency and the majority
marketplace provide weaker evidence than an actual transaction reference.

## Evidence from Finances APIs

The investigation queried the NA Finances APIs without a marketplace filter,
then compared their records against the Settlement rows. Credentials and signed
download URLs were not printed. Source documents were processed in memory;
temporary checkpoints contain selected evidence with anonymized references.

The v0 query covered May 28 through September 2, 2026 and completed 53 pages.
It corroborates reimbursements, liquidations, inventory fees, and debt payments,
but its returned adjustment, removal-shipment, and service-fee records omit
`StoreName`. A field being available in the API schema does not guarantee that
Amazon populates it. See the [Finances v0 schema](https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/financesV0.json).

The newer **Finances 2024-06-19 `listTransactions`** query covered May 12 through
September 2, 2026. It returned 11,528 distinct transactions over 24 pages across
two adjacent date windows. Its matched records supply both marketplace IDs and
names. The request followed pagination through completion. See
[listTransactions](https://developer-docs.amazon/sp-api/reference/listtransactions)
and the [official response schema](https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/finances_2024-06-19.json).

Matching required compatible transaction category, exact UTC posting timestamp,
currency, and signed amount. Where a source SKU exists, its SKU and amount must
match within the same Finances item. Order references were checked when
available. Six liquidation events use the TSV merchant-order reference rather
than its order reference; their SKU, timestamp, and component amounts also agree.

An independent check confirmed:

- All 283 row matches have one candidate transaction under these criteria, and
  none has a missing or conflicting marketplace.
- The matches identify 268 US rows, 10 Canadian rows, and five Mexican rows.
- The source amounts assigned to each of the 241 matched transactions sum
  exactly to that transaction's total amount.
- Reuse of a transaction is explained: 32 liquidation transactions each cover
  one principal row and one fee row. Two warehouse-loss transactions cover ten
  and two source rows respectively; the item counts and SKU/amount multisets
  agree exactly.

Not every match has a native order reference. Of the 283 rows, 117 share the
native order reference, 12 use the liquidation merchant-order reference, and
154 rely on the other matching evidence. The latter include charges without
order IDs. These are corroborated investigation matches; they are not used to fill the
raw blank source cells.

## Complete category inventory and economic treatment

The following table describes the observed economic roles. The current
classification and source-selection contracts determine their application treatment.

| Blank-row category                         | Rows | Marketplace evidence                  | Economic treatment                                              |
| ------------------------------------------ | ---: | ------------------------------------- | --------------------------------------------------------------- |
| FBA inventory reimbursements and reversals |  126 | Finances: US                          | Inventory/SKU adjustments, not general account overhead         |
| Liquidation principal and brokerage fees   |   64 | Finances: US                          | Inventory recovery proceeds and related fees                    |
| Advertising charges                        |   52 | Finances: US billing marketplace      | Advertising expense; campaign/SKU allocation is a separate step |
| DisposalComplete                           |   12 | Finances: 11 US, 1 Canada             | Inventory disposal expense                                      |
| Inbound Transportation Fee                 |    6 | Finances: US                          | Inventory transportation expense                                |
| Storage Fee / StorageRenewalBilling        |    4 | Finances: 2 US, 2 Canada              | Inventory storage expense                                       |
| RemovalComplete                            |    1 | Finances: US                          | Inventory removal expense                                       |
| Fee Adjustment                             |    1 | Finances: US, FBAStorageFeeAdjustment | Storage-fee adjustment                                          |
| Subscription Fee                           |    9 | Finances: 3 each US, Canada, Mexico   | Account subscription expense                                    |
| Successful charge                          |    7 | Finances: 2 US, 3 Canada, 2 Mexico    | Debt repayment, not another operating expense                   |
| Payable to Amazon                          |    9 | Report context and balance chronology | Opening debt carried forward                                    |
| Failed bank transfer                       |    1 | Finances: Canada                      | Failed payout balance movement                                  |
| Total                                      |  292 |                                       |                                                                 |

The 126 reimbursement rows comprise 35 `REVERSAL_REIMBURSEMENT`, 32
`COMPENSATED_CLAWBACK`, 23 `WAREHOUSE_DAMAGE`, 19 `WAREHOUSE_LOST`, and 17
`FREE_REPLACEMENT_REFUND_ITEMS`. All 126 contain a SKU. Amazon's reimbursement
report provides item, reason, amount, and original-reimbursement linkage; its
schema does not itself contain a marketplace column. See
[FBA reimbursements](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-reimbursements-report).

The generic TSV `Fee Adjustment` matches a Finances
`FBAStorageFeeAdjustment` in this sample, with the same timestamp,
currency, and amount. Likewise, the long failed-bank-transfer description
corresponds to a failed-disbursement adjustment.

The two `StorageRenewalBilling` rows match `FBALongTermStorageBilling`; the two
`Storage Fee` rows match `FBAStorageBilling`. These observed categories should
not be collapsed without considering their different storage treatments.

All 32 matched service-fee transactions have empty SKU values in Finances.
Even where a storage charge contains multiple items, those items do not supply
usable SKUs. Marketplace identification therefore did not establish SKU cost allocation
in this investigation.

An expense may be billed through a seller account while still belonging in SKU
or inventory economics. Conversely, having an explicit marketplace does not
make a debt repayment revenue or an operating expense.

For advertising, distinguish the financial billing marketplace from the
marketplaces where campaigns ran. Amazon allows cross-border seller accounts as
advertising payment methods; therefore these US debit records alone do not
prove all advertising activity occurred in the US. See
[Amazon Ads cross-border payment methods](https://advertising.amazon.com/en-gb/resources/whats-new/cross-border-multiple-seller-payment-registration).

## Why the remaining nine rows are carried balances

Every `Payable to Amazon` row posts exactly at its report's start timestamp.
For seven rows, the preceding contiguous report is available: all seven amounts
equal that previous report's negative closing balance, with the same sign.
The other two occur in the earliest fetched reports, so their predecessors
cannot be checked from this sample.

Six debts are fully offset by successful charges within the same report. Five
use one charge; a USD -2,308.12 debt uses two +1,154.06 charges. The v0 debt-payment
records also associate those two charges with the original -2,308.12 debt.
The other three debts roll into subsequent negative balances and are collected
in the following report with later activity.

For example, an MXN opening debt of -54.49 plus -125.43 in new activity becomes
-179.92. The next report starts with `Payable to Amazon` -179.92 and records a
successful charge of +179.92. Treating both opening debts as new expenses would
count existing debt again.

The failed-transfer row restores CAD +15.38, exactly the prior contiguous
report's positive closing balance. Its economic role is a payout reversal.

All nine payable-containing reports have other matched Finances events pointing
to one consistent marketplace. This supports report-account context—five
Canada, three Mexico, one US—but does not turn the opening balance into a
separately identified marketplace transaction. These balance rows do not need
a SKU marketplace for profit attribution.
