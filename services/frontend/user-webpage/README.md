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

| Tab              | Purpose                                                | Access                                                        |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Transactions     | Current company amounts, fees, and current totals      | Members see their company; administrators see all companies   |
| Inventory        | Latest daily inventory captures and recommendations    | Members see their assigned SKUs; administrators see all items |
| Payout reports   | Latest saved reports and earlier versions              | Members see their company; administrators see all companies   |
| Current fees     | SKU companies, fee periods, and batch editing          | Members read their settings; administrators edit              |
| Assignments      | Campaign, promotion and shipment ownership             | Members read their company's IDs; administrators assign       |
| User access      | Company membership and revocation                      | Administrators; administrator roles remain DB-only            |
| Companies        | Company creation, assignments, and restricted deletion | Administrators                                                |
| Raw data         | Finances and Amazon's reports, with SelBox's tax split | Administrators                                                |
| Financial review | Finances by month: company, SelBox and differences     | Administrators                                                |

The tabs appear in this order, in three groups: the first five, which members also see; User access
and Companies; Raw data and Financial review.

New accounts are Unassigned until an administrator assigns a company. They see an access-pending
screen without company data. Signup supports immediate sessions or email confirmation according to
the Auth server's settings. See [Configuration](#configuration) for callback and email requirements.

### Navigation and tables

Each workspace tab has an associated panel. Filters, raw search text, ordering, page size, selected
records, expanded sections, and fee drafts survive tab changes and reloads within the same account
scope. Session storage belongs to this browser tab and Supabase project. Storage failures show a
warning; editing remains available in memory.

Supported read-only state also appears in the URL: tab, filters/search, ordering/page, selected
record (`row=`, including Current fees, Companies and Assignments) and exact report identity.
Back/Forward restores that state while retaining scoped drafts. A linked or restored value the
loaded data lacks (a page past the end, a stale `row=`, reason or group) is corrected by replacing
the history entry, so Back still leaves the page. URL values are validated against the current
account's permissions. Drafts, passwords, tokens, and financial amounts do not enter workspace
links. Initial sign-in preserves a report link; explicit sign-out clears workspace navigation
fields.

Selections are alternatives within one filter; different filters intersect. Table and option
searches are literal and case-insensitive. Search fields use one visible Search label and a
placeholder naming the searchable values, with no explanatory subtitle. Context-specific accessible
names distinguish fields for assistive technology. Type menus and current-total or saved-report
Amounts by type use the seven browsing groups from the
[type groups](src/transaction-type-families.ts). Type menus show readable exact types; Select
matches and Deselect matches affect only visible matches. Selection filters apply immediately.
Applied chips expose the active values and support individual removal; every chip row ends with
Clear filters. A search term stays in the search box and never becomes a chip. Chips sit on one line
in the table's status row, which keeps its height with or without chips. An empty result offers
Reset search and filters (Reset filters without a search) and preserves ordering and page size.

List-based tabs share [ListToolbar](src/ListToolbar.tsx) for Search, Rows, pagination, spacing, and
visible-range summaries such as `1–25 of 159 inventory items`. Contextual actions use its
extra-controls area. Inactive status messages do not reserve a blank line above the toolbar. Lists
that stop counting at the next page show `—` as their total until the last page.

Type cells use a compact column, with the readable type first and its broad group beneath in
smaller, muted text. The original type code remains available on hover. SKU values use the same
medium weight as date and type labels; Company amount values use bold text. Transactions combines
Reported amount with a smaller, labeled Quantity below it, and Service fee with Fee rate below it.
The Service fee heading retains applicability filtering; Reported amount retains amount ordering.
Raw-source tables and record details keep their separate fields.

Financial paging and factual sorting run on the server. Inventory filters, sorts, and pages its
complete loaded snapshot in the browser; Current fees and Assignments load their complete lists once
and search, filter and page them in the browser with exact totals. Previous/Next remains available
while a separate financial count loads; page-number entry becomes editable when a bound is known.
Enter applies a page number and Escape cancels the edit. Changing search or filters returns to page
one. Clicking a record or pressing Enter/Space opens its details. Lists with more than 10 rows, or a
later page, also have navigation below the list; bottom paging returns to the list controls. Each
range summary names what one row is: transactions, users, companies, SKUs, assignments, inventory
items, latest reports, and in Raw data Amazon's own units: Finances breakdowns (one amount Amazon
breaks a transaction into), invoices, storage fees, aged storage fees and removal order lines (one
FNSKU and disposition of an order). A failed read shows its red alert under the page header, above
the list controls, on every list.

