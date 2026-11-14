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
| Transactions          | Current company amounts, fees, and current totals      | Members see their company; administrators see all companies   |
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
records, expanded sections, and fee drafts survive tab changes and reloads within the same account
scope. Session storage belongs to this browser tab and Supabase project. Storage failures show a
warning; editing remains available in memory.

Supported read-only state also appears in the URL: tab, filters/search, ordering/page, selected
record, Financial review scope, and exact report identity. Back/Forward restores that state while
retaining scoped drafts. URL values are validated against the current account's permissions. Drafts,
passwords, tokens, and financial amounts do not enter workspace links. Initial sign-in preserves a
report link; explicit sign-out clears workspace navigation fields.

Selections are alternatives within one filter; different filters intersect. Table and option
searches are literal and case-insensitive. Search fields use one visible Search label and a
placeholder naming the searchable values, with no explanatory subtitle. Context-specific accessible
names distinguish fields for assistive technology. Type menus and current-total or saved-report
Amounts by type use the eight broad groups from the
[shared taxonomy](../../../docs/transaction_type_registry.md#shared-type-hierarchy); Financial
review uses its detailed families. Type menus show readable exact types; Select matches and Deselect
matches affect only visible matches. Selection filters apply immediately. Applied chips expose the
active values and support individual removal. Clearing an empty filtered result preserves ordering
and page size.

List-based tabs share [ListToolbar](src/ListToolbar.tsx) for Search, Rows, pagination, spacing, and
visible-range summaries such as `1–25 of 159 inventory items`. Contextual actions use its
extra-controls area. Inactive status messages do not reserve a blank line above the toolbar.

Type cells use a compact column, with the readable type first and its broad group beneath in
smaller, muted text. The original type code remains available on hover. SKU values use the same
medium weight as date and type labels; Company amount values use bold text. Transactions combines
Reported amount with a smaller, labeled Quantity below it, and Service fee with Fee rate below it.
The Service fee heading retains applicability filtering; Reported amount retains amount ordering.
Raw-source tables and record details keep their separate fields.

Financial paging and factual sorting run on the server. Inventory filters, sorts, and pages its
complete loaded snapshot in the browser; Current fees pages its loaded configuration. Previous/Next
remains available while a separate financial count loads; page-number entry becomes editable when a
bound is known. Enter applies a page number and Escape cancels the edit. Changing search or filters
returns to page one. Clicking a record or pressing Enter/Space opens its details. Long lists have
navigation at both ends; bottom paging returns to the list controls.

Wide tables keep horizontal scrolling and Left/Right column controls near the table start.
Transactions pins Company amount at desktop widths of at least 1100px. Long lists retain visual
column headings while scrolling; the original table provides the accessible semantics. Detail tables
preserve their scope and pagination within the drawer.

### Financial amounts and current totals

Financial values remain decimal strings with exact calculations. Displays round to two decimal
places, including yen and zero, with ties away from zero. Totals sum exact values before rounding.
Rates retain their precision. Missing values display a dash; known zero amounts remain zero.
Timestamp displays use UTC, with the original value available in the title. Transactions, Finances,
and Data Kiosk lists label the compact column Date (UTC) and omit the repeated UTC suffix from each
row. Dates appear on the first line with the time beneath in smaller, muted text. Data Kiosk's
assumed marketplace day-end explanation is available on the time's tooltip and accessible
description.

Transactions' current totals follow every selected filter and literal search. Three cards show Last
day, Last month, and Selected dates together. Each card contains a compact list of the selected
marketplaces and their currencies, with Reported amount, Service fee, and Company amount. The cards
grow vertically with the selected marketplaces; they have no fixed-height list or internal vertical
scrolling. They appear side by side on wide screens, with matching marketplace rows aligned across
all three cards even when currency counts differ, and stack on narrower screens.

Current totals, type breakdowns, and their record lists sum the same eligible transactions as the
main list. This includes administrator-visible `SELBOX` entries; their company amounts and service
fees remain zero under the allocation rules. Company rows retain exact amounts and partial sums when
ownership or fee configuration is missing.

An empty Marketplace filter means all marketplaces in that filter's catalog. An explicit selection
lists exactly those marketplaces, including markets with no matching transactions. Empty markets
remain visible without fabricated zero amounts.

All three cards use one marketplace order: transaction presence in Selected dates first, then Last
month, then Last day, with alphabetical order breaking ties. Presence means at least one
contributing record in any currency, including zero-amount records; neither amount size nor record
count affects the order. Markets with no transactions in any of the three periods appear at the
bottom.

- Last day uses the UTC calendar day before the latest transaction date accessible to the signed-in
  account, including eligible SelBox activity when finding that anchor. UI filters do not change the
  anchor; all other filters and search change only the amounts. Every marketplace uses that same
  previous day, even when it has no transactions.
- Last month always uses the calendar month before the latest transaction's UTC month, including
  when the latest transaction is on the last day of a month. This rule does not certify complete
  source coverage.
- Selected dates uses the same UTC date range as the transaction list. It requires at least one date
  bound and allows an open start or end.

Search, Company, SKU, Marketplace, Source, Type, and Fee rate apply to all totals and their type
breakdowns and record lists. The date filter affects only Selected dates; Last day and Last month
use their own periods. Ordering and pagination do not change totals. Amounts are never combined
across marketplaces or currencies. Each card has one date control at the upper right combining its
period and UTC label. Last day and Last month use a filter icon to apply that period to the list.
Selected dates uses a calendar icon to open the picker; ranges omit repeated month/year text, and an
empty range shows Choose dates. Selecting a company amount opens its breakdown for that marketplace,
currency, and UTC period. Every summary and record list uses the same timestamp and date boundaries.
Selecting a type or broad group narrows its record list; Show all records and Back to amounts
preserve a clear return path.

Transactions, Finances, and Data Kiosk use UTC timestamps for display, date filtering, and ordering.
Finances retains the actual posting instant. A Data Kiosk daily component is booked at the last
microsecond before the next midnight in its marketplace's time zone, then displayed in UTC. This is
an explicit end-of-day convention because Data Kiosk provides daily aggregates rather than activity
timestamps. Original marketplace dates continue to determine fees and payout periods.

Transactions, Finances, and Data Kiosk support Date or Reported amount ordering. Amount ordering is
bounded to 10,000 matching rows; larger scopes explain how to narrow the result or use date order.
The [query contract](../../../docs/transaction_query_contracts.md) defines exact request fields,
search/count semantics, ordering, fee applicability, source authority, and amount limits.

### Fee editing and company access

Current fees and Companies use [RecordTable](src/RecordTable.tsx), with the shared table headings,
cell spacing, borders, and horizontal-scroll controls. Clicking a row or pressing Enter/Space opens
its details in a right-hand drawer. Selecting text does not open details. The selected record
survives tab changes and reloads, and closing the drawer returns to the list without changing its
position. Both lists reserve their columns for record information.

Current fees groups rows by SKU, like the month groups in Payout reports. Marketplace fee periods
are folded by default; the disclosure shows or hides each period as a separate row with its
marketplace, rate, and effective dates. The SKU, company, and status belong to the whole group. The
Fee periods column contains the period count with its Show/Hide control beneath; the Marketplace
column contains the marketplace summary while folded and each period's marketplace while expanded.
SKU headings reuse the Payout reports group typography and spacing. Selecting its summary or any
period opens the same SKU details and highlights every row in that group. Folding is independent of
selection, and counts and pagination remain based on SKUs. Folding choices survive navigation and
reloads. Current fees and Payout reports use the shared [TableDisclosure](src/TableDisclosure.tsx)
for their Show/Hide controls, including the same chevron, spacing, hover/focus feedback, and
reduced-motion behavior.

Fee details use one Marketplace fee periods section for the current schedule and saved history. Each
published version includes its assignment, save time, reason, and complete period table, newest
first, with ten saved versions per page. History loads only after opening details for an
administrator. A staged draft appears as a separately labelled schedule, keeping proposed values
distinct from published versions. Historical versions remain read-only, and Edit always starts from
the current configuration or the existing draft. Additional details follows the complete section and
its pagination at the bottom of the panel.

Fee details contain the full period table and setup issues. Administrators select Edit to switch the
same drawer into the editor, or discard a staged draft from its details. Additional details is
integrated below the editable periods and shows saved identifiers; draft actions remain reachable at
the bottom of the drawer. Back to details returns within the same drawer and keeps unfinished input;
Edit resumes it. Keep draft stages the change and returns to the list; dismissing the editor keeps
unfinished inputs. Company rows show assigned-SKU counts. Company details contain the assignment
list, View members, and Delete company. Assigned SKUs use aligned columns that stack on narrow
screens. Company and user identifiers appear in collapsed Additional details sections, using the
same field/value table as other record drawers. Company metadata includes its creation time. User
metadata includes the saved company ID, joined time, and email-confirmation status. Timestamps use
UTC, and unavailable values display a dash. SKU, company, marketplace, and status filters live in
the Current fees column menus. The SKU filter supports exact-value multi-selection and literal
option search, includes available staged SKUs, and preserves the spelling and whitespace of each
SKU. SKU selections intersect with text search and the other filters before pagination. Changes
return to page one while retaining drafts and folding choices; applied chips remove selections
individually. Marketplace matches include both configured periods and required coverage; details
retain the full configuration. Companies supports company selection and ordering by name or
assigned-SKU count. These selections combine with search before pagination and persist through tab
changes and reloads.

Add company opens a compact dialog from the page header or an existing setup shortcut. Entered names
remain available across navigation, creation feedback stays in the dialog, and returning to the
originating editor remains explicit. The dialog cannot be dismissed while creation is pending. The
sticky fee-change summary appears only when drafts or unfinished edits exist; setup counts remain
visible in a compact notice with further explanation in header help.

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

SKU links in fee details, Inventory, and Companies, and View transactions in the fee editor, open
Transactions with that exact SKU, clear other filters/search, and preserve ordering, page size, and
drafts. Exact SKU text is shared across source namespaces. Add SKU suggests existing authorized
values by literal prefix and preserves the spelling and whitespace of new values.

After creating a company from an editor shortcut, return with the draft intact and explicitly select
and save the new company there. Delete company requires confirmation and reports linked-record
blockers. It never removes linked records. A confirmed deletion marks affected unsaved selections
unavailable until corrected.

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
Marketplace has its own column and selection filter. Administrators also see a Company column and
filter, including Unassigned. Each filter supports multiple selections; company and marketplace
selections intersect with the other filters before counts and pagination. Members never receive a
Company column or an active company filter. The SKU cell contains only its link and source date.
Health and recommendation options come from fixed constants checked against the source vocabulary.
Preprocessing rejects unsupported values, and database constraints guard the same contract. The
frontend owns explicit display labels, colors, and priorities, with the source code on hover.
Replenishment actions (Restock, Send to FBA, Create shipping plan) come first in urgency order,
followed by stranded inventory, listing fixes, pricing, advertising, and no-action recommendations.
Missing values remain last. Health and recommendation ordering use the
[documented urgency ranks](../../../docs/inventory_daily_captures.md#dates-latest-reads-and-access).

The API loads the complete authorized latest-item snapshot through stable identity pages. Search,
filters, SKU options, exact decimal comparisons, urgency ordering, and display pagination operate on
that snapshot in the browser. Changing a filter or page does not issue a data request. Database RLS
still controls every transport page. Revision checks bracket snapshot loading and reject a load if
inventory, ownership, or account access changes partway through; normal retry then reloads the
complete snapshot. Later revision changes invalidate the cache. This design uses browser memory
proportional to the latest authorized inventory, not historical captures.

Capture discovery includes successful empty captures and distinguishes missing snapshots, no
authorized items, and filters with no matches. Failed reads never become a no-snapshot claim. Each
row combines its stock date and age in one line; dates older than two marketplace-local calendar
days add an inline **Out of date** warning. There is no separate freshness panel or warning badge.
Missing stock dates are explicitly labelled with the report date as a fallback, and future dates
remain marked for checking. A recent processing timestamp does not make an old source fresh. Stock
dates and fallback report dates use the marketplace's time zone from generated source metadata. The
shared Additional details section contains capture and snapshot dates plus exact report and
processing timestamps in UTC; administrators also see capture and company IDs. Its disclosure state
belongs to the selected item.

Only capture/SKU identity is persisted for an open item. Its values follow the freshly loaded page;
a changed or removed capture closes the drawer. Paging, filtering, and sorting clear selection.
Inventory and ownership revisions refresh affected reads. Unchanged revision checks do not reload
inventory. Recommendations are informational, with no shipment or listing actions.

## Payout reports and Financial review

Payout reports group the latest saved company/month/marketplace snapshots, keeping currencies
separate as amount units. Month, Marketplace, and Company filters, visible month/year search, and
on-demand Versions history support browsing. Source or fee changes may leave the preceding snapshot
visible until the automatic worker publishes its replacement. The browser never generates reports.
Show versions reveals earlier reports as rows directly beneath the latest report in the existing
table, using its headings and column widths. The latest report appears once. Folding preserves the
viewport and horizontal scroll, with focus on the disclosure control beneath the marketplace.
Company and marketplace cells span all versions and controls within that report scope, so they
appear once; separate currencies and report scopes keep their own context. Earlier rows show their
saved timestamp and amounts, and each version is selected independently. The month heading spans all
visible report, loading, and paging rows. Each latest report shows its saved timestamp and a green
Latest label. The report list has no separate maturity or readiness panel. Administrators can
inspect processing and setup diagnostics in Financial review's Saved report snapshots section.
Version rows use click/Enter/Space detail navigation, with the inspected version highlighted.
Loading, retry, empty-history, and pagination controls occupy inline rows only when needed.

Saved report details contain Total, Amounts by type, and paginated Records. Headers retain
company/month/marketplace/currency context. An unspecified marketplace is a distinct report scope.
The headline uses frozen header amounts; Type breakdowns and records are calculated from the saved
source and terms versions through `payout_report_totals` and `payout_report_records`. Financial
review's readiness diagnostics cover the whole company/month even when snapshots are filtered to a
marketplace. Historical reports preserve their original totals and version references. Administrator
diagnostics load native aggregates from each report's saved source inputs. The frontend computes
comparisons with exact decimals, using retrieval coverage to distinguish an absent source from a
covered zero; payout amounts stay frozen. The
[payout contract](../../../docs/company_payout_reports.md) defines eligibility, maturity,
completeness, zero reports, and agreement with their source inputs.

Financial review shares Marketplace, Year, and the **Type families** checkbox menu across Finances,
Data Kiosk, and SelBox categories. This menu selects detailed families from the shared taxonomy; its
comparisons and charts keep those economic distinctions even when families share one broad browsing
group. These selections scope the yearly totals, chart, monthly rows, running difference, and exact
source drilldowns. Currency is resolved from the selected marketplace's period rows and shown as the
amount unit, with a selector when several units exist. Changing marketplace clears the unit and open
month. Scope survives navigation and reloads.

The chart combines signed family bars with running lines, numeric readouts, and keyboard/touch month
navigation. Saved snapshots retain their complete historical scope when current-source comparisons
are filtered. The
[overview contract](../../../docs/financial_review.md#yearly-overview-and-monthly-details) defines
filtering, chart, coverage, and drawer behavior; the
[family contract](../../../docs/financial_review.md#type-family-comparison-and-source-lookup)
defines memberships and comparison limits. Source-only coverage does not by itself establish an
error.

Review links use `reviewMarketplace`, separately from repeated table `marketplace` filters. Report
links require their exact ID, company, dates, currency, and `reportMarketplace`; an empty
marketplace value denotes an unspecified market. Currency never infers a marketplace. Native
financial channels remain distinct from their retail marketplaces in menus and links.

Source drilldowns retain exact row/version provenance. Finances keeps the main Search focused on
filtering its table. The secondary **Find by transaction ID…** action opens an exact Amazon ID
lookup drawer across all retained captures, independently of table filters. Its submitted ID and
page survive closing, tab changes, and reloads. Source details retain their exact row/version;
missing versions show an unavailable message. Closing returns focus to the previous action. The
[Financial review contract](../../../docs/financial_review.md) defines source eligibility and
diagnostics over saved source inputs.

## Design conventions

Use the shared [Mantine theme](src/design-system.ts), [design tokens](src/design-system.css), and
[WorkspaceHeader](src/WorkspaceHeader.tsx). Every workspace tab starts with one clear page title
matching its tab label, with related actions aligned in the same header. Semantic heading levels and
accessible names follow the content structure.

List views share [TableFrame](src/TableFrame.tsx) for borders, horizontal scrolling, floating
headings, and column controls; their row renderers own grouping and selection.
[AppliedFilterChips](src/AppliedFilterChips.tsx) handles removable filter chips, tooltips, and
keyboard focus while each view supplies its filter values. Fee and company panels use
[DetailDrawer](src/DetailDrawer.tsx) to retain content and labels through closing transitions. Fee
editor actions, including draft removal and setup navigation, live in
[useFeeEditor](src/use-fee-editor.ts).

Record tables share 13px data text, 12px semibold headings, 8px vertical/12px horizontal cell
spacing, and the same borders and surface colors. Detail tables use the same baseline with wrapping
for long values. Compact marketplace total cards retain their responsive column padding while using
the same text sizes. Metric cards and charts retain layouts suited to their summaries.

Saved metadata uses [AdditionalDetails](src/AdditionalDetails.tsx): a collapsed disclosure with the
same section spacing, explanation, and fixed Field/Value columns. Fields reflect the record's
available metadata and current permissions. Exact identifiers and source codes are preserved;
timestamp metadata uses UTC and boolean flags use Yes/No. Saved fee IDs describe published settings
even when a draft is being shown. Administrators can also inspect metadata from normal saved-report
details.

Page reads use the shared [LoadingStatus](src/LoadingStatus.tsx) beside their titles: Loading for
initial reads and Updating for background refreshes, including independent row counts. The inline
space stays stable during updates; there is no separate progress row above the tabs or toolbar.
Current totals uses the same subdued status text. Errors, offline explanations, save feedback, and
local detail requests keep their relevant context. Detail refresh status sits beside section
headings or pagination, without an empty status row above the table. Source record and
transaction-lookup rows open their exact retained version by click or Enter/Space.

Put optional explanations in [HelpPopover](src/HelpPopover.tsx), reached through a small, muted
question-circle control beside the relevant title or heading. Popovers show the explanation without
repeating the page title; their accessible names still identify the context. Help opens on hover or
keyboard focus, pins on click or tap, and dismisses with Escape, outside interaction, or its close
button. Keep help text readable and concise. Field labels, units, errors, draft/save feedback, and
source-age warnings remain visible; do not repeat generic instructional sentences above tables. Use
sentence case, Previous/Next, Rows, and the source name Finances consistently.

Controls expose hover and keyboard-focus feedback without shifting layout. Native `:hover` remains
available to mouse/trackpad input on touch-capable devices. Disabled controls keep their disabled
appearance. Text links use the shared accent underline. Narrow/coarse-pointer form controls use at
least 16px text to avoid automatic focus zoom; manual zoom remains available.

Drawer titles identify their purpose: Transaction totals, Transaction details, Finances record
details, Data Kiosk record details, Payout report details, or Saved report source details. Amounts
by type is a section within a totals or report drawer. Fee details/editing, Inventory details,
Monthly financial review, Company details, Company membership, and Find Amazon transaction retain
their task-specific titles. Totals, report, company, and monthly review headers include their scope.

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
track publications without a date or maturity suffix. Payout publication/readiness revisions are
independent of source and fee revisions. Member fee/ownership and payout revisions are
company-scoped. Pages and account counts have 30-second freshness; financial/payout counts persist
until a relevant revision changes.

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

Use an API URL reachable from the browser; local ports can differ. The browser requires an
`sb_publishable_` key. Secret and `service_role` keys must never enter `VITE_` settings. HTTPS is
required except for local hosts. Missing configuration has no implicit fallback.

For a reverse proxy that serves the app and Supabase on one origin, explicitly set
`VITE_SUPABASE_URL=same-origin` and keep the public key configured. The browser resolves the API
origin at runtime, so changing a tunnel hostname does not require rebuilding the bundle. Route
`/auth/v1/` and `/rest/v1/` requests to Supabase, preserving their paths and methods; those paths
must not return the application's HTML fallback. Runtime origins still require HTTPS except for
local development hosts. Session and workspace storage use that same resolved origin.

Reverse proxies must allow the Auth token, user, logout, signup, verify, and recover endpoints,
including authenticated `PUT /auth/v1/user` for password updates. Configure approved callback URLs
for the deployed origin/path and email delivery for confirmation/recovery. The local preview uses a
mail sink and explicitly permits recovery callbacks to `http://127.0.0.1:5173/` and
`http://localhost:5173/` in [the local Auth configuration](../../db/supabase/config.toml).
Successful local recovery does not establish hosted email delivery.

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

A separate static preview serves built assets and does not follow source edits. Rebuild it with its
real public configuration and activate the new assets after frontend or API contract changes, then
verify Current totals on that preview itself. The `build:check` output uses dummy API settings and
must not be served as the configured preview.
