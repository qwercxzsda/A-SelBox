# MCF Preferred Pricing credit admission

Two real Settlement rows reviewed on October 1, 2026 have the exact source triple
`Other / MCF Preferred Pricing Seller Credit / Base charge`. Each is a positive USD 1.00
credit, totaling USD 2.00, with marketplace `Non-Amazon US`, a blank SKU, and an order reference.
The rows are dated September 22 and September 29, 2026. Their original source fields remain
in the private archive; no order identifiers are reproduced here.

Amazon's [MCF pricing page](https://supplychain.amazon.com/mcf/pricing) and
[Preferred Pricing announcement](https://sellercentral.amazon.com/seller-forums/discussions/t/b7f0d409-b080-48c5-99bf-7d9a778a0673)
describe the program's FBA credit of up to USD 1 per eligible unit. This corroborates the
source label and the observed credit amounts. It does not establish a SKU allocation or
a corresponding Data Kiosk component.

The v2 source registry admits only this exact triple as `SELBOX`, without a validation family
or accounting subtype, consistent with the application's existing retained credit and fee
adjustment policy. Preserve the signed amount and source fields. Do not infer a company owner,
classify the credit as a sale or Data Kiosk cost, or accept other MCF descriptions automatically.
