# Settlement SKU completeness evidence: 2026-09-07

This historical audit supports the implemented
[seven-family classification policy](../settlement_component_categories.md).
The audit records source SKU presence, separately from the current named
allocation categories. Failed known-family checks abort the whole report.
The observations below are evidence, not an Amazon guarantee or another rule set.

The [September 8 audit](settlement_classification_audit_2026-09-08.md) extends the
sample to 116 strictly parsed reports and 174,249 rows. Its strict counts remain
distinct from the later [trailing-column evidence](settlement_trailing_columns_investigation_2026-09-11.md).
The [source policy](../source_allocation.md) governs which amounts
come from Settlement and Data Kiosk; ownership and fees are calculated live.

## Observed SKU-bearing families

These observed families support the current required-SKU checks. They do not
establish that every future component under the same broad transaction label
has identical semantics. The complete 48 observed SKU-bearing combinations are preserved in
the [aggregate evidence snapshot](settlement_sku_completeness_2026-09-07.json).

| Observed population                                          | Content rows across audited regions | Missing SKU |
| ------------------------------------------------------------ | ----------------------------------: | ----------: |
| Ordinary `Order` components                                  |                             146,305 |           0 |
| Ordinary `Refund` components                                 |                               3,212 |           0 |
| `other-transaction / FBA Inventory Reimbursement` components |                                 329 |           0 |
| `Liquidations` components                                    |                                  86 |           0 |
| `Liquidations Adjustments` components                        |                                   6 |           0 |
| `AmazonFees` fulfillment-fee corrections/reversals           |                                   8 |           0 |
| **Total observed SKU-bearing rows**                          |                         **149,946** |       **0** |

Ordinary `Order` and `Refund` include their observed principal, shipping, fee,
promotion, and tax components. They explicitly exclude `Order_Retrocharge` and
`Refund_Retrocharge`. Counts are monetary content rows, not distinct orders,
customers, items, or units.

The eight European correction/reversal rows are:

- `AmazonFees / FBA fulfilment fee per unit - Correction / Base fee`: four rows;
- `AmazonFees / FBA fulfilment fee per unit - Reversal / Base fee`: four rows.

All eight contain SKU, while other `AmazonFees` components do not. Therefore,
`AmazonFees` alone is insufficient to decide the SKU requirement. The same
principle applies to `other-transaction`, which contains both SKU reimbursements
and entries without SKU.

Far East adds SKU-bearing order components for `LowValueGoodsTax-Principal`,
`LowValueGoodsTax-Shipping`, and promotion `TaxDiscount`. The evidence retains
spelling variants such as `Digital Services Fee` and `DigitalServicesFee` as
separate observed combinations. Both use the same ordinary order/refund family
rule; their different spellings do not require separate SKU-presence policies.

### Components without SKU

The 59 consistently blank combinations are not automatically account expenses.
They include aggregate fees, tax adjustments, account expenses, and payment or
balance movements. Economic classification and source selection are still
required. Absence of SKU does not identify which company owes an expense.
Of these blank combinations, 32 match account or retrocharge families F5–F7
(209 rows), and 27 fall outside F1–F7 (654 rows). The current explicit cost
registry decides which of the latter use `DATA_KIOSK`; other rows use `SELBOX`.
The two EPR descriptions and generic `Fee Adjustment` remain outside that
registry because their Data Kiosk coverage is unverified. These are observation
counts, not a separate classification contract.

For example, Far East contains separate `Tax on fee` rows for storage,
aged-storage, and disposal. If an auxiliary source supplies the company cost,
the category policy must account for its tax as well as its base fee without
counting either twice. This audit establishes SKU presence, not the correct
tax or payout treatment.

### Retrocharges

| Scope and type          | Rows without SKU | Order groups checked | Groups with zero signed net |
| ----------------------- | ---------------: | -------------------: | --------------------------: |
| NA `Order_Retrocharge`  |                9 |                    3 |                           3 |
| EU `Order_Retrocharge`  |                8 |                    2 |                           2 |
| EU `Refund_Retrocharge` |                3 |                    1 |                           1 |

All 20 rows have an order ID and no SKU or order-item code. Their tax and
withheld-tax components offset within the six observed groups. Thus, these
particular complete groups have no net settlement amount to distribute when
their components receive consistent treatment.