Filtering, searching, ordering, or paging never moves a list on screen. While the next server page
loads, the previous rows stay in place, dimmed and closed to row activation, and the range summary
reads `Updating…`. When a result is shorter, TableFrame adds only the missing space at the end of
the page, so the scroll position stays reachable, and releases it as the page scrolls up.

Wide tables keep horizontal scrolling and Left/Right column controls near the table start.
Transactions pins Company amount at desktop widths of at least 1100px. Long lists retain visual
column headings while scrolling; the original table provides the accessible semantics. Detail tables
preserve their scope and pagination within the drawer.

### Financial amounts and current totals

Financial values remain decimal strings with exact calculations. Displays round to two decimal
places, including yen and zero, with ties away from zero. Totals sum exact values before rounding.
Rates retain their precision. Missing values display a dash; known zero amounts remain zero.
Timestamp displays use UTC, with the original posting instant in the tooltip.

Transactions' current totals follow every selected filter and literal search. Three cards show Last
day, Last month, and Selected dates together. Each card contains a compact list of the selected
marketplaces and their currencies, with Reported amount, Service fee, and Company amount. The cards
grow vertically with the selected marketplaces; they have no fixed-height list or internal vertical
scrolling. They appear side by side on wide screens, with matching marketplace rows aligned across
all three cards even when currency counts differ, and stack on narrower screens.

Current totals, type breakdowns, and their record lists sum the same eligible transactions as the
main list. This includes administrator-visible `SELBOX` entries; their company amounts and service
fees remain zero under the allocation rules. Company rows retain exact amounts and partial sums when
fee rates are missing. Current totals rows, type rows, the Transaction totals Total card and the
trend charts mark them with the same one-line "N missing fee rates" label in the warning tone; the
Current totals, Total and trends help explain that the company amount leaves those records out.
Current totals count the records of each currency ("2 records"), like the Transaction totals they
open. The company column keeps room for that label at every width.

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

The summary heading switches between Current totals, Daily trends, and Weekly trends. Trends use one
full-width card with a taller chart row for each marketplace, keeping currencies separate. Daily
trends default to the 30 UTC days through Last day; weekly trends default to the twelve complete
calendar months through Last month. Both use the same account-visible anchor as current totals.
Explicit date filters replace the default range, including open-ended ranges; clearing dates
restores the default. Weeks start on Monday, and boundary weeks include only the selected dates.

All three views share Current totals' marketplace order, including when filters change or a trend
view is restored on reload. Trend-range activity does not change that order.

Trend bars use the same broad groups as Type filters and Amounts by type. Groups with nonzero
service fees split into solid reported contributions and hatched fee contributions, with positive
and negative amounts stacked separately. The parts sum to the company's amount; a single black line
connects each period's company total without accumulating periods. Groups with zero fees retain one
solid bar. When company amounts are incomplete, bars include only calculated contributions: the
solid portion is the exact known company amount minus the known service fee. The details retain all
matching Reported amount, Service fee, and Company amount values in separate columns, with company
amounts emphasized and unknown values distinguished from zero. On phones, each type-group name sits
above its three amount columns so the values remain visible without horizontal scrolling. There is
no amount selector.

All filters and search apply to the complete aggregate, independent of transaction table paging.
Current totals, type breakdowns, and trends share one aggregation function. Each request returns all
matching groups in one response and one database snapshot, without offset pagination. The client
validates the group count before displaying amounts. Selections exceeding 100,000 groups require
narrower dates or filters; results are never silently truncated. Search & filters moves to the
record controls, and Back to summaries returns to the selected view. Empty marketplaces remain in
the shared order with a compact inline status. Hovering or focusing a period shows its exact
amounts; the chart has one keyboard entry point with Left/Right/Home/End navigation. Previous/Next
and the date selector also move between periods. Selecting a period brings it into view horizontally
while leaving the page in place; the currency and amount axis stay visible on narrow screens.
Explicit period and type-group detail actions provide alternatives to small bars. Bar and group
actions open Transaction totals for the exact period, marketplace, currency, and filters, expanding
and focusing the matching Amounts by type group. Records retain that scope. Empty periods have zero
activity, and the selected-period group table includes only groups with transactions, including real
zero-amount rows. Transaction trends display signed changes in each reporting period.

