# Source limits

The ledger sometimes lists several seller SKUs for a warehouse barcode or ASIN. Storage, removal, disposal and liquidation use every matching SKU in the applicable ledger period. A missing or disputed assignment can therefore leave the whole row with SelBox as a difference.

A warehouse report can arrive after its Finances charge. A removal order can be billed in more than one marketplace or month. Report-row tax rounding can leave small differences even with complete coverage. The Singapore storage rate and the optional Canadian warehouse rate have limited direct evidence. Unseen nonzero charges are checked against the observed marketplace and fee rules.

Historical source-shape exceptions and their handling are listed in [source matching](source_allocation.md).

## October 2026 Finances captures

The October backfill on 24 November 2026 rejected three regional captures. In Australia, Amazon reported a storage charge of −6.35 AUD with −0.65 AUD tax. In Japan, Amazon reported an aged-storage charge of −108 JPY with −12 JPY tax. Both exceed the accepted tolerance for the 10% tax rate. In Europe, a French inbound transportation charge of −46.94 EUR has no verified tax rule for its fee and marketplace.

These captures remain in the private archive. Each requires a supported tax rule or corrected source data before its complete observation can enter payout coverage.
