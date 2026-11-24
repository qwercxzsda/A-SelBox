# Local database

The migrations provide a complete fresh-install schema for PostgreSQL with Supabase Auth and Storage. Start the local stack from the repository root.

```sh
supabase start --workdir services/db
```

The database regression suite creates disposable databases on local PostgreSQL (port 54322) and installs the migrations before each case. Run it from the repository root.

```sh
conda run -n A-SelBox python -m unittest discover -s services/db/supabase/tests
```

Finances observations and reference money are published by the Python [sync service](../../sync/README.md). Reference rows carry base, tax and their source identifiers. Global SKU terms and regional campaign, shipment and promotion assignments determine ownership. Local PostgreSQL resolves the matching rows at calculation time.

Two pg_cron jobs run in the configured cron database. One fills eligible blank assignments hourly. The payout worker processes pending company months every five minutes. Each published report saves exact totals and the source and assignment versions used to calculate them. The report detail is recalculated from those versions.

- [Financial allocation rules](../../../docs/source_allocation.md)
- [Payout reports](../../../docs/company_payout_reports.md)
- [Access model](../../../docs/access_control.md)
