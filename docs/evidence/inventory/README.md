# Real inventory pipeline and UI verification

Verified on 2026-09-29 with fresh real Inventory Planning reports requested through Amazon SP-API:
[US evidence](real_pipeline.json) and [Japan evidence](real_pipeline_japan.json). These aggregate
records contain no seller identifiers, SKUs, business values, report/document IDs, credentials, or
private document URLs.

Both new report requests completed successfully. Each complete end-to-end check fetched its report
through real `getReport` / `getReportDocument` calls, downloaded the actual document, and used the
maintained acquisition and preprocessing functions. Repeating UI verification reused each completed
report through Amazon; it preserved the original source time rather than claiming a newer observation.

## Observed results

| Check                                | US           | Japan                               |
| ------------------------------------ | ------------ | ----------------------------------- |
| Source SKU rows                      | 27           | 21                                  |
| Normalized daily captures            | 1            | 1                                   |
| Operator / company member row counts | 27 / 14 / 13 | 21 / 11 / 10                        |
| Invalid metric diagnostics           | 0            | 0                                   |
| Optional missing columns             | None         | Health status and minimum inventory |
| API/browser errors in final runs     | 0            | 0                                   |

Japan's report omitted `fba-inventory-level-health-status` and `fba-minimum-inventory-level`.
The parser produced one missing-columns diagnostic; those two metrics remained NULL in the database
and dashes in the UI. Other absent per-SKU estimates also remain unavailable, distinct from zero.

- Actual private Storage upload, archive verification, offline preprocessing, and idempotent replay
  passed. Replaying the same acquisition returned the existing capture ID.
- Every normalized field matched PostgreSQL, and every exposed item field matched the CSV REST API.
- Real Auth sign-in and Chromium reads passed for an operator and two members in each test database.
  Company assignments were synthetic and existed only in those disposable databases.
- All 22 report fields per selected sample, exact SKU/marketplace filtering, row ownership, and
  absence of shipment and manual refresh controls passed.
- Unchanged automatic checks used only the revision RPC, with zero inventory row/count requests.
- Anonymous reads were denied, member source namespaces were hidden, and financial source/payout
  tables stayed unchanged.
- Temporary stacks and browser containers were removed; existing development databases were not
  reset or migrated. No deployment or daily scheduler was installed.

## UI review and corrections

Inspected real-data desktop and narrow screenshots and checked layouts at **1440, 834, 390, and
320 pixels** for all three accounts in each market. Pages have no horizontal overflow; the wide
table scrolls within its region, remains keyboard reachable, and shows the recommendation column
when scrolled right. Long emails no longer clip the Sign out button. Measured inventory helper-text
contrast exceeds 4.5:1 against the page background.

The review removed irrelevant financial summary cards from Inventory, replaced stale relative ages
with absolute source dates, added readable status indicators, and displays known recommendation
codes as “Send to FBA” and “Restock” text. Unknown Amazon labels remain intact. Inventory has no
manual retry control even when revision checks fail, and automatically recovers on subsequent checks.

The backend review fixed a recovery issue: the accepted report ID is now retained in the correlated
acquisition log before polling, so a timeout or status-request failure can resume with `--report-id`.

Private real-data screenshots remain outside version control:

- US: `output/real-inventory-ui-review/us/final/`
- Japan: `output/real-inventory-ui-review/japan/reviewed/`

The tested scope covers US and Japan reports and current account permissions. Other marketplaces
were not live-tested. Inventory remains an Amazon observation for approximate replenishment.

## Regression checks

- Full Python sync unit suite: **311 passed**; shared offline CLI cases cover all three sources.
- Full isolated database suite: **292 passed**.
- Strict Pyright over services: **0 errors, 0 warnings**.
- Frontend unit suite: **173 passed**. The 8 Inventory browser tests passed after simplification
  and naming/pagination alignment; the shared refresh tests also passed during UI review.
- Formatting, Ruff, ESLint, TypeScript, and the production frontend build passed. SQLFluff passed the
  inventory/revision migrations during implementation.

The 2026-09-30 commit-split verification repeated the Python, database, and frontend checks and
covered all 184 browser cases. Three stale catalog revision-token expectations were corrected;
all five cases in that suite passed on rerun. The separate refactor-only commit passed 289 Python,
275 database, 167 frontend unit, and 176 browser tests, with an unchanged database catalog.

The browser cases cover exact values, unknown/zero distinction, empty/filter results, automatic
error recovery, hidden financial queries, unchanged checks, changed inventory/ownership tokens,
unknown source labels, narrow layouts, and keyboard access. The database checks cover whole-day
replacement, rollback, concurrency, idempotency, empty latest captures, ownership, and scan-free polls.

Supabase advisors previously reported zero errors and no inventory security warnings. Four existing
financial-helper warnings concern deliberate SQL inlining choices.

The current baseline has 27 dependency-ordered migrations. Cleanup compared the installed database
before and after regrouping: tables, columns, all 69 function bodies, 18 views, constraints, indexes,
triggers, RLS, and ACLs matched. The updated private seed restored successfully and its file remained
unchanged. Replaying retained US/Japan reports after parser cleanup produced identical rows and
diagnostics; the reorganized verifier also passed a real US pipeline run.

## Reproduce

From the repository root, using Amazon access in the service dotenv and Docker:

```bash
conda run --no-capture-output -n A-SelBox python -m services.db.supabase.tests.verification.inventory \
  --env-file services/sync/.env \
  --private-output output/real-inventory-review \
  --output output/real-inventory-review/new-evidence.json
```

For Japan, add `--scope JAPAN --marketplace-id A1VC38T7YXB528`. To use an already completed report,
add `--report-reference <private-getReport-response.json>`. Its ID is read in memory; the report and
document still come from Amazon. Choose a new evidence JSON path for each run.

The verifier supplies ephemeral browser credentials through standard input. It never loads
application DB/storage endpoints from the service dotenv, and never prints source rows or vendor
error bodies. Raw documents and screenshots belong in private, gitignored output directories.
