# A-SelBox

A-SelBox archives Amazon Settlement Reports and Data Kiosk documents, preprocesses
those saved inputs into complete source versions, and calculates company amounts
and fees through live PostgreSQL views. Immutable payout reports save exact
amounts and retain the source and fee versions used.

Downloading and preprocessing are independent operations. Downloads preserve
whole document bytes in private Supabase Storage as XZ 2e archives with CRC64 and
separate document/archive SHA-256 hashes. Preprocessing verifies those archives
without contacting Amazon. Successful archives are retained indefinitely.

Source facts contain original seller/SKU evidence, exact financial values, and
one shared `PREPROCESS_VERSION`, currently `v0`. Each seller/SKU selects an
immutable version containing its company assignment and all marketplace fee
periods. Reassignment and fee corrections restate live calculations without
reprocessing sources or changing saved reports. Partial live summaries identify
missing fees; complete totals and payout reports require resolved configuration
and source coverage.

One named enum category selects the allocation: `SETTLEMENT`, `SELBOX`,
`DATA_KIOSK`, or `ANALYSIS_ONLY`. Settlement supplies direct company facts and
account controls; selected Data Kiosk components supply company costs.
Analysis-only components remain available outside financial totals. Complete day
versions include empty days and retain independent Amazon observation ordering.
Application accounts distinguish operators from company members. Members read
current own-company facts and terms; operators also read retained history and all
payout reports. Raw documents remain private. Data Kiosk retention preserves
current versions, the latest three Amazon observations, and all payout
dependencies. Approval, rounding, and payment execution remain deferred.

## Development

Use the `A-SelBox` conda environment for every Python command:

```sh
conda env create -f env.yml
conda run -n A-SelBox python -m unittest discover -s services/sync/tests/unit -t .
conda run -n A-SelBox ruff format --check .
conda run -n A-SelBox ruff check .
```

For strict type checks, select the conda interpreter explicitly as shown in the
[sync verification guide](services/sync/README.md#verification).

The Supabase migrations define a fresh-install baseline; they do not provide an
upgrade or backfill path for an existing schema.
See the [database guide](services/db/supabase/README.md) for local setup and
transaction, concurrency, and access checks, and the
[sync guide](services/sync/README.md) for download/preprocessing commands.

Local service configuration is stored at **`services/sync/.env`**, not at the
repository root. The service CLIs load it through `load_dotenv()`; existing process
environment variables take precedence. See the
[configuration guide](services/sync/README.md#configuration) for required variables
and `--no-load-dotenv`. Do not inspect, print, or edit `.env` directly. Keep original
reports and other private financial artifacts out of version control.

## Design

- [Data workflows](docs/data_workflows.md): archives, complete publications,
  source ordering, shared versions, retention, and exact values.
- [Company ownership and fees](docs/company_fees.md): versioned terms,
  calculations, partial summaries, completeness, and access.
- [Application access](docs/access_control.md): operator/member roles, REST
  administration, and row-level security.
- [Source allocation](docs/source_allocation.md).
- [Payout reports](docs/company_payout_reports.md): publication and saved evidence.
- [Database schema diagrams](docs/database_schema.md).
- [Settlement family rules](docs/settlement_component_categories.md): classification,
  SKU requirements, and validation boundaries.
- [Known issues](docs/known_issues.md): operational assumptions, unresolved source
  rules, upstream uncertainty, and deferred payout decisions.
- [Design decision evidence](docs/evidence/README.md): source observations and
  measurements supporting the current classification, parsing, and allocation rules.