Transactions and Raw data › Finances support Date or Reported amount ordering. Amount ordering is
bounded to 10,000 matching rows; above that the column menu names the count in the list's own noun
("10,001 transactions match") and the limit. The
[query contract](../../../docs/transaction_query_contracts.md) defines exact request fields,
search/count semantics, ordering, fee applicability, source authority, and amount limits.

### Fee editing and company access

Current fees and Companies use [RecordTable](src/RecordTable.tsx), with the shared table headings,
cell spacing, borders, and horizontal-scroll controls. Clicking a row or pressing Enter/Space opens
its details in a right-hand drawer. Selecting text does not open details. The selected record
survives tab changes and reloads, and closing the drawer returns to the list without changing its
position. Both lists reserve their columns for record information.

Current fees groups rows by SKU, like the month groups in Payout reports. Marketplace fee periods
are folded by default; the disclosure shows or hides each period as a separate row with its
marketplace, rate, and effective dates. A folded SKU shows its one current rate (in effect on the
UTC day) with its dates, "N rates" when several apply, or "No current rate". The SKU, company, and
status belong to the whole group. The Fee periods column contains the period count with its
Show/Hide control beneath; the Marketplace column contains the marketplace summary while folded and
each period's marketplace while expanded. SKU headings reuse the Payout reports group typography and
spacing. Selecting its summary or any period opens the same SKU details and highlights every row in
that group. Folding is independent of selection, and counts and pagination remain based on SKUs.
Folding choices survive navigation and reloads. Current fees and Payout reports use the shared
[TableDisclosure](src/TableDisclosure.tsx) for their Show/Hide controls, including the same chevron,
spacing, hover/focus feedback, and reduced-motion behavior.

Fee details use one Marketplace fee periods section for the current schedule and saved history. Each
saved version includes its company, save time, reason, and complete period table, newest first, with
ten saved versions per page. One request retrieves the page and all of its periods under the same
database snapshot. History loads only after opening details for an administrator. A staged draft
appears as a separately labelled schedule, keeping proposed values distinct from saved versions.
Historical versions remain read-only, and Edit always starts from the current configuration or the
existing draft. Additional details follows the complete section and its pagination at the bottom of
the panel.

Fee details contain the full period table and setup issues. Administrators select Edit, in the
drawer header beside the close button, to switch the same drawer into the editor, or discard a
staged draft from its details. Additional details is integrated below the editable periods and shows
saved identifiers; draft actions remain reachable at the bottom of the drawer. Back to details
returns within the same drawer and keeps unfinished input; Edit resumes it. Keep draft stages the
change and returns to the list; dismissing the editor keeps unfinished inputs. Company rows show
assigned-SKU counts and creation times (UTC). User access rows show each email, whether it is
confirmed, the role, company and joined time; the email and company name are the row names, set in
the cell's size and line height so they line up with the rest of the row. Company details contain
the assignment list and Delete company; View members sits in the drawer header beside the close
button, like Edit in Fee details. Assigned SKUs use aligned columns that stack on narrow screens.
Company and user identifiers appear in collapsed Additional details sections, using the same
field/value table as other record drawers. Company metadata includes its creation time. User
metadata includes the saved company ID, joined time, and email-confirmation status. Timestamps use
UTC, and unavailable values display a dash. SKU, company, marketplace, and status filters live in
the Current fees column menus. The SKU filter supports exact-value multi-selection and literal
option search, includes available staged SKUs, and preserves the spelling and whitespace of each
SKU. SKU selections intersect with text search and the other filters before pagination. Changes
return to page one while retaining drafts and folding choices; applied chips remove selections
individually. Marketplace matches include both configured periods and required coverage; details
retain the full configuration. Companies supports search and ordering by name, assigned-SKU count or
creation time. Its column menus contain ordering controls only. Search and ordering apply before
pagination and persist through tab changes and reloads.

Add company opens a compact dialog from the page header or an existing setup shortcut. Entered names
remain available across navigation, creation feedback stays in the dialog, and returning to the
originating editor remains explicit. The dialog cannot be dismissed while creation is pending. The
sticky fee-change summary appears only when drafts or unfinished edits exist; setup counts remain
visible in a compact notice with further explanation in header help.

