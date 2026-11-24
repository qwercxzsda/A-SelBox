# A-SelBox

A-SelBox calculates company payouts from Amazon Finances transactions. Ads invoices, warehouse reports, the inventory ledger and campaign, promotion or shipment details identify which company bears each charge. PostgreSQL resolves current ownership and applies fees using marketplace-local posting dates.

Every activity amount has one outcome. Company amounts enter payouts. Account-level charges and credits belong to SelBox. An unresolved amount appears in Financial review with its reason, currency and sign. SelBox’s service fee applies to the product price of sales and refunds.

## Development

Use the `A-SelBox` conda environment for Python and Docker for the frontend. The sync CLI loads credentials from the service environment file.

```sh
conda env create -f env.yml
conda run -n A-SelBox python -m unittest discover -s services/sync/tests/unit -t .
conda run -n A-SelBox ruff check .
```

- [Sync commands and configuration](services/sync/README.md)
- [Local database and verification](services/db/supabase/README.md)
- [Company Finance frontend](services/frontend/user-webpage/README.md)
- [Source matching and differences](docs/source_allocation.md)
- [Payout timing and saved evidence](docs/company_payout_reports.md)
- [Application access](docs/access_control.md)
- [Daily inventory captures](docs/inventory_daily_captures.md)
