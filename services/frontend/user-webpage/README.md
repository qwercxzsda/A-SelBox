# A-SelBox web client

React and TypeScript client using Vite, Mantine, TanStack Router, TanStack Query, TanStack Table,
and Playwright. The browser calls Supabase Auth and REST APIs with the signed-in user's token;
database row-level security enforces access. UI copy and browser fixtures use English.

This guide covers the client, its interaction conventions, and development. The maintained business
and API contracts are [access control](../../../docs/access_control.md),
[company fees](../../../docs/company_fees.md),
[transaction queries](../../../docs/transaction_query_contracts.md),
[payout reports](../../../docs/company_payout_reports.md),
[Financial review](../../../docs/financial_review.md), and
[daily inventory](../../../docs/inventory_daily_captures.md).

## Workspace

| Tab                   | Purpose                                                | Access                                                        |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Transactions          | Current company amounts, fees, and estimated totals    | Members see their company; administrators see all companies   |
| Current fees          | SKU assignments, fee periods, and batch editing        | Members read their settings; administrators edit              |
| Inventory             | Latest daily inventory captures and recommendations    | Members see their assigned SKUs; administrators see all items |
| Finances / Data Kiosk | Retained source components and provenance              | Administrators                                                |
| Payout reports        | Latest saved reports and earlier versions              | Members see their company; administrators see all companies   |
| Financial review      | Yearly source comparisons and monthly investigation    | Administrators                                                |
| Companies             | Company creation, assignments, and restricted deletion | Administrators                                                |
| User access           | Company membership and revocation                      | Administrators; administrator roles remain DB-only            |

New accounts are Unassigned until an administrator assigns a company. They see an access-pending
screen without company data. Signup supports immediate sessions or email confirmation according to
the Auth server's settings. See [Configuration](#configuration) for callback and email requirements.

### Navigation and tables

Each workspace tab has an associated panel. Filters, raw search text, ordering, page size, selected
records, expanded sections, summary currency, and fee drafts survive tab changes and reloads within
the same account scope. Session storage belongs to this browser tab and Supabase project. Storage
failures show a warning; editing remains available in memory.

Supported read-only state also appears in the URL: tab, filters/search, ordering/page, selected
record, summary currency, Financial review scope, and exact report identity. Back/Forward restores
that state while retaining scoped drafts. URL values are validated against the current account's
permissions. Drafts, passwords, tokens, and financial amounts do not enter workspace links. Initial
sign-in preserves a report link; explicit sign-out clears workspace navigation fields.

Selections are alternatives within one filter; different filters intersect. Search is literal and
case-insensitive. Type menus group readable labels and exact source codes; Select matches and
Deselect matches affect only the visible matches. Selection filters apply immediately. Applied chips
expose the active values and support individual removal. Clearing an empty filtered result preserves
ordering and page size.

Financial and inventory paging and sorting run on the server. Current fees pages its complete loaded
configuration. Previous/Next remains available while a separate count loads; page-number entry
becomes editable when a bound is known. Enter applies a page number and Escape cancels the edit.
Changing search or filters returns to page one. Clicking a record or pressing Enter/Space opens its
details. Long lists have navigation at both ends; bottom paging returns to the list controls.

Wide tables keep horizontal scrolling and Left/Right column controls near the table start.
Transactions pins Company amount at desktop widths of at least 1100px. Long lists retain visual
column headings while scrolling; the original table provides the accessible semantics. Detail tables
preserve their scope and pagination within the drawer.

### Financial amounts and estimates

Financial values remain decimal strings with exact calculations. Displays round to two decimal
places, including yen and zero, with ties away from zero. Totals sum exact values before rounding.
Rates retain their precision. Missing values display a dash; known zero amounts remain zero.
Timestamp displays use UTC, with the original value available in the title.

Transactions' three estimated-total cards follow company, SKU, and marketplace selections:

- Latest day uses the latest transaction date in that scope.
- Latest month uses that date's month if it is the last calendar day, otherwise the previous month.
  This rule does not certify complete source coverage.
- Selected dates requires at least one date bound and allows an open start or end.

