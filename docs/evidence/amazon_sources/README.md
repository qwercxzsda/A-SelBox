# Amazon source examples

The examples were captured between 19 and 24 November 2026. Each file contains the fields used to match Finances activity to the corresponding Amazon source.

## What was replaced

- **Every identifier is a stand-in:** SKU, FNSKU, ASIN, the seller, and the IDs of orders,
  shipments, invoices, campaigns, promotions and transactions.
- **The same real value always gets the same stand-in,** so the links between the answers are real.
- **A stand-in keeps the shape a rule depends on:** `X0` or `B0` and eight characters for an FNSKU
  or ASIN, and three, seven and seven digits for a customer order.
- **Names, titles, descriptions, addresses and tax numbers are removed.**
- **Amounts, dates, quantities and Amazon's own labels are as Amazon gave them.**

## The files

| File | Source | What it shows |
| --- | --- | --- |
| [finances_transactions.json](finances_transactions.json) | Finances `listTransactions` | eleven transactions, one for each way a cost names what it belongs to |
| [ad_invoice.json](ad_invoice.json) | Amazon Ads billing invoice | a line names its campaign; the invoice states its own tax |
| [campaign.json](campaign.json) | Amazon Ads API v1 | each ad lists a product by SKU, with the ASIN |
| [promotion.json](promotion.json) | Promotions | a coupon lists its product by ASIN only |
| [shipment.json](shipment.json) | Fulfillment Inbound | a shipment item names SKU and FNSKU |
| [storage_report.json](storage_report.json) | storage fee report | a row names FNSKU and ASIN, and no SKU |
| [aged_storage_report.json](aged_storage_report.json) | aged storage fee report | the amount is before tax |
| [removal_order_report.json](removal_order_report.json) | removal order report | the fee includes tax; dates are printed with an offset |
| [inventory_ledger_report.json](inventory_ledger_report.json) | inventory ledger, monthly rows | a row names FNSKU, ASIN and SKU |

## Chains that can be followed through the files

| Chain | Finances | The other source | Ledger |
| --- | --- | --- | --- |
| Storage, Singapore, July 2026 | −0.01 SGD, posted 6 August, no ID | the whole report: one row of 0.01 SGD | the row of July names the SKU of that FNSKU |
| Aged storage, Australia, July 2026 | −0.12 AUD base and −0.01 tax, posted 19 July, no ID | the whole snapshot: one row of 0.12 AUD | the row of July names the SKU |
| Removal order, Australia, June 2026 | −0.21 AUD base and −0.02 tax, names the order | one row of 0.23 AUD, tax included | the row of June names the SKU |
| Advertising, Singapore | −3.50 SGD base and −0.35 tax, names the invoice | amount due 3.50, tax due 0.35; the line names the campaign, whose three ads list SKUs | |
| Coupon, United States | −1.53 USD, names the promotion | the promotion lists one ASIN and no SKU | |
| Inbound shipment, United States | −347.73 USD, names the shipment | one item with SKU and FNSKU | |
| Customer return, Italy | a disposal fee of −2.73 EUR names a customer order | the sale of that order names the SKU | |

Three more Finances transactions stand alone: an inbound defect fee that names its shipment, a
liquidation whose SKU field holds an FNSKU, and a returns fee that names an ASIN and a period.
