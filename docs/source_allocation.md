# Source matching and differences

Finances supplies the signed amounts and posting dates. Bank transfers and deferred release copies are excluded from activity. A complete period must reconcile to Amazon Summary. Amazon may post several items on one transaction, each with its own SKU, ID and amounts. Repeated items count separately.

| Source on the Finances item | Lookup for company allocation |
| --- | --- |
| Sale, refund, fulfillment fee or reimbursement | Current owner of the exact SKU |
| Liquidation proceeds, fees and tax | FNSKU in the seller’s ledger over the posting month and six preceding months |
| High-return-rate fee | ASIN in the ledger over the period Amazon states |
| Inbound fee | Shipment assignment |
| Coupon or deal fee | Promotion assignment |
| Customer-return disposal | SKUs of the same account’s sales and refunds for the customer order |
| Advertising | Invoice lines and named adjustments go to their campaign. Unnamed account adjustments go to SelBox |
| Monthly storage | Warehouse fees for the same account, marketplace and previous month |
| Aged storage | Warehouse fees for the same account, marketplace and posting month |
| Removal or disposal by removal order | Report rows with that account and order ID |

An exact SKU has one owner across accounts. Other Amazon IDs are scoped to the seller and regional account. A ledger lookup gathers every SKU in the stated months. It requires a single owner across all of them. Different owners yield split ownership. Any blank among otherwise agreeing owners yields no assignment. An empty ledger result distinguishes a missing month from a fully loaded period without the product.

Reference rows contribute amounts only after a matching Finances charge arrives. Each row retains Amazon’s precision and contributes once, including identical repeated rows. All rows for a key take the earliest charge’s date and marketplace. If Amazon charged the order in another month or marketplace, Financial review shows the balancing entries in both periods.

For each seller, regional account, marketplace, currency and posting month, company amounts before the SelBox service fee, SelBox amounts, and differences sum to signed Finances activity. The equality holds independently for base and tax. Fee promotions reduce the fee base for the charge comparison. A missing company fee rate affects that company’s payout calculation.

For posted tax at currency precision, monthly storage and aged-storage preprocessing allows two minor currency units of difference from the expected tax rounded half up to currency precision. An allowance of 0.2% of the base amount also applies against the unrounded expectation. Either allowance is sufficient. This tolerance applies consistently across marketplaces and preserves Amazon's posted base, tax and total. Tax on a zero base, a contradictory sign, and tax at a known zero rate fail the check.

Warehouse reports supply the product allocation amounts. Calculated tax is rounded once per original product row, including the combined fee in a two-tier aged-storage row. Advertising, removal, monthly storage and aged-storage charges use the same difference classification. For base and tax separately, `ROUNDING` is the currency-rounded allocation subtotal minus its exact subtotal. `TOTALS_DIFFER` is Amazon's posted amount minus that rounded subtotal. These two differences sum to the full allocation gap. A difference caused by Amazon rounding at another level can therefore appear as `TOTALS_DIFFER`. Missing reference data keeps its own reason.

## Validation and source requirements

Unrecognized fee paths, contradictory identifiers, unsupported tax rates and unsupported invoice promotions or adjustments fail preprocessing. Rejected answers remain archived for replay.

French inbound transportation and transportation program fees use a zero tax rate. Singapore aged-storage reports combine the two fee tiers on each product row before calculating 9% tax in SGD.

Warehouse allocation resolves ownership through FNSKU and the dated inventory ledger. The warehouse report’s printed SKU is retained as descriptive source data. Report and ledger availability varies by account and date.

Lightning-deal payments require a consistent item `DEAL_ID` for promotion lookup.
