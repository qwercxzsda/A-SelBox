# Amazon sync

Finances supplies every charge and its posting date. Monthly inventory-ledger and warehouse reports, Ads invoices, campaigns, promotions and inbound shipments supply the identifiers and amounts used to attribute those charges. Daily Inventory Planning captures separately supply the stock dashboard.

## Run a sync

Run from the repository root in the `A-SelBox` conda environment. Use the service credential file in the main checkout when running in a linked worktree.

```sh
conda run -n A-SelBox python -m services.sync.src.cli.sync_sources \
  --scope NA --manifest-directory output/source-manifests \
  --env-file /Users/mgmg/GitRepos/A-SelBox/services/sync/.env
```

Omit `--scope` to run all five accounts, or repeat it to select several. Use `--seller-namespace` for a separate seller. Python loads credentials through dotenv, preserving existing environment values. Without `--env-file` the default is `services/sync/.env` in the checkout running the command. Use `--no-load-dotenv` for a process with its own environment.

SP-API credentials are configured by region, Ads credentials by application. For local archives, the sync service reads the project API URL and storage service key from `supabase status --output json --workdir services/db`. It checks that the URL matches the requested loopback endpoint. The default is `http://127.0.0.1:54321`. For another Supabase instance, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. An explicit service key takes precedence. The database URL defaults to the local PostgreSQL port 54322. Access to these trusted sync commands and their local manifests is restricted to operators.

The run downloads Finances and checks it against Amazon’s independent summaries, then retrieves the invoices it references. It requests the storage, aged-storage, removal and ledger reports once per account for the full requested period. It then retrieves campaigns named on invoices and promotions and shipments named in Finances. Each new observation refreshes the IDs it mentions. Missing IDs are retried. One failed answer leaves its previous accepted data in place and the other answers continue. A run with failures exits with status 1.

The default Finances window begins at UTC midnight on the same day three calendar months ago (clamped to month end). For historical captures set `--posted-after` and `--posted-before` to explicit timestamps within Amazon’s available history. A capture covers up to 180 days. Removal orders are requested for the preceding twelve months through today. Storage, aged storage and the inventory ledger cover the last three finished months. The first ledger request for an account covers nineteen finished months. Choose any inclusive month range with `--report-start-month YYYY-MM-01` and `--report-end-month YYYY-MM-01`, to override these defaults. Repeat `--source` to choose individual preprocessings. For a single named source and account, repeat `--id` to refresh known invoice, campaign, promotion or shipment IDs. The ledger loads finished months only. Inventory Planning has its own command.

```sh
conda run -n A-SelBox python -m services.sync.src.cli.download_inventory \
  --scope NA --marketplace-id ATVPDKIKX0DER
conda run -n A-SelBox python -m services.sync.src.cli.preprocess_inventory \
  --acquisition-id UUID
```

## Replay a download

Keep the local manifests alongside the private `source-archives` storage bucket. Each reference download archives the source document and writes its manifest before interpreting any rows. Its manifest records the request scope, capture time and source digest. Each successful preprocessing publishes the complete answer in one transaction. Repeated and reordered report rows retain their multiplicity. An empty finished month is stored as a loaded unit. A removal report that omits a previously seen order inside its requested period fails as a whole. An older report cannot supersede a newer observation.

```sh
conda run -n A-SelBox python -m services.sync.src.cli.preprocess_reference \
  output/source-manifests/storage_fee-UUID.json
conda run -n A-SelBox python -m services.sync.src.cli.preprocess_finances \
  output/source-manifests/finances-UUID.json
```

For a standalone Finances download use `python -m services.sync.src.cli.download_finances --scope NA --manifest-output output/finances.json` in the same environment. Source preprocessing records its version on the accepted data. A changed rule can be applied to the archived answer while retaining pinned payout evidence.

## Verification

```sh
conda run -n A-SelBox python -m unittest discover -s services/sync/tests/unit -t .
```

Database integration checks are described in the [database guide](../db/supabase/README.md).
