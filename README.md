# A-SelBox

A-SelBox archives Amazon Finances transactions, Summary controls, and Data Kiosk documents, then
preprocesses those inputs into immutable transaction versions and Data Kiosk day versions.
PostgreSQL calculates company amounts and fees from the selected sources and SKU terms.
The scheduled worker saves immutable monthly
[payout reports](docs/company_payout_reports.md) per company, marketplace, and currency, retaining
the exact inputs used. Source and fee changes refresh eligible reports as dates mature.

Daily Inventory Planning reports use the same archive/offline preprocessing pattern and retain one
normalized capture per seller, marketplace, and day. The read-only Inventory tab shows historical
sales, stock estimates, health, and recommendations; inventory never enters financial calculations.

Downloading and preprocessing are independent operations. Downloads preserve
whole document bytes in private Supabase Storage as XZ 2e archives with CRC64 and
separate document/archive SHA-256 hashes. Preprocessing verifies those archives
without contacting Amazon. Successful archives are retained indefinitely.

Financial source facts contain original SKU evidence, exact values, and
one shared [`PREPROCESS_VERSION`](services/sync/src/preprocess_version.py). Each SKU selects an
immutable version containing its company assignment and all marketplace fee
periods. Reassignment and fee corrections restate live calculations and are picked
up by the scheduled payout worker; previously saved reports remain unchanged. Partial live
summaries identify missing fees; complete totals and payout reports require resolved configuration
and source coverage.

One named enum category selects the allocation: `FINANCES`, `SELBOX`,
`DATA_KIOSK`, or `ANALYSIS_ONLY`. Finances supplies direct company facts and
account controls; selected Data Kiosk components supply company costs.
Analysis-only components stay outside strict financial totals. Current totals include only the
`FINANCES` and `DATA_KIOSK` company categories; the administrator transaction list also retains
eligible SelBox activity. Lists and current totals use UTC periods. Original marketplace-local
dates determine fee periods and saved payout months. Finance batches
record exact observed transaction versions and reuse unchanged contents. Data Kiosk batches likewise
record reusable complete-day versions, including empty days. Both retain independent Amazon observation ordering.
Application accounts use three roles: Administrator (`administrator`), Member (`member`),
and Unassigned (`unassigned`). New signups are Unassigned until an administrator assigns a
company. Members read current own-company facts and terms; administrators also read retained
history and all payout reports. Only the DB manager can grant or revoke Administrator access.
Raw documents remain in private compressed archives. Both financial sources retain all accepted
versions and exact batch membership without a history cap. Finance acquisition metadata enters the
database with successful preprocessing; Data Kiosk retains successful download metadata separately.
Failed preprocessing uses local logs. Approval, rounding, and payment execution remain deferred.

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

The Supabase migrations define the canonical fresh-install baseline, with one current definition per
database object. See the [database guide](services/db/supabase/README.md) for local setup and
transaction, concurrency, and access checks, and the
[sync guide](services/sync/README.md) for download/preprocessing commands.

Local service configuration is stored at **`services/sync/.env`**, not at the
repository root. The service CLIs load it through `load_dotenv()`; existing process
environment variables take precedence. See the
[configuration guide](services/sync/README.md#configuration) for required variables
and `--no-load-dotenv`. Do not inspect, print, or edit `.env` directly. Keep original
reports and other private financial artifacts out of version control.

The [Company Finance frontend](services/frontend/user-webpage/README.md) reads the
current company fees, live calculations, source results, and administrator views. Administrators
can review and publish complete assignment/fee batches; members inspect their own settings.
Its Node tooling runs in Docker and connects to an explicitly configured Supabase instance.

## Design

### Responsibility boundaries

Preprocessing owns source interpretation: archive verification, parsing, normalization,
classification, and validation against the agreed source vocabularies. Unsupported inventory
health or recommendation values fail the complete preprocessing run before publication.
Known missing fields remain null; they are not unknown categories. Source parsers and models do
not depend on database repositories or browser presentation rules. Workflow orchestration calls
repositories only after source validation.

PostgreSQL stores normalized facts, provenance, and immutable versions. Constraints provide a
second integrity check. Python repositories drive source publication transactions using database
locks, unique keys, foreign keys, and deferred integrity guards. Authorization, current-version
selection, financial aggregation, and atomic payout generation remain database responsibilities.
Database objects do not repeat source-model validation or define UI priorities, colors, display
names, or catalogs of fixed source categories. Operational payout facts and sanitized failure codes
remain database values; the frontend derives readiness statuses and their visual treatment.

Python repository inputs are trusted after source-model validation. Frontend REST/RPC requests
are untrusted: public endpoints enforce authorization, payload shape, bounds, references, and
stale-write checks on the server. Frontend validation provides feedback and cannot grant access
or establish write integrity. Internal source writers are unavailable through REST.

The frontend owns constant option lists, labels, colors, urgency ordering, search, and display
pagination. Its inventory constants match the preprocessing vocabulary through contract tests;
no database query discovers possible health statuses or recommendations. Inventory loads
the complete authorized latest capture items before filtering and sorting, so priorities apply
across pages. Large financial reads still use database filtering, ordering by factual columns,
and pagination; those operations do not define presentation policy. Payout month labels derive
from saved dates in the browser. Changes to a source vocabulary require coordinated preprocessing,
constraint, and frontend catalog updates, verified by contract tests.

### Contracts

- [Data workflows](docs/data_workflows.md): archives, complete publications,
  source ordering, shared versions, immutable history, and exact values.
- [Company ownership and fees](docs/company_fees.md): versioned terms,
  calculations, partial summaries, completeness, and access.
- [Application access](docs/access_control.md): Administrator, Member, and Unassigned roles, REST
  administration, and row-level security.
- [Source allocation](docs/source_allocation.md).
- [Payout reports](docs/company_payout_reports.md): publication and saved evidence.
- [Financial review](docs/financial_review.md): marketplace/category/month comparisons, exact source records,
  and saved report diagnostics.
- [Database schema and figures](docs/database_schema.md): current tables, keys, and read views.
- [Daily inventory pipeline](docs/inventory_daily_captures.md): archived daily replenishment
  estimates, offline preprocessing, and one retained capture per day.
- [Transaction query contracts](docs/transaction_query_contracts.md): page, count,
  filter, and summary APIs.
- [Database performance](docs/database_performance.md): current read design,
  measurements, and remaining scaling limits.
- [Finances transactions](docs/finances_transactions.md): stable identities and immutable versions,
  lifecycle links, activity totals, and Summary reconciliation.
- [Transaction type registry](docs/transaction_type_registry.md): classification,
  SKU requirements, and validation boundaries.
- [Known issues](docs/known_issues.md): operational assumptions, unresolved source
  rules, upstream uncertainty, and deferred payout decisions.
- [Design decision evidence](docs/evidence/README.md): source observations and
  measurements supporting the current classification, parsing, and allocation rules.