Administrators stage multiple SKU changes, inspect Review changes, and save one atomic batch.
Administrators can clear an existing SKU's company. Assigned SKUs need the required fee coverage.
Unrelated setup gaps remain visible without blocking a valid batch. Payout generation retains
completeness checks for its full scope. Members can inspect only their own SKUs' companies and
periods. Current fees says "company" for a SKU's owner; "assignment" means a Reference ID's company
in the Assignments tab only.

Every fee period table (the list, Fee schedule, saved versions and both Review changes tables) shows
the dates in two columns, "Effective from (inclusive)" and "Effective until (exclusive)", with "No
end date" for an open end; the editor names its inputs "Effective from N (inclusive)" and "Effective
until N (exclusive)", and Change rate from date names its date "New rate effective from (inclusive)"
([fee-period-labels](src/fee-period-labels.ts)). The Needs setup table of missing fee rates keeps
plain "Effective from" and "Effective until". Editor validation messages are short ("Enter 0–100, up
to 6 decimals.", "Choose a valid date.", "Effective until must be after Effective from."). A blank
field shows its error only after the user typed into or left it; those visited fields follow their
periods when a period is removed or a rate change splits one, and survive reloads and closed
editors. Pre-added missing-rate periods therefore open without errors, while a kept draft reopens
with all of its errors shown. Review changes still blocks Save and names the count in its footer.
Its Needs setup alert lists one compact "Complete SKU" action per SKU.

X, Escape, and backdrop dismissal retain unfinished inputs separately from staged drafts. Resume
unfinished edit restores them; Discard edits removes the unfinished form; Keep draft stages it for
review. Drafts, open review, and reasons survive tab changes and reloads. Change rate from date
previews a period split while preserving the original end and exact rate precision. Applying that
preview changes only the editor. Saving remains an explicit Save all changes action.

Stale or uncertain writes preserve the draft and require explicit recovery: a failed save is titled
"Could not save the fees" with the cause beneath it ("Result unknown. Refresh saved settings first."
when the answer never arrived, "The page reloaded during the save. Refresh saved settings first."
after a reload) and Refresh saved settings on the right. Reloads never replay a save, and a save is
not automatically retried. Confirmed saves refresh affected reads; a failed refresh is distinguished
from a failed save. Source revisions can make earlier configuration incomplete, so coverage is
rechecked without hiding the saved settings.

SKU links in Transactions, Finances, fee, Inventory, and Company details, Inventory rows, and View
transactions in the fee editor, open Transactions with that exact SKU, clear other filters/search,
and preserve ordering, page size, and drafts. Exact SKU text is shared across source namespaces. Add
SKU suggests existing authorized values by literal prefix and preserves the spelling and whitespace
of new values.

After creating a company from an editor shortcut, return with the draft intact and explicitly select
and save the new company there. Delete company requires confirmation and reports linked-record
blockers. It never removes linked records. A confirmed deletion marks affected unsaved selections
unavailable until corrected.

Membership editing distinguishes saved access from an unsaved selection. Saving checks the expected
role/company atomically; revocation needs explicit confirmation. A successful save closes the
drawer, names the account in a green page notice, and returns focus to its row; failures stay in the
drawer. A pending operation remains tracked across drawer and tab changes. Administrator accounts
are read-only here. The [access contract](../../../docs/access_control.md#permissions) defines
creation, deletion, membership, and publication permissions and retry rules.

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

The API loads the complete authorized latest-item snapshot through stable identity pages. The first
page requests an exact count so the reader can stop after the last item. Search, filters, SKU
options, exact decimal comparisons, urgency ordering, and display pagination operate on that
snapshot in the browser. Changing a filter or page does not issue a data request. Database RLS still
controls every transport page. Revision checks bracket snapshot loading and reject a load if
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

## Raw data

Raw data replaces the former Finances tab and is for administrators only. Its sub-tabs are Finances
(the default), Advertising invoice, Monthly storage report, Aged storage report and Removal order
report; the open sub-tab is `raw=` in the URL and a saved preference, and each sub-tab keeps its own
search, filters, ordering, page and open row (`row=`). The page header shows one loading status for
the open sub-tab ([RawData](src/RawData.tsx) embeds [FinanceDataset](src/FinanceDataset.tsx)), and
its "?" help gives one line per source.

Finances is the Finances table as before, every version included; rows of a superseded version say
"Earlier version" under their date. The four reports read the current version of each report through
administrator views (`current_ad_invoices`, `current_storage_rows`, `current_aged_storage_rows`,
`current_removal_order_rows`) with the same REST CSV path, exact HEAD counts and literal search as
payout reports; members get no rows. There is no Seller account column: seller account and region
are in the drawer's Additional details. A removal order names no marketplace, so that table shows
the seller account's Region ("North America", "Europe", "Japan", "Singapore" or "Australia") and has
no marketplace filter. Its rows of one order and FNSKU differ by Disposition, and the line under
Requested quantity is what the order type did: "Disposed" for Disposal, "Shipped" for Return and
Liquidations. Amazon fills that quantity and leaves the other blank; a row without it fails the
page. A Monthly storage report row shows Amazon's average quantity on hand; its drawer adds the
product size tier, the estimated total item volume with its unit, and the rate in the form the
report printed: one storage rate (Australia, Singapore) or a base rate with a utilization surcharge
rate (Europe, Japan, North America), each per cubic foot or cubic meter. The two-rate form also
shows the storage utilization ratio in weeks (">52" as Amazon prints it), the estimated volume for
the surcharge, and Amazon's split of the fee into an estimated base storage fee and an estimated
utilization surcharge. A row with neither form, both forms, an unknown volume unit, a negative
figure or an incomplete split fails the page.

| Source                 | One row is                       | Default order   | Filters                      | Search               |
| ---------------------- | -------------------------------- | --------------- | ---------------------------- | -------------------- |
| Advertising invoice    | An invoice                       | Invoice date    | Invoice date, marketplace    | Invoice ID           |
| Monthly storage report | An FNSKU at a fulfillment center | Month of charge | Month of charge, marketplace | FNSKU, ASIN          |
| Aged storage report    | An FNSKU in a monthly snapshot   | Snapshot month  | Snapshot month, marketplace  | FNSKU, ASIN, SKU     |
| Removal order report   | An order × FNSKU × disposition   | Request date    | Request date (UTC)           | Order ID, FNSKU, SKU |

Amounts show every digit, padded to the currency's minor units. Amazon prints no tax on the three
warehouse reports: SelBox splits each fee into base and tax, and the line beneath the fee says "Tax
included: y" when the fee is base plus tax or "Tax added: y" when the fee is the base alone (an
exact decimal comparison; any other split fails the page). Each report row opens a record drawer
listing the fields Amazon printed, in its column order, then a "Calculated by SelBox" section (the
marketplace from the country code, base, tax, the inventory ledger months that find the SKU, and an
invoice's tax rate as a percentage). A printed SKU that is exactly a catalog SKU links to
Transactions. An invoice drawer also reads its lines (`current_ad_invoice_lines` by `version_id`, in
Amazon's order) and shows them with exact cost and SelBox's per-line tax ("Tax, calculated"); a line
count that differs from the invoice's is an error with Retry. Regions, invoice statuses, ad
programs, invoice line kinds and removal order types are fixed lists
([amazon-codes](src/amazon-codes.ts), [raw-report-rows](src/raw-report-rows.ts)); an unknown code
fails the read with an error instead of showing the code. Preprocessing rejects the same unknown
invoice statuses and ad programs before they are stored. Reference revisions refresh the four
reports.

## Payout reports and Financial review

Payout reports show each company’s monthly activity and its SelBox service fees. Open a report to
inspect the contributing records and amounts by type. Historical versions retain the source and
ownership versions used to calculate them.

Financial review covers one marketplace and one year, chosen from constant options: the generated
marketplace list (Amazon.com by default) and the years from 2024, the earliest Finances activity
Amazon returns, to the current UTC year. Each marketplace has one currency
([marketplace-currencies](src/api/marketplace-currencies.ts)); a row in any other currency, an
unknown reason, SelBox group or record source, or a month whose Finances differ from its Company
amounts, SelBox types and Differences (base or tax, exactly) shows a red alert with Retry. Four
cards show the year's Finances, Company amounts, SelBox types and Differences, each including tax
with the tax beneath; amounts keep every digit, padded to the currency's minor units.

Differences by month reuses [AmountTrendPlot](src/AmountTrendPlot.tsx): each month's differences
stack up or down by reason, one fixed color per reason
([financial-review-chart](src/financial-review-chart.ts)), with one running-difference line from
January. Months without activity are labelled gaps; the legend lists each reason's year total,
largest first. Selecting a month (click, Enter, or arrow keys between months) or a Months table row
opens the month drawer; a reason segment opens it with that reason selected. Previous month and Next
month in the drawer header step through the months with activity. The drawer shows the month's
totals, Differences by reason and SelBox types by group (collapsed). Selecting a reason or group
narrows its records, 50 per page with the exact total from the months' record counts, and a chip
clears it. Another month, reason or group starts its records on page 1, also a month seen before;
another month starts payout readiness on page 1 too. Finances records, and the balancing entries
computed from a Finances charge, show the source "Finances" and open that charge's source record.
Payout readiness, collapsed by default, shows each company's report state, and blocked companies
list their missing fee rates. Marketplace, year, the open month (`row=`), reason and group are in
the URL. An opened Finances record belongs to the records list that opened it: it closes when that
month, reason or group closes (also by Back or a link) and never reopens over another month.

Assignments lists campaigns, promotions and shipments like Current fees: one read
(`rpc/reference_assignments`) loads the complete list, ordered by Reference ID. Columns are
Reference ID, Source, Company, Marketplace and Status; members see only their company's IDs, without
Company, Status or editing. Marketplace shows Amazon's own record for a campaign or promotion and
the marketplace of the Finances charges that name a shipment (one name, `N marketplaces` with the
list on hover, or `—`), and its menu lists the constant marketplaces. Status is Needs setup (no
company), Products disagree or Saved; administrators also get an `N IDs need setup` alert whose
Assign next ID opens the first such ID in the editor. Search, filters, page, Rows and the open row
are in the URL. Assignment details show the facts; for administrators also the warning, Product
ownership (SKUs link to Transactions), Assignment history and Additional details. Edit, in the
drawer header, swaps the drawer to the company editor with Add company and an optional reason (a
blank reason saves "Administrator updated assignment"). The editor keeps the version it started
from, also through reloads, and the save expects it: when another administrator saves first, an
orange "Assignment changed elsewhere" alert keeps the choice and blocks Save until Load latest
restarts from the newer version. Saving closes the drawer, names the ID in a notice
(`Assignment saved: <ID> · <company>`) and returns focus to its row. SKU ownership and fee rates are
managed in Current fees.

## Design conventions

Use the shared [Mantine theme](src/design-system.ts), [design tokens](src/design-system.css), and
[WorkspaceHeader](src/WorkspaceHeader.tsx). Every workspace tab starts with one clear page title
matching its tab label, with related actions aligned in the same header. Semantic heading levels and
accessible names follow the content structure.

List views share [TableFrame](src/TableFrame.tsx) for borders, horizontal scrolling, floating
headings, column controls, the fixed applied-filter row, the dimmed loading state, and the
[scroll reserve](src/scroll-reserve.ts); their row renderers own grouping and selection.
[AppliedFilterChips](src/AppliedFilterChips.tsx) handles removable filter chips, tooltips, and
keyboard focus while each view supplies its filter values. Empty lists use
[EmptyState](src/EmptyState.tsx) inside the table frame ("No <items> yet", or "No matching <items>"
with a Reset action). Every failed read is an [ErrorAlert](src/ErrorAlert.tsx): the title "Could not
load <thing>", the short cause beneath it ([loadErrorDetail](src/load-error.ts): the HTTP status, no
response, a timeout, or the error's own sentence) and one Retry. A failed save is the same alert
without Retry (its Save button tries again): [saveError](src/save-error.ts) titles it "Could not
<save|add|delete> the <thing>" ("Could not save the assignment", "Could not add the company") with a
known reason or the same short cause beneath it. A save closes its drawer and shows one green notice
naming the record: `<Thing> saved: <record>` (`Fees saved`, `Assignment saved`, `Membership saved`;
`Company added` and `Company deleted` for companies). Every drawer is
[DetailDrawer](src/DetailDrawer.tsx): one of three width tokens (`record` 720px, `wide` 1000px,
`full` min(1440px, 100vw)), a [DrawerHeading](src/DrawerHeading.tsx) with the title and an "identity
· scope" line, a close label derived from the title (`closeLabel` keeps a month's case: "Close
January 2026"), record actions such as Edit in the header beside the close button (`headerActions`),
and content retained through closing transitions. The body never repeats the record name or scope;
record facts use [DetailFields](src/DetailFields.tsx). Fee editor actions, including draft removal
and setup navigation, live in [useFeeEditor](src/use-fee-editor.ts). The fee and assignment editors
share [CompanyField](src/CompanyField.tsx), and both lists count what needs setup in
[NeedsSetupAlert](src/NeedsSetupAlert.tsx).

Record tables share 13px data text, 12px semibold headings, 8px vertical/12px horizontal cell
spacing, and the same borders and surface colors. The Mantine `xs`/`sm` font sizes are 12px/13px, so
text, buttons and inputs follow the same tokens; secondary lines use 12px. Every status badge is a
[StatusBadge](src/StatusBadge.tsx) (sentence case, 12px semibold, tones success, warning, danger,
info and neutral), including Inventory health; a missing status is the muted dash used for every
missing value, never an empty badge. Lists show money with two decimals and the currency; Financial
review and Raw data use `formatExactAmount`/`formatExactMoney`, which pad to the currency's minor
units without hiding sub-cent digits. Days are YYYY-MM-DD and months "June 2026". Timestamp columns
and field labels carry "(UTC)"; their values have no suffix. Detail tables use the same baseline
with wrapping for long values. Compact marketplace total cards retain their responsive column
padding while using the same text sizes. Metric cards and charts retain layouts suited to their
summaries.

Saved metadata uses [AdditionalDetails](src/AdditionalDetails.tsx): a collapsed disclosure with the
same section spacing, explanation, and fixed Field/Value columns. Fields reflect the record's
available metadata and current permissions. Exact identifiers and source codes are preserved;
timestamp labels carry "(UTC)" and boolean flags use Yes/No. Saved fee IDs describe saved settings
even when a draft is being shown. Administrators can also inspect metadata from normal saved-report
details.

Page reads use the shared [LoadingStatus](src/LoadingStatus.tsx) beside their titles: Loading for
initial reads and Updating for background refreshes, including independent row counts. A failed
count shows "Count unavailable" with its own Retry while the rows stay usable. The inline space
stays stable during updates; there is no separate progress row above the tabs or toolbar. Current
totals uses the same subdued status text. Errors, offline explanations, save feedback, and local
detail requests keep their relevant context. Detail refresh status sits beside section headings or
pagination, without an empty status row above the table. Source record and transaction-lookup rows
open their exact retained version by click or Enter/Space.

Put optional explanations in [HelpPopover](src/HelpPopover.tsx), reached through a small, muted
question-circle control beside the relevant title or heading; drawer sections take it through
`DetailSection`'s `help` prop. Popovers show the explanation without repeating the page title; their
accessible names still identify the context. Help opens on hover or keyboard focus, pins on click or
tap, and dismisses with Escape, outside interaction, or its close button. Keep help text readable
and concise. Field labels, units, errors, draft/save feedback, and source-age warnings remain
visible; do not repeat generic instructional sentences above tables. Use sentence case,
Previous/Next, Rows, and the source name Finances consistently.

Controls expose hover and keyboard-focus feedback without shifting layout. Native `:hover` remains
available to mouse/trackpad input on touch-capable devices. Disabled controls keep their disabled
appearance. Underlined accent text only navigates to another tab (`ui-link`); in-page actions such
as opening a drawer use accent text without an underline (`ui-text-action`); disclosures
(TableDisclosure, collapsible section titles) use a chevron and plain text (`ui-disclosure`).
Narrow/coarse-pointer form controls use at least 16px text to avoid automatic focus zoom; manual
zoom remains available. Compact buttons are at least 24px tall on coarse pointers. At 720px and
below the workspace tabs stay on one horizontally scrolling row.

Drawer titles name the record kind: Transaction details, Finances record details, Advertising
invoice details, Monthly storage fee details, Aged storage fee details, Removal order details,
Payout report details, User access details, Company details, Fee details, Inventory details and
Assignment details; working drawers are Fee editor, Review changes, Find transaction and Transaction
totals. A Financial review month drawer is titled by its month. Amounts by type is a section within
a totals or report drawer.

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
invalidate dependent pages, counts, summaries, options, and fee lookups. Finances and reference
source tokens track publications. Payout publication/readiness revisions are independent of source
and fee revisions. Member fee/ownership and payout revisions are company-scoped. Pages and account
counts have 30-second freshness; financial/payout counts persist until a relevant revision changes.

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
