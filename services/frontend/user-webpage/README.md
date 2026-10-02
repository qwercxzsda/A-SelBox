# A-SelBox web client

React and TypeScript client using Vite, Mantine, TanStack Query, TanStack Table, and Playwright. The
browser accesses Supabase Auth and REST APIs with the signed-in user's token. It never sends SQL.
Database row-level security enforces access. UI copy and browser review fixtures use English.

## Workspace

| Tab              | API                                                                         | Access                                                                         |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Transactions     | `transaction_page`, `transaction_count`                                     | Current company assignments and fees                                           |
| Current fees     | `sku_configuration`, `publish_sku_configuration`                            | Administrators edit complete configuration; members read their own             |
| Inventory        | `latest_inventory_items`                                                    | All source inventory for administrators; current company ownership for members |
| Settlements      | `source_transaction_page`, `source_transaction_count`                       | Administrators                                                                 |
| Data Kiosk       | `source_transaction_page`, `source_transaction_count`                       | Administrators                                                                 |
| Payout reports   | `latest_company_payout_reports`, report history, maturity policy            | All companies for administrators; own company for members                      |
| Financial review | `financial_review_records`, category summary RPCs, saved report diagnostics | Administrators                                                                 |
| User access      | `app_accounts`                                                              | Administrators                                                                 |

Administrators (`operator`) browse all companies and edit complete SKU assignments/fees. Company
members (`company_member`) read their own company data. User access manages application access for
existing Auth users. Database authorization applies to every request; hiding a tab does not grant or
revoke access. See the [access guide](../../../docs/access_control.md) for the permission matrix.

Navigation stays above the active tab's content in one consistent position. Estimated totals appear
only in Transactions; the selected currency and transaction filters survive tab changes and reloads.
Desktop tables use the available width, compact summary cards, and a single toolbar row when space
allows. Each tab has its own associated panel for keyboard and assistive-technology navigation.

- Column menus filter inclusive dates, SKUs, marketplaces, sources, and types. Company, SKU, and
  other selections are alternatives within each filter; different filters intersect. Menus offer
  search when there are more than eight choices. Text search treats punctuation literally.
- Type filters start with selectable groups, including Other fees & adjustments for EPR,
  subscription, and similar entries. Expand a group for exact types, or search across group names,
  readable labels, and source codes. Search words may appear in any order; Select matches and
  Deselect matches affect only the visible matches and preserve other selections. Changes apply
  immediately. Applied chips name fully selected groups, and exact selections survive reloads.
  Groups reuse the amount breakdown's classification as a browsing aid; requests still contain the
  existing exact type keys, scoped to the current role and dataset.
- Available sort controls support one ordering at a time. Financial/inventory pagination and sorting
  run on the server; Current fees pages its complete loaded configuration. Previous/Next switch
  pages. Enter applies an inline page number when a page bound is known; Escape cancels the edit.
  Tables expand vertically and scroll horizontally when needed. Clicking a row or pressing
  Enter/Space opens its details.
- Applied filters are visible above each financial table and can be cleared individually. An empty
  filtered result offers one action to clear search and filters without changing sorting or page
  size. Wide financial tables expose Left/Right column controls above the rows, so their farthest
  columns remain reachable without scrolling to the last record. Source processing versions remain
  available in administrator row details instead of occupying primary table columns.
- Long detail tables have paging above and below the records. Paging returns to the table start;
  fitting tables keep column headers visible during drawer scrolling. Wide tables retain horizontal
  keyboard scrolling, with one vertical scroll area per drawer. Saved payout creation times are
  visible to administrators and members.
- The workspace retains the active tab, filters, search, ordering, page, selected records, summary
  currency, detail drawers, expanded sections, and fee editing state when the page reloads (F5).
  Versioned session storage belongs to this browser tab and Supabase project. Restored controls are
  validated; permissions and displayed records are fetched again. Sign-out, a new sign-in, or a
  change of user, role, or assigned company clears the workspace and its cache. If browser storage
  fails, a visible warning explains that reloading may lose edits; editing remains available in
  memory.
- Exact SKU text identifies one product across all source namespaces. SKU catalogs, filters, and
  Transactions include its records from every namespace. Administrators can inspect the source
  namespace in row details; company members never see it. Namespace is not a filter or SKU identity.
