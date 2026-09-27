# A-SelBox web client

React and TypeScript client using Vite, Mantine, TanStack Query, TanStack Table, and Playwright. The
browser accesses Supabase Auth and REST APIs with the signed-in user's token. It never sends SQL.
Database row-level security enforces access. UI copy and browser review fixtures use English.

## Workspace

| Tab            | API                                                   | Access                                      |
| -------------- | ----------------------------------------------------- | ------------------------------------------- |
| Transactions   | `transaction_page`, `transaction_count`               | Current company assignments and fees        |
| Current fees   | `company_skus`, `current_sku_fee_periods`             | Current company assignments and fee periods |
| Settlements    | `source_transaction_page`, `source_transaction_count` | Administrators                              |
| Data Kiosk     | `source_transaction_page`, `source_transaction_count` | Administrators                              |
| Payout reports | `company_payout_reports`                              | Administrators                              |
| User access    | `app_accounts`                                        | Administrators                              |

Company members see only their company. Administrators can select companies in Transactions. The
interface supports reading and inspection; fee editing, account administration, and publication are
not implemented. See the [access guide](../../../docs/access_control.md) for database permissions.

- Column menus filter inclusive dates, SKUs, marketplaces, sources, and types. Company, SKU, and
  other selections are alternatives within each filter; different filters intersect. Menus offer
  search when there are more than eight choices. Text search treats punctuation literally.
- Available sort controls support one ordering at a time. Pagination and sorting run on the server.
  Enter applies an inline page number; Escape cancels the edit. Tables expand vertically and scroll
  horizontally when needed. Clicking a row or pressing Enter/Space opens its details.
- Each tab retains its filters, search, ordering, page, and expanded fees during the session.
  Changing the user, role, or assigned company clears the workspace and its cache.
- Current fees groups all assignments by exact SKU, with seller identifiers hidden. Expanding a SKU
  loads all marketplace fee periods, including server-capped pages. The table appears only when
  every assignment loads successfully. Administrators see company labels where needed.
- Data Kiosk zero amounts are excluded before pagination and counting; Settlement zero rows remain.
  Financial values arrive as CSV or JSON strings and retain their decimal precision. Missing fees
  display as a dash. Non-applicable fees also display as a dash; applicable zero fees remain zero.
- Transactions, Settlements, and Data Kiosk allow ordering by Date or Reported amount, the raw
  amount stored by each source. Amount ordering is available only when at most 10,000 rows match
  every active filter and search. Larger scopes explain the limit and offer date ordering; an
  unknown or stale count is checked by the database. Date descending is the default. Company amount
  remains visible without a sort control. Transactions also shows Quantity. The Fee rate menu
  filters Applicable or Not applicable by source Type: Settlement product sales/refunds and Data
  Kiosk net product sales are applicable, including zero bases/rates and missing fee configuration.
  Selecting both or neither shows all applicability states. Type labels wrap within a maximum width
  of 20rem.

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
page one. Clicking amounts opens a Type breakdown with the effective dates, currency, and filters.
Related types use expandable groups in a fixed order.

Totals include both transaction sources, keep currencies separate, and identify missing calculated
amounts. Requests aggregate only the needed periods. Latest-date discovery, each period, and each
opened breakdown have independent cache and error states. Totals and Type breakdowns call
`transaction_totals`; compatible source facts are summed before their fee lookup. The response keeps
exact decimal strings and counts needed to identify missing company amounts.

Source menus always offer Settlement and Data Kiosk. Marketplace menus include all 24 canonical
marketplace names. Type menus use the generated preprocessing registry: company Transactions
includes every known type except category `SELBOX` (including `ANALYSIS_ONLY`). Administrator
Transactions offers every known type from both sources; administrator source tabs offer every known
type from that source. Options remain available with no matching rows, and actual rows keep their
existing access and category rules. The JSON files in `src/generated/` are generated from the Python
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
filtered source rows using their stored date or amount; Transactions calculates output fees for the
chosen page. Date ordering reverses both dates and row IDs (and source ties in Transactions). Amount
ordering uses signed numeric values with ascending source/ID ties in either direction; currencies
are not converted. Search is a trimmed, literal, case-insensitive substring resolved locally against
complete SKU, Type, Marketplace, and (for Transactions) Source catalogs. Raw Type and Source codes
and their displayed labels both match; Currency is excluded. The browser sends matching exact values
as `p_search_skus`, `p_search_types`, `p_search_marketplaces`, and the Transactions-only
`p_search_sources`. Matching fields combine with OR, then intersect with column filters. Blank
search sends null arrays; an active search with no catalog matches sends empty arrays and returns no
rows. Page and count RPCs share the same validated sets and include them in cache keys. Seller
identifiers, processing versions, fee status, and other metadata are excluded. Matching fields are
checked before pagination. Settlements uses the same Type column as the other transaction tabs;
original source classification fields remain in row details. Fee applicability also applies before
pagination and counting; changing search or filters returns to page one. Financial pages load before
their independent exact counts: Transactions uses `transaction_count`; Settlements and Data Kiosk
use `source_transaction_count`. Other datasets retain direct REST reads and filtered HEAD counts.
Details and Previous/Next remain usable while counting. Page-number entry becomes available when the
bound is known. Failed counts have their own retry.

Administrators reload their SKU catalog on any source or fee revision before dependent search reads;
members reload assigned SKUs on fee revisions. Refreshed catalogs update search keys before queries
refetch, including when a previously unmatched search gains a newly imported SKU.

Identity refreshes reuse an in-memory administrator SKU catalog only after fetching the current
account and all three revision tokens and confirming they match its existing scope and revisions. An
explicit workspace retry forces catalog reload. Reuse does not cross sign-out, account/role/company
changes, or page reloads. Missing revision tokens never authorize reuse. Company names and
assignments still reload on identity refresh; members derive SKU options from those fresh
assignments.

Financial counts are cached until a relevant data revision changes. Pages and administrative counts
have 30-second freshness. Every visible, online workspace polls `workspace_revisions` every 60
seconds; focus and reconnection also check for changes. Unchanged revisions trigger no financial
reads. Changes invalidate only dependent rows, options, counts, summaries, and fee lookups. Source
revisions cover current pointers, historical publications, and Data Kiosk pruning. They are global;
fee/ownership revisions are company-scoped for members. Active summaries require all three revisions
even when another tab is selected. Account and payout lists refresh separately because their changes
are outside those financial revisions.

A session survives reloads in the same tab through `sessionStorage`, scoped to the Supabase URL.
Only tokens, expiry, and minimal identity are stored. Reload verifies the token with Auth and uses
the account returned by the revision RPC, then reloads company and SKU lookups before showing the
workspace. Token rotation is saved before dependent requests. Temporary restore failures offer
retry; sign-out immediately clears local session and workspace data and ends the current session.
Authentication is not synchronized between tabs.

Successful token renewal within the same account scope preserves the mounted workspace:

| Data                                                          | Renewal behavior                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Access token, refresh token, expiry, minimal Auth user fields | Replace with the Auth response and save before dependent reads.                                         |
| Application account, role/company, revision tokens            | Fetch from the database again.                                                                          |
| Company names and current SKU assignments                     | Fetch again.                                                                                            |
| Administrator SKU catalog                                     | Reuse only when the fresh account and all three revisions match; otherwise load the complete list once. |
| Member SKU options                                            | Rebuild from refreshed assignments.                                                                     |
| Selected tab, filters, sorting, pagination, expanded details  | Keep while the workspace remains mounted.                                                               |
| Cached pages, counts, summaries and fee details               | Keep; normal query freshness and revision invalidation still apply.                                     |

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
