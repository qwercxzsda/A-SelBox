# Replacing Data Kiosk: minimal Amazon answers

Captured between 19 and 24 November 2026 with read-only calls (GET requests and report requests).
For each Amazon source that the [design](../plans/remove-data-kiosk-rules.md) reads, the folder
[`remove_data_kiosk_2026-11-24`](remove_data_kiosk_2026-11-24/) keeps the smallest real answer
that shows the fields the rules rely on.

## What was replaced

- **Every identifier is a stand-in:** SKU, FNSKU, ASIN, the seller, and the IDs of orders,
  shipments, invoices, campaigns, promotions and transactions.
- **The same real value always gets the same stand-in,** so the links between the answers are real.
- **A stand-in keeps the shape a rule depends on:** `X0` or `B0` and eight characters for an FNSKU
  or ASIN, and three, seven and seven digits for a customer order.
- **Names, titles, descriptions, addresses and tax numbers are removed.**
- **Amounts, dates, quantities and Amazon's own labels are as Amazon gave them.**

## The files

| File | Source | What it shows | Rules |
| --- | --- | --- | --- |
| [finances_transactions.json](remove_data_kiosk_2026-11-24/finances_transactions.json) | Finances `listTransactions` | eleven transactions, one for each way a cost names what it belongs to | 3, 6 |
| [ad_invoice.json](remove_data_kiosk_2026-11-24/ad_invoice.json) | Amazon Ads billing invoice | a line names its campaign; the invoice states its own tax | 9, 10 |
| [campaign.json](remove_data_kiosk_2026-11-24/campaign.json) | Amazon Ads API v1 | each ad lists a product by SKU, with the ASIN | 10, 11 |
| [promotion.json](remove_data_kiosk_2026-11-24/promotion.json) | Promotions | a coupon lists its product by ASIN only | 11 |
| [shipment.json](remove_data_kiosk_2026-11-24/shipment.json) | Fulfillment Inbound | a shipment item names SKU and FNSKU | 11 |
| [storage_report.json](remove_data_kiosk_2026-11-24/storage_report.json) | storage fee report | a row names FNSKU and ASIN, and no SKU | 7 |
| [aged_storage_report.json](remove_data_kiosk_2026-11-24/aged_storage_report.json) | aged storage fee report | the amount is before tax | 7, 9 |
| [removal_order_report.json](remove_data_kiosk_2026-11-24/removal_order_report.json) | removal order report | the fee includes tax; dates are printed with an offset | 7, 9, 14 |
| [inventory_ledger_report.json](remove_data_kiosk_2026-11-24/inventory_ledger_report.json) | inventory ledger, monthly rows | a row names FNSKU, ASIN and SKU | 8 |

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

## Not in this folder

The counts behind each rule are in section 16 of the rules, and what could not be verified is in
section 13. The original answers and the scripts that read them remain in the ignored private
output directory `output/remove-data-kiosk-plan-2026-11-19/`.