- Current fees loads one complete role-scoped configuration, including saved periods and required
  coverage. Administrators see imported-only and unassigned SKUs and can filter for setup gaps. They
  stage edits across multiple SKUs, review the changes, and publish one atomic batch. Every known
  SKU must have a company and coverage for its required fee dates before a save succeeds. Members
  see only their own assignments and fee periods, with no editing controls. Review shows a few setup
  gaps with a link to the complete paginated list; validation always covers the entire catalog.
- Configuration drafts, unfinished editor fields, open review, and change reasons survive tab
  changes and reloads. Validation errors preserve them; stale or unconfirmed writes require loading
  current saved settings before retry. Reloading during a save preserves the original optimistic
  version and marks the outcome unconfirmed; it never repeats a publication automatically. Confirmed
  saves refresh assignments, fees, and affected financial reads. Refresh failures are reported
  separately from save failures. The save controller remains mounted across tab changes and follows
  session renewal; configuration reads begin when Current fees is opened. No publication is
  automatically retried.
- Current fees exposes Edit directly beside each SKU. Clicking the SKU opens Transactions with its
  exact SKU filter and clears previous search and column filters, while preserving sorting, page
  size, and fee drafts. Fee periods expand separately. Add SKU suggests up to 20 existing authorized
  SKUs by literal, case-insensitive prefix; selecting an exact existing SKU offers Edit existing SKU
  and restores any draft. New SKU text preserves case, punctuation, and spaces.
- Fee editors use compact desktop rows and keep Add fee period, Cancel, and Keep draft visible.
  Adding a period focuses its marketplace field. Review explicitly identifies company changes, rate
  changes, and added or removed intervals alongside the proposed periods. Its reason field and save
  actions remain visible; disabled saving links directly to required setup issues.
- Source imports can make older settings incomplete. Configuration coverage refreshes on source and
  fee revisions; old incomplete settings remain visible so an administrator can repair them.
- Transactions, Data Kiosk, estimated totals, and payout reports retain zero monetary rows,
  including any service fee based on a nonzero fee base. Financial values arrive as CSV or JSON
  strings and retain their decimal precision. Missing fees display as a dash. Known zero service
  fees remain zero, including non-applicable fees; a non-applicable fee rate displays as a dash.
  Timestamp cells use readable UTC dates and times while their title preserves the exact original
  value.
- Transactions, Settlements, and Data Kiosk allow ordering by Date or Reported amount. Transactions
  includes derived reconciliation amounts; raw tabs use the stored source amount. Amount ordering is
  available only when at most 10,000 rows match every active filter and search. Larger scopes
  explain the limit and offer date ordering; an unknown or stale count is checked by the database.
  Date descending is the default. Company amount remains visible without a sort control.
  Transactions also shows Quantity. The Fee rate menu filters Applicable or Not applicable by source
  Type: Settlement product sales/refunds and Data Kiosk net product sales are applicable, including
  zero bases/rates and missing fee configuration. Selecting both or neither shows all applicability
  states. Type cells use one line within 320px: context before the final separator is smaller, and
  the final description stays prominent. The full value remains accessible in the cell title and
  details.

## Design conventions

The shared Mantine theme and [design tokens](src/design-system.css) define table typography,
surfaces, borders, spacing, controls and drawers across every role and tab. Table headers use
sentence case at 12px with medium emphasis; data uses 13px. Standard controls have 6px corners,
cards have 8px corners, and drawer titles use the same 16px heading treatment. Workspace
introductions use [WorkspaceIntro](src/WorkspaceIntro.tsx) for consistent titles and descriptions.

Views keep layouts suited to their tasks: fee editing uses SKU cards and period forms, inventory
keeps its descriptive metrics and urgency colors, and financial reports use grouped tables and
detail drawers. Transactions retain the 320px, single-line Type column with smaller context text.
Desktop density and local scrolling on smaller screens remain part of the shared conventions. Use
Previous/Next for pagination, Rows for page size, and sentence case for labels. Use **exclusive**
for amounts outside a payout or the end boundary of a fee period, with the scope explicit. Use
**Settlement** for the source/category and **Settlements** only for the source tab.

## Inventory