The current [retrocharge group contract](../settlement_component_categories.md#retrocharge-group-contract)
preserves these as `SELBOX` tax-reclassification entries and validates each
complete same-currency group as zero-net. Do not assume that
every future retrocharge is zero, classify all order-related rows as ordinary
orders, or discard tax components merely because their SKU is blank. A nonzero,
incomplete, or unidentified group aborts preprocessing. The preprocessor also
requires reviewed complete source-line coverage: these observed zero totals alone
cannot prove event identity or completeness.

## Audit coverage and findings

The 2026-09-07 investigation combined the previously acquired North American
cache with fresh European and Far East acquisition through the implemented
Sellers/Reports functions. EU and FE queries selected `DONE` Settlement V2
reports by creation time over June 9 to September 7, 2026. Exact request
timestamps are in the evidence snapshot. This is not a statement that every
content row was posted within those dates; settlement periods can start earlier.

| Scope         | Report documents/records examined | Records after duplicate removal | Content rows counted | SKU present | SKU blank |
| ------------- | --------------------------------: | ------------------------------: | -------------------: | ----------: | --------: |
| North America |                                18 |                              18 |               27,028 |      26,824 |       204 |
| Europe        |                                66 |                              66 |              118,479 |     117,882 |       597 |
| Australia     |                                 8 |                               7 |                5,284 |       5,229 |        55 |
| Singapore     |                                 2 |                               2 |                   18 |          11 |         7 |
| Japan         |                                 0 |                               0 |                    0 |           0 |         0 |
| **Total**     |                            **94** |                          **93** |          **150,809** | **149,946** |   **863** |

The North American records have distinct retained normalized contents; their
original raw bytes and settlement header IDs were not retained for an
independent settlement-identity check. EU/FE distinctness was checked using the
actual TSV settlement ID and decoded document bytes. No European duplicates or
same-settlement/different-body conflicts were found. Australia had one exact
duplicate: eight downloaded documents contained seven distinct settlements.
Counting every Australian document would give 5,994 rows rather than 5,284.
This is document-level duplicate evidence. Equal SKU, amount, date, or even
identical-looking rows within a report do not by themselves prove duplicate
postings and must not be removed on that basis.

All 76 newly listed EU/FE documents were ultimately downloaded and structurally
parsed. Two initial European download failures succeeded on targeted retry.
No failures or quarantined identity anomalies remained in that acquisition.
Listings exhausted all chunks/pages for the active canonical marketplace IDs
in the configured scopes. Europe requested 12 active marketplaces; content
contained ten marketplace names: UK, Belgium, Germany, Spain, France, Ireland,
Italy, Netherlands, Poland, and Sweden. Blank marketplace names were retained
in the audit rather than used to exclude rows.

| Scope                        | Ordinary `Order` rows | Ordinary `Refund` rows | Missing SKU in either |
| ---------------------------- | --------------------: | ---------------------: | --------------------: |
| North America                |                25,647 |                    987 |                     0 |
| Europe                       |               115,470 |                  2,181 |                     0 |
| Australia, duplicate removed |                 5,177 |                     44 |                     0 |
| Singapore                    |                    11 |                      0 |                     0 |
| Japan                        |               No data |                No data |        Not assessable |

Across the combined population, all **107 exact component combinations** were
uniform: **48 always had SKU and 59 always lacked it**. None mixed populated
and blank SKUs, either within a region or after combining regions. No
combination that always had SKU in NA appeared without SKU in EU or FE.

This supports the observation-based validation rule. It does not turn the observed
presence flag into an approved financial taxonomy or payout-source map.

### Method and limits

- Acquisition used `fetch_marketplace_participations`,
  `discover_settlement_reports`, `download_report_document`,
  `decompress_report_document`, and `parse_settlement_report`. The exact raw
  TSV content was inspected before later business preprocessing validation.
- The TSV column-name row and first metadata row were excluded. Every parsed
  content row was included, including zero amounts. The audit checked source SKU presence independently
  of company ownership and fee configuration.
- SKU presence means a nonblank `sku` cell after trimming whitespace. Component
  comparisons trim surrounding whitespace but retain the original spelling.
  Presence does not verify the correctness of the SKU or its company mapping.
- Japan returned no reports despite completed discovery. This is no Japanese
  content evidence, not a passing Japanese completeness test. Singapore's
  18-row sample includes only 11 order rows and no refunds.
- A missing entire order, report, or charge cannot be detected by checking the
  SKU cells of returned rows. Acquisition completeness, settlement control
  totals, and duplicate-recognition checks remain separate requirements.
- The public [Settlement V2 specification](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement)
  lists `sku` and explains the amount-type/description fields, but does not
  state a category-specific mandatory-SKU guarantee. The acceptance rule must
  remain capable of rejecting new output that violates it.
- The repository evidence file contains aggregate counts and component labels,
  not credentials, seller/report/order identifiers, SKU values, or raw TSVs.
  It preserves the audit findings after temporary files disappear. Reproducing
  the source audit still requires authorized source documents or fresh API
  acquisition; these aggregate counts alone cannot independently prove the
  source data's correctness.
