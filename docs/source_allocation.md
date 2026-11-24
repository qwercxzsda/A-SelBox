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

## Evidence and limits

The source rules describe observed Amazon responses. Unrecognized fee paths, contradictory IDs, unsupported tax rates or unseen creative settings fail that answer’s preprocessing and leave the archive available for replay. Report and ledger availability varies by account and date. The warehouse report’s printed SKU remains descriptive. Warehouse allocation follows the dated ledger.

The verified historical sample contains seven older reimbursement transactions with an unclassified monetary path and one refund with an unclassified restocking-tax path. The high-return-rate fee has a dated ASIN route. A lightning-deal payment with no verified promotion identifier remains unsupported. Two observed Singapore disposal items had zero base and tax. They establish no rate for a nonzero Singapore disposal.