The read-only list shows the latest successful daily capture per seller/marketplace. Compact rows
show SKU/marketplace, trailing 90-day sales and units, available/inbound stock, health and days of
supply, and recommendations with ship-in quantities. A row click or Enter/Space opens the complete
stock breakdown, secondary metrics, recommended ship-in date, and expandable Source capture dates.
Only the capture/SKU identity is saved across reloads; the drawer uses freshly loaded current-page
values without another request. Same-capture updates refresh it; changed or removed captures close
it. Paging, filtering, and sorting clear the selection.

SKU links use the same [SkuTransactionLink](src/SkuTransactionLink.tsx) as Current fees: open
Transactions with that exact SKU, clear other filters/search, reset the page, and preserve ordering
and row count. They do not also open the inventory drawer. Returning to Inventory restores its view.

Search resolves literal, case-insensitive matches against the complete authorized latest-capture
catalog. Column menus filter SKU, health, and recommendation; Marketplace stays in the toolbar. SKU
and numeric sales sorting use source values without currency conversion. Health and recommendation
sort by
[application urgency](../../../docs/inventory_daily_captures.md#dates-latest-reads-and-access), with
unknown or absent labels last in either direction. Known aliases share a rank and readable status
badge; unknown labels remain unchanged. Search and filters apply before server pagination and
counting. Missing metrics display a dash; a reported zero remains zero.

Inventory relies on the `inventory` and ownership (`fees`) revision tokens. Unchanged checks make no
inventory row/count reads. Failed reads retry automatically; the tab has no refresh, shipment, or
listing controls. Recommendation badges describe Amazon's suggested action. Inventory dates remain
absolute, historical sales are not a forecast, and stock supports approximate daily planning. See
the [inventory contract](../../../docs/inventory_daily_captures.md) for fields, capture identity,
access, and pipeline verification.

## Payout reports and Financial review

Payout reports group the latest saved company/month/currency reports by month, across source
namespaces. Month and Company column menus filter the list; Company is administrator-only.
**Previous** and **Next** switch pages. Each report's **Versions** disclosure loads earlier
snapshots for that exact scope. History loads on demand; filters, expanded versions, and the
selected report survive reloads. Source or fee changes can leave the preceding saved report visible
until the automatic worker captures the updated inputs. The browser never generates reports.

Payout and estimate drawers share **Total**, **Amounts by type**, and **Records**. All three use
Reported amount, Service fee, and Company amount; the Total card emphasizes Company amount and the
type breakdown ends with the same totals. Selecting a category or type's record count filters the
records and focuses their heading. **Show all records** clears that selection; **Back to amounts**
returns to the breakdown. Records use 50-row pages. Zero monetary rows stay in the same calculation
and list. Marketplace breakdown is an expandable saved-report section. The
[payout contract](../../../docs/company_payout_reports.md) defines maturity, coverage, empty
reports, immutability, and when estimates match the latest saved report.

Administrator-only **Financial review** uses the same month grouping, column filters, drawers, and
pagination, with **Rows: 25 / 50 / 100**. Its Settlement, Data Kiosk, and SelBox category tabs
compare current mature source facts. Opening a month shows totals, amounts by source/type, and exact
source records. The month's expandable **Saved report snapshots** section contains historical
comparison rows and account controls. Their account scope stays separate from company payout
amounts. The [Financial review guide](../../../docs/financial_review.md) defines these scopes,
labels, read interfaces, and the distinction between source differences and the accounting
reconciliation.

## Totals

Latest day uses the latest transaction date within the selected company, SKU, and marketplace scope.
Discovery uses the shared `transaction_page` request with one date-descending row and no count; the
selected date range and source/type filters are omitted. Latest month uses that date's month if it
falls on the last calendar day, otherwise the previous month. This rule does not certify complete
import coverage. Selected dates has no total until at least one DATE bound is set; it supports
ranges with only a start or end date.

All three cards follow company, SKU, and marketplace selections. DATE applies only to Selected
dates. Source/type and fee-applicability filters, text search, ordering, and table pagination do not
affect the cards. Clicking a day or month applies its date bounds to Transactions and returns to
page one. Clicking amounts opens the shared amount breakdown with the effective dates, currency, and
filters. Related types use expandable groups in a fixed order. Its record pages use
`transaction_page` with the same date/company/SKU/marketplace scope plus the selected currency and
types. Date ordering, exact decimals, and financial authority match the main Transactions view.
Source and ownership revisions refresh both the open summary and its record pages.

Totals use Data Kiosk for all monetary categories on recent dates (the mature cutoff date and
later). For mature dates (before the mature cutoff date), Settlement reports supply the Settlement
and SelBox categories, while Data Kiosk supplies the Data Kiosk category. An administrator-only
daily marketplace difference compares the Data Kiosk category amounts reported by Settlement and
Data Kiosk. Company members see their own Settlement and Data Kiosk category amounts; SelBox retains
the SelBox category and the difference. Comparison/analysis rows are excluded and currencies stay
separate. Requests aggregate only the needed periods. Latest-date discovery, each period, and each
opened breakdown have independent cache and error states. Totals and Type breakdowns call
`transaction_totals`; compatible source facts are summed before their fee lookup. The response keeps
exact decimal strings and counts needed to identify missing company amounts.

Source menus offer Settlement and Data Kiosk; administrator Transactions also offers Reconciliation.
Marketplace menus include all 24 canonical marketplace names. Type menus use the generated
preprocessing registry: company Transactions includes every known type except category `SELBOX`
(including `ANALYSIS_ONLY`). Administrator Transactions offers every known type from both sources
and the derived Settlement / Data Kiosk difference; raw source tabs offer only registered types for
that source. Options remain available with no matching rows, and actual rows keep their existing
access and category rules. The JSON files in `src/generated/` are generated from the Python
registries; do not edit them manually.

Company-member SKU catalogs use assignments already loaded with identity. Administrator identity
preloads one complete `sku_filter_options` response, covering registered SKUs and imported
source-history SKUs under database access rules, including unassigned imports. All SKU menus use
this preloaded catalog and send no option requests when opened. Selected values stay available after
options change. No separate source-row count is requested. Generated PostgREST aggregation is
disabled; the frontend never sends aggregate expressions in REST query parameters.

## Requests and session lifecycle

Date and Reported amount ordering, including text search, use `transaction_page` for Transactions
and `source_transaction_page` for Settlements and Data Kiosk. The functions page authorized,
filtered rows using their date or reported amount; Transactions also includes derived differences
and calculates output fees for the chosen page. Date ordering reverses both dates and row IDs (and
source ties in Transactions). Amount ordering uses signed numeric values with ascending source/ID
ties in either direction; currencies are not converted. Search is a trimmed, literal,
case-insensitive substring resolved locally against complete SKU, Type, Marketplace, and (for
Transactions) Source catalogs. Raw Type and Source codes and their displayed labels both match;
Currency is excluded. The browser sends matching exact values as `p_search_skus`, `p_search_types`,
`p_search_marketplaces`, and the Transactions-only `p_search_sources`. Matching fields combine with
OR, then intersect with column filters. Blank search sends null arrays; an active search with no
catalog matches sends empty arrays and returns no rows. Page and count RPCs share the same validated
sets and include them in cache keys. Seller identifiers, processing versions, fee status, and other
metadata are excluded. Matching fields are checked before pagination. Settlements uses the same Type
column as the other transaction tabs; original source classification fields remain in row details.
Fee applicability also applies before pagination and counting; changing search or filters returns to
page one. Financial pages load before their independent exact counts: Transactions uses
`transaction_count`; Settlements and Data Kiosk use `source_transaction_count`. Other datasets
retain direct REST reads and filtered HEAD counts. Details and Previous/Next remain usable while
counting. Page-number entry becomes available when the bound is known. Failed counts have their own
retry.

Administrators reload their SKU catalog on any financial source or fee revision before dependent
search reads; members reload assigned SKUs on fee revisions. Refreshed catalogs update search keys
before queries refetch, including when a previously unmatched search gains a newly imported SKU.

Identity refreshes reuse an in-memory administrator SKU catalog only after fetching the current
account and the `settlement`, `data_kiosk`, and `fees` revision tokens and confirming they match its
existing scope and revisions. An explicit workspace retry forces catalog reload. Reuse does not
cross sign-out, account/role/company changes, or page reloads. Missing revision tokens never
authorize reuse. Company names and assignments still reload on identity refresh; members derive SKU
options from those fresh assignments.

Financial and payout counts are cached until a relevant data revision changes. Pages and account
counts have 30-second freshness. Every visible, online workspace polls `workspace_revisions` every
60 seconds; focus and reconnection also check for changes. Unchanged revisions retain successful
cached financial and inventory reads. Changes invalidate only dependent rows, options, counts,
summaries, and fee lookups. Financial source revisions cover current pointers, historical
publications, and Data Kiosk pruning; inventory revisions cover changed daily capture publications.
Payout revisions change only when a new report is published; unchanged reports keep their token.
Fee/ownership and payout revisions are company-scoped for members; source revisions are global.
Active financial summaries require the `settlement`, `data_kiosk`, and `fees` revisions. Summaries
unmount outside Transactions. Financial source tokens also include the mature cutoff date, so the
daily authority change invalidates cached money and counts. Inventory tokens have no date suffix and
checks read only the small revision table. Payout pages and counts refresh when their publication
token changes, independently of source or fee changes. Account lists and payout eligibility refresh
separately.

A session survives reloads in the same tab through `sessionStorage`, scoped to the Supabase URL.
Only tokens, expiry, and minimal identity are stored. Reload verifies the token with Auth and uses
the account returned by the revision RPC, then reloads company and SKU lookups before showing the
workspace. Token rotation is saved before dependent requests. Temporary restore failures offer
retry; sign-out immediately clears local session and workspace data and ends the current session.
Authentication is not synchronized between tabs.

Successful token renewal within the same account scope preserves the mounted workspace:

| Data                                                          | Renewal behavior                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Access token, refresh token, expiry, minimal Auth user fields | Replace with the Auth response and save before dependent reads.                                                                      |
| Application account, role/company, revision tokens            | Fetch from the database again.                                                                                                       |
| Company names and current SKU assignments                     | Fetch again.                                                                                                                         |
| Administrator SKU catalog                                     | Reuse only when the fresh account and `settlement`, `data_kiosk`, and `fees` revisions match; otherwise load the complete list once. |
| Member SKU options                                            | Rebuild from refreshed assignments.                                                                                                  |
| Selected tab, filters, sorting, pagination, expanded details  | Keep while the workspace remains mounted.                                                                                            |
| Cached pages, counts, summaries and fee details               | Keep; normal query freshness and revision invalidation still apply.                                                                  |

Tokens are not query-cache keys. A changed user, application role, or company mounts a new workspace
and discards the previous workspace's query cache. Sign-out and failed access verification also
remove the authenticated workspace; no catalog or financial result is restored from session storage.

## Configuration

Apply the project's database migrations and configure Auth accounts using the
[database guide](../../db/supabase/README.md). Do not reset an existing database to run this
frontend. Browser tests use synthetic responses and need no database or credentials.

Set both public values in an ignored `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key for that instance>
```

Use the API URL reachable from the browser; local instances may use a different port. A public
`anon` JWT is also accepted. Secret and `service_role` keys must never enter `VITE_` settings.
Production requires HTTPS; HTTP is accepted only for local hosts. Missing configuration has no
implicit fallback.

## Docker tooling

Run every Node/package-manager command in Docker, from this directory. The pinned image matches
`@playwright/test` and supplies Chromium. Install the exact lockfile:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack -v "$PWD":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  corepack pnpm install --frozen-lockfile --store-dir /app/.pnpm-store
```

Run formatting, lint, unit tests, TypeScript, a production build with public dummy settings, and
browser tests:

```sh
docker run --rm --init --ipc=host -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack -v "$PWD":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm run check
```

Replace `check` with `format:write`, `test`, or `test:e2e` for an individual task. Browser tests
start their own Vite server and intercept requests to `example.invalid`. Failures retain traces and
screenshots in `test-results/`. Set `PLAYWRIGHT_CAPTURE_REVIEW=1` in the container for additional
responsive screenshots. Use standard Docker networking so online/reconnection tests work.

Start the configured application:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack -p 127.0.0.1:5173:5173 \
  -v "$PWD":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm run dev --host 0.0.0.0
```

Open `http://127.0.0.1:5173`.