Summary currency applies to these cards and their details. Record search, Source, Type, Fee rate,
ordering, and pagination do not change the cards; record dates affect only Selected dates. A
currency stays selected when its scope becomes empty. Choose dates opens the range editor, a period
link filters Transactions, and View by type opens the amount breakdown. Selecting a type or category
narrows its record list; Show all records and Back to amounts preserve a clear return path.

Transactions, Finances, and Data Kiosk support Date or Reported amount ordering. Amount ordering is
bounded to 10,000 matching rows; larger scopes explain how to narrow the result or use date order.
The [query contract](../../../docs/transaction_query_contracts.md) defines exact request fields,
search/count semantics, ordering, fee applicability, source authority, and amount limits.

### Fee editing and company access

Administrators stage multiple SKU changes, inspect Review changes, and publish one atomic batch.
Each changed SKU needs a company and all required fee coverage. Unrelated setup gaps remain visible
without blocking a valid batch. Payout generation retains completeness checks for its full scope.
Members can inspect only their own assignments and periods.

X, Escape, and backdrop dismissal retain unfinished inputs separately from staged drafts. Resume
unfinished edit restores them; Discard edits removes the unfinished form; Keep draft stages it for
review. Drafts, open review, and reasons survive tab changes and reloads. Change rate from date
previews a period split while preserving the original end and exact rate precision. Applying that
preview changes only the editor. Publication remains an explicit Save all changes action.

Stale or uncertain writes preserve the draft and require explicit recovery. Reloads never replay a
save, and publication is not automatically retried. Confirmed saves refresh affected reads; a failed
refresh is distinguished from a failed save. Source revisions can make earlier configuration
incomplete, so coverage is rechecked without hiding the saved settings.

SKU links in Current fees, Inventory, and Companies open Transactions with that exact SKU, clear
other filters/search, and preserve ordering, page size, and drafts. Exact SKU text is shared across
source namespaces. Add SKU suggests existing authorized values by literal prefix and preserves the
spelling and whitespace of new values.

Companies lists assignments and offers View members. Add company shortcuts return to the originating
editor with its draft intact; a new company must still be explicitly selected and saved there.
Delete company requires confirmation and reports linked-record blockers. It never removes linked
records. A confirmed deletion marks affected unsaved selections unavailable until corrected.

Membership editing distinguishes saved access from an unsaved selection. Saving checks the expected
role/company atomically; revocation needs explicit confirmation. A pending operation remains tracked
across drawer and tab changes. Administrator accounts are read-only here. The
[access contract](../../../docs/access_control.md#rest-interfaces) defines creation, deletion,
membership, and publication permissions and retry rules.

## Inventory

Inventory is read-only. It displays the latest successful daily capture per seller/marketplace, with
historical sales, available/inbound stock, health, days of supply, and recommendations. Details show
secondary metrics and source dates. Missing metrics remain distinct from zero. Sales ordering
compares original currencies without conversion; selecting one marketplace avoids that ambiguity.
Health and recommendation ordering use the
[documented urgency ranks](../../../docs/inventory_daily_captures.md#dates-latest-reads-and-access).

Coverage includes successful empty captures and distinguishes missing snapshots, no authorized
items, and filters with no matches. Failed coverage reads never become a no-snapshot claim. Rows use
the stock snapshot date when available and explicitly identify a fallback report date otherwise.
Dates older than two UTC calendar days are overdue; a recent processing timestamp does not make an
old source fresh.

Only capture/SKU identity is persisted for an open item. Its values follow the freshly loaded page;
a changed or removed capture closes the drawer. Paging, filtering, and sorting clear selection.
Inventory and ownership revisions refresh affected reads. Unchanged revision checks do not reload
inventory rows or counts. Recommendations are informational, with no shipment or listing actions.

## Payout reports and Financial review

Payout reports group the latest saved company/month/currency snapshots. Month and Company filters,
visible month/year search, and on-demand Versions history support browsing. Source or fee changes
may leave the preceding snapshot visible until the automatic worker publishes its replacement. The
browser never generates reports. Selected-month readiness distinguishes incomplete setup, pending
work, completed reports, and no activity; administrators can inspect setup requirements and open the
affected SKU in Current fees.

Saved report details contain Total, Amounts by type, Marketplace breakdown, and paginated Records.
Headers retain company/month/currency context. Historical reports preserve their original values and
versions. The [payout contract](../../../docs/company_payout_reports.md) defines eligibility,
maturity, completeness, zero reports, and agreement with estimates.

Financial review shares Year, Currency, and the **Fee families** checkbox menu across Finances, Data
Kiosk, and SelBox categories. Its yearly totals, chart, monthly rows, and running difference use the
selected family union; clearing the selection restores all families. A selection with no matches
stays empty. Monthly storage, Aged storage, and Sponsored products are distinct families, with
Finances `ADVERTISING` included in Sponsored products. Other identities retain named families rather
than an uncertain catch-all. The optional yearly family breakdown and monthly comparison use
complete type aggregates and preserve signed, zero, and cancelling amounts.

The comparison-category caption clarifies that each category compares both sources. Source
availability notes distinguish missing records from zero amounts and show counts for one-source
scopes or months. Family tables rank the largest absolute differences first; yearly **Show only**
filters directly to a family. Source-only family definitions remain distinct from missing rows in
paired families, whose coverage counts overlapping months among months with that family's records.

The family menu follows the table Company/SKU controls: changes apply immediately, longer lists are
searchable, and Done or Escape returns focus to the button. Chart bars use stable family colors with
separate positive and negative stacks. Subdued matching lines show each family's running difference
alongside the stronger total line. The legend and month descriptions identify the families and
amounts. A compact legend expands without hiding plotted families. The visible **Chart values**
readout follows month hover/focus or the **Chart month** selector and can expand its family values.
It starts with one family on narrow phones and three on wider screens; expanded values remain
keyboard-scrollable. Source-only markers describe catalog membership, independently of missing rows.
Currency and magnitude labels provide scale; month controls and **Open month details** open the
selected month's details by mouse, touch, or keyboard.

Monthly totals, exact types, and source records retain the selected families. Year, Currency,
category, and family selections survive navigation and reloads. Saved snapshots retain their whole
historical report scope. Family grouping aids investigation; it does not establish matching billing
periods, coverage, or SKU allocations.

Source drilldowns retain exact row/version provenance. Finances keeps the main Search focused on
filtering its table. The secondary **Find by transaction ID…** action opens an exact Amazon ID
lookup drawer across all retained captures, independently of table filters. Its submitted ID and
page survive closing, tab changes, and reloads; source details open in a nested drawer and retain
their exact version on reload. Closing returns keyboard focus to the previous action. An unavailable
exact version is reported explicitly, without substituting a different capture. Retained components
are separate observations, not values to sum across captures. See the
[Financial review contract](../../../docs/financial_review.md) for source eligibility, comparison
scope, and saved account controls.

## Design conventions

Use the shared [Mantine theme](src/design-system.ts), [design tokens](src/design-system.css), and
[WorkspaceIntro](src/WorkspaceIntro.tsx). Semantic heading levels and accessible names must match
content structure and visible labels while retaining the intended visual size. Use sentence case,
Previous/Next, Rows, and the source name Finances consistently. Explain the scope of exclusive
amounts and exclusive fee-period end dates.

Controls expose hover and keyboard-focus feedback without shifting layout. Native `:hover` remains
available to mouse/trackpad input on touch-capable devices. Disabled controls keep their disabled
appearance. Text links use the shared accent underline. Narrow/coarse-pointer form controls use at
least 16px text to avoid automatic focus zoom; manual zoom remains available.

Drawers lock the document with CSS while mounted, including exit transitions. Drawer and popover
scroll containment is vertical only, preserving horizontal browser gestures and pinch zoom. Escape
closes the innermost panel; focus returns to its opener or a relevant surviving control.
Request/validation feedback restores lost focus without interrupting a user who moved elsewhere.

## Requests and session lifecycle

Each API request has one 30-second deadline covering headers and body. Timeouts cancel the request
and expose recovery; caller cancellation retains its reason. Unused bodies are cancelled. Reads have
one retry for transient failures. Sign-in, signup, and writes are never automatically repeated.

Transactions and source tabs load pages and exact counts independently. Query keys contain the
complete account and filter scope. Catalog refreshes finish before dependent search queries so newly
imported or reassigned SKUs participate in search. Administrator SKU catalogs can be reused only in
memory after account and source/fee revision checks; an explicit retry forces reload. Sign-out,
scope changes, and reloads never reuse that catalog.

Visible, online workspaces check `workspace_revisions` every 60 seconds and on focus/reconnection.
Unchanged revisions preserve successful cached financial and inventory reads. Relevant changes
invalidate dependent pages, counts, summaries, options, and fee lookups. Financial source tokens
also include the mature cutoff date. Payout publication/readiness revisions are independent of
source and fee revisions. Member fee/ownership and payout revisions are company-scoped. Pages and
account counts have 30-second freshness; financial/payout counts persist until a relevant revision
changes.

Offline notices distinguish cached information from a new view waiting for a connection. The last
successful application read is not Amazon capture freshness. Cached rows remain visible and paused
reads resume when connectivity returns.

A session survives reloads in the same browser tab through storage scoped to the Supabase URL.
Reload verifies Auth and account access, then reloads lookups before showing the workspace. Token
rotation is stored before dependent requests. Renewal within the same user/role/company scope
preserves drafts and the query cache; changed access discards that workspace. Temporary restore
failures offer Retry. Sign-out clears local session, view state, and cached data. Sessions are not
synchronized between browser tabs, and stored preferences never restore financial results.

Forgot password uses the same acknowledgement for registered and unregistered addresses. Callback
tokens are removed from the URL before verification. Recovery loads no company workspace, persists
only the verified flow across reloads, and clears password fields. Only Update password submits;
success returns to sign-in for fresh access checks. Invalid or expired links offer a new request.

## Frontend library boundaries

- [TanStack Router](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
  owns workspace navigation and browser history. Account-aware codecs validate search parameters;
  session storage retains private drafts and inactive-tab preferences.
- TanStack Query owns server state, request caching, cancellation, and invalidation. Authentication
  and account-scope changes control the lifetime of the workspace cache.
- [Mantine Form](https://mantine.dev/form/use-form/) owns fee editor input values and nested period
  updates. Draft persistence, exact precision, coverage, and stale-version checks remain application
  responsibilities.
- [axe for Playwright](https://playwright.dev/docs/accessibility-testing) scans representative
  authentication, workspace, filter, and dialog states. It waits for finite transitions to settle,
  uses default rules without exclusions, saves full JSON reports, and fails on violations.
  Incomplete results need review; keyboard, focus, responsive, and manual checks remain necessary.

## Configuration

Apply database migrations and configure Auth accounts using the
[database guide](../../db/supabase/README.md). Do not reset an existing database to run the client.
Browser tests intercept synthetic APIs and require no database or credentials.

Set both public values in an ignored `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key for that instance>
```

Use an API URL reachable from the browser; local ports can differ. A public `anon` JWT is also
accepted. Secret and `service_role` keys must never enter `VITE_` settings. HTTPS is required except
for local hosts. Missing configuration has no implicit fallback.

Reverse proxies must allow the Auth token, user, logout, signup, verify, and recover endpoints,
including authenticated `PUT /auth/v1/user` for password updates. Configure approved callback URLs
for the deployed origin/path and email delivery for confirmation/recovery. The local preview uses a
mail sink; successful local recovery does not establish hosted email delivery.

Cache fingerprinted `/assets/` privately with `max-age=31536000, immutable`; keep HTML, Auth, and
REST responses `no-store`. Missing assets must return 404 rather than SPA HTML, and an absent
browser icon may return 204. The deployment must serve the application at supported
navigation/callback paths.

## Docker tooling

Run every Node/package-manager command in Docker from this directory. The pinned image matches
`@playwright/test`; [playwright.config.mjs](playwright.config.mjs) selects Chromium by default.
Install the exact lockfile:

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

Replace `check` with `format:write`, `test`, `test:e2e`, or `test:a11y` for individual checks.
Accessibility scans also run in the normal browser suite. Tests start their own Vite server and
intercept `example.invalid`; use standard Docker networking for connection/reconnection cases.
Failures retain traces and screenshots in `test-results/`. Axe results include standalone JSON and
attachments there. `PLAYWRIGHT_CAPTURE_REVIEW=1` enables additional screenshots.

Start the configured application:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack -p 127.0.0.1:5173:5173 \
  -v "$PWD":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm run dev --host 0.0.0.0
```

Open `http://127.0.0.1:5173`. Browser fixtures and engine runs establish client behavior; production
data, external mail delivery, and physical-device/screen-reader behavior require separate checks.
