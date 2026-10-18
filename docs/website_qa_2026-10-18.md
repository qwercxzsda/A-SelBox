# Website QA review

Reviewed on **October 18, 2026**, against commit **38352890** on
`feat/settlement-to-transactions`, using the running preview and its current database.

The main workflows are usable, but several important states remain difficult to interpret.
The highest priorities are exposing blocked payout generation, showing the actual age of inventory,
and deciding whether unrelated incomplete SKUs should prevent otherwise valid fee corrections.
The review also confirmed lost fee-editor input, lost keyboard focus, silent currency changes,
and missing offline feedback.

A second pass focused specifically on **UI usability**: finding controls, understanding what an
action does, keeping context while scrolling, and completing common tasks with less manual work.
It adds the workflow assessment below and findings **Q19–Q24**. These are expert walkthrough
observations and design judgments, not results from a study with first-time users.

This is a documentation-only review. Application code, source captures, fees, company assignments,
and payout records were not changed. Local drafts were exercised in isolated browser sessions.

## Coverage

Desktop was the primary target: **1440 px and 1920 px** widths. Secondary checks used **834 px**
tablet and **390 px** phone layouts. Live walkthroughs used Chromium; offline behavior and fee-editor
focus were independently reproduced in Chromium and WebKit. This is browser-engine coverage,
not a claim of testing physical iPads or native macOS Safari.

| Area | Accounts and scenarios checked |
| --- | --- |
| Sign in and account creation | Signed-out screens, field labels, password visibility, recovery discoverability; no new accounts or emails submitted. |
| Transactions | Administrator and both existing members; summaries, currency, search, filtering, SKU navigation, empty results, reload, and horizontal table navigation. |
| Finances and Data Kiosk | Administrator; populated source tables, date/SKU/marketplace filtering, amount-order limits, details, metadata, and native transaction-ID lookup. |
| Current fees | Administrator and member visibility; prefix autocomplete, existing-SKU editing, local drafts, F5, X dismissal, review, setup blockers, and navigation to Transactions and Companies. |
| Payout reports | Administrator and member views; mature-month selection, missing April reports, report totals, types, records, marketplace breakdown, and saved details. |
| Financial review | Administrator; all category tabs, year/currency scope, full mature months, monthly and running differences, source types/records, snapshots, F5, and keyboard chart navigation. |
| Inventory | Administrator and both members; all available items, search, health/recommendation ordering, details, source dates, and SKU navigation. |
| User access and Companies | Administrator; directory search, company-to-member navigation, company-name drafts, pending membership changes, F5, and cancellation of revocation confirmation. No saves or deletions submitted. |
| Unassigned users | Existing automated fixture: waiting screen, no company data, session retention after F5, and automatic access after assignment. No unassigned account exists in the live preview. |
| Connectivity and permissions | Offline cached/uncached views and reconnection; member inventory ownership and administrator-only reads. This was not a penetration or load test. |

The same application revision had already passed **279 unit tests, 377 Chromium browser tests,
11 WebKit checks, and 7 database tests** before this exploratory review. Those regression results
are a baseline, separate from the live walkthroughs and additional targeted checks here. Final
business writes and real email delivery were outside the live walkthrough; their successful
production behavior is not inferred from a disabled button or a mocked test.

## UI usability assessment

The consistent table styling, readable monetary formatting, visible urgency labels, and preserved
view state provide a useful foundation. The biggest improvements would come from making actions
and selected scope visible, keeping context close to the information being read, and reducing
manual setup. The second pass concentrated on **1440 px desktop widths**, with viewport heights
of 900–1000 px.

| User goal | What helps today | Where the interface demands extra effort | Suggested direction |
| --- | --- | --- | --- |
| Understand a month's company amount | Clear total labels, zero rows retained, month-grouped payout reports. | Period filtering lives in column menus; the visible month name does not work in payout Search; summary cards have actions that are not visibly labelled. | Put common period controls near the totals, search the visible labels, and expose a clear View by type action. Q07, Q12, Q20, Q21. |
| Explain a financial difference | A single currency and year keep the overview coherent; monthly and running totals are separate. | Source types must be matched manually, identifiers are not useful navigation links, and the selected month/company scrolls away in long drawers. | Keep scope in the drawer header; pair supported comparisons and link to original evidence. Q09, Q10, Q19. |
| Change a fee from a future date | Prefix autocomplete, validation, draft review, and a visible editor footer help prevent mistakes. | Users manually coordinate the old and new periods, and after keeping a lower-list draft the next Review action can be off-screen. | Offer a guided Change rate from date operation and keep the pending-change action reachable. Preserve the explicit final save. Q03–Q05, Q19, Q22. |
| Decide which SKU needs attention | Urgency ordering, coloured labels with text, and SKU-to-Transactions navigation work. | Stock age, missing marketplace coverage, and active filter values are not evident together. | Show as-of information and coverage, plus individually removable filter labels above the table. Keep recommendations informational. Q02, Q14, Q23, Q24. |
| Manage a company's users and SKUs | Companies → View members is a useful scoped shortcut; membership saves and revocations are explicit. | A pending membership choice needs a clearer draft label. Company SKU links lead to Transactions, so reaching their fee settings requires another tab and search. | Distinguish saved and proposed access; consider an adjacent administrator-only SKU settings shortcut while preserving the existing Transactions link. Q17. |
| Work through a long record list | Search, exact filters, row selection, and horizontal scrolling are available. | At the bottom of 100 rows, headers and all navigation controls have scrolled away. | Keep column context visible and place pagination at the end of the list as well as the start. Q19. |

The next design pass should use the same patterns across tabs: visible scope, explicit drilldown
actions, persistent context in long views, and consistent draft/save states. Avoid solving these
problems by removing zero rows, adding routine reload buttons, adding inventory execution buttons,
or changing the accounting rules.

## Prioritized findings

**P1** means address before relying on the affected operational workflow. **P2** means substantial
usability or accessibility friction. **P3** means a clarity or navigation improvement.
These priorities do not imply that displayed accounting calculations are wrong.

| ID | Priority | Classification | Finding |
| --- | --- | --- | --- |
| Q01 | P1 | Feedback gap | Blocked mature payouts look like an ordinary empty result. |
| Q02 | P1 | Freshness visibility | Fifteen-day-old inventory has no prominent as-of date or warning. |
| Q03 | P1 | Product policy decision | Unrelated incomplete SKUs block a valid fee correction. |
| Q04 | P2 | Data-entry loss | X silently discards an unfinished fee edit. |
| Q05 | P2 | Accessibility defect | Closing the fee editor loses keyboard focus. |
| Q06 | P2 | Scope inconsistency | Transactions silently switches the selected currency. |
| Q07 | P2 | Scope clarity | Summary totals and the record table respond to different controls. |
| Q08 | P2 | Connectivity feedback | Offline data looks current and uncached tabs keep saying Loading. |
| Q09 | P2 | Investigation usability | Source-type comparisons require manual matching and subtraction. |
| Q10 | P2 | Investigation usability | Source identifiers do not provide a direct path to the original record. |
| Q11 | P2 | Information hierarchy | Payout marketplace totals are buried below raw records. |
| Q12 | P2 | Desktop readability | The company amount is off-screen on a typical desktop width. |
| Q13 | P2 | Missing recovery flow | Sign in offers no password recovery path. |
| Q14 | P2 | Comparison clarity | Inventory sales ranking mixes currencies before explaining the limitation. |
| Q15 | P3 | Terminology | Activity eligibility needs an explanation at the point of use. |
| Q16 | P3 | Precision explanation | Correct rounding differences look like a one-cent error. |
| Q17 | P3 | Draft clarity | Pending membership selections lack an explicit unsaved label. |
| Q18 | P3 | Navigation | Tabs and details cannot be bookmarked or shared as a specific view. |
| Q19 | P2 | Orientation and navigation | Long views lose useful context and next-step controls. |
| Q20 | P2 | Action discoverability | Summary cards hide their drilldown action and the date-range entry point. |
| Q21 | P3 | Search predictability | Payout search does not match the month label displayed to users. |
| Q22 | P2 | Task effort | Scheduling a rate change requires coordinating multiple fee periods manually. |
| Q23 | P2 | Empty-state clarity | Missing inventory coverage looks like an ordinary empty filter result. |
| Q24 | P2 | Filter visibility | Inventory hides the selected health and recommendation values after menu closure. |

### Q01 Explain blocked payout generation

**Reproduce:** Open Payout reports, choose Month → `2026-04`, and apply the filter.

**Observed:** The page says **No matching reports**, suggests adjusting filters/search, and offers
Reset search and filters. April is mature. A read-only database check confirmed two April company/month
jobs pending after **11 failed attempts each**. Their unresolved inputs comprise **244 components
across three unassigned SKUs**; none of those components requires a fee base. April has no reports,
while March has 17 latest reports and May has 16. This is a setup blocker, not a failed search.

**Improve:** Show month readiness such as Pending, Updating, Blocked, and Complete. Give administrators
the relevant setup blockers and a link to Current fees. Tell members when administrator setup is
required. Keep generation and retry automatic; do not introduce a Generate report button.

**Acceptance:** A correctly selected mature month distinguishes no activity from pending or blocked
generation. The blocked state identifies the action needed and clears automatically after resolution.

Evidence: [April empty view](evidence/website_qa_2026-10-18/payout-april-blocked.png),
[read-only observations](evidence/website_qa_2026-10-18/observations.json).
Relevant implementation: [PayoutStatus](../services/frontend/user-webpage/src/PayoutStatus.tsx).

### Q02 Show inventory age before users act

**Reproduce:** Open Inventory, select an item, and expand Source capture.

**Observed:** The captured and snapshot dates are **October 3**, and the report was created October 3.
Preprocessing occurred **October 17**. On the review date, stock therefore represents a **15-day-old
snapshot**. The overview and initial details say Latest daily capture without prominently showing
that date. The source dates are behind a collapsed section. Recent preprocessing does not make the
underlying stock observation recent.

**Improve:** Show the stock as-of date beside the quantities or in a persistent overview notice.
Highlight overdue daily captures and identify affected marketplaces when dates differ. Label the
source date separately from processing time. Use Latest imported snapshot when a daily capture is
not actually available. This finding concerns visibility; it does not establish an ingestion defect.

**Acceptance:** A user can judge freshness before interpreting stock, last-90-day sales, or restock
recommendations, without opening metadata. Automatic refresh remains in place.

Evidence: [clean source-date view](evidence/website_qa_2026-10-18/inventory-source-date.png).
Relevant implementation: [Inventory](../services/frontend/user-webpage/src/Inventory.tsx),
[InventoryDetail](../services/frontend/user-webpage/src/InventoryDetail.tsx).

### Q03 Review the scope of fee publication validation

**Reproduce:** In Current fees, edit the already configured `10mm_ELLIE`, change a valid rate,
choose Keep draft, and open Review changes. Do not save.

**Observed:** Save all changes is disabled because **eight other SKUs** need setup. The edited SKU
has a company and four valid fee periods. The interface already explains global validation and
provides blocker links; the friction is the rule itself, not missing instructions.

**Improve:** Decide whether an existing valid SKU can be corrected while unrelated imported SKUs
remain incomplete. If permitted, validate affected changes while preserving the separate global
readiness checks needed for payouts. If global completeness is required, retain the current blocker
list and shortcuts. This requires a product/accounting decision, not merely enabling the button.

**Acceptance:** The chosen policy is explicit and tested. An isolated correction either succeeds
under that policy or identifies why unrelated setup is a necessary prerequisite.

Evidence: [blocked fee review](evidence/website_qa_2026-10-18/fee-save-blocked.png).
Relevant implementation: [SkuConfigurationReview](../services/frontend/user-webpage/src/SkuConfigurationReview.tsx).

### Q04 Preserve unfinished fee input when closing

**Reproduce:** Change a fee rate from `5.2` to `1.234567` without choosing Keep draft. Press F5,
then close the restored editor with X and reopen the same SKU.

**Observed:** F5 preserves the changed input, but X silently discards it; reopening shows `5.2`.
There is no discard confirmation. This concerns unfinished editor input, not a previously staged draft.

**Improve:** Preserve the unfinished form on close, or ask whether to discard when it is dirty.
Use explicit Keep draft and Discard actions consistently across X, Escape, and backdrop dismissal.

**Acceptance:** Accidental dismissal cannot silently lose an edited form, while a deliberate discard
still works. Verify both a new fee period and a changed existing rate.

Relevant implementation: [CurrentFees](../services/frontend/user-webpage/src/CurrentFees.tsx).

### Q05 Return focus to the fee editor opener

**Reproduce:** Focus an Edit SKU button, press Enter, and close the editor with X. Wait until the
dialog is hidden and another second has passed, then press Tab.

**Observed:** In both Chromium and WebKit, focus remains on `BODY` although the opener is still
connected. The next Tab goes to Sign out. This is persistent loss of keyboard position, not a
transition-timing observation or proof of the earlier macOS scrolling symptom.

**Improve:** Restore focus to the opening Edit button, with a stable fee-list fallback after reload
or filtering. Reuse the existing drawer focus-return behavior and preserve scroll position.

**Acceptance:** X, Escape, and backdrop closure return visible keyboard focus to a meaningful control.

Evidence: [two-engine focus check](evidence/website_qa_2026-10-18/observations.json).
Relevant implementation: [CurrentFees](../services/frontend/user-webpage/src/CurrentFees.tsx),
[useDrawerFocusReturn](../services/frontend/user-webpage/src/use-drawer-focus-return.ts).

### Q06 Keep the chosen summary currency explicit

**Reproduce:** In Transactions, select JPY, then filter Marketplace to Amazon.com.

**Observed:** For the administrator and both members, the cards change to USD and the Currency
selector disappears, without a notice. For one member, the latest-day reported amount changes from
`7,848.85 JPY` to `-14.16 USD`. The currency codes are present, but the change is easy to miss.
Financial review already preserves the selected currency when a scope has no matching rows.

**Improve:** Apply the same rule in Transactions: retain JPY and show no matching JPY activity,
with an explicit way to select USD. Avoid changing a user's comparison currency implicitly.

**Acceptance:** Filtering, changing periods, and automatic refresh cannot silently switch currency.

Evidence: [JPY selected](evidence/website_qa_2026-10-18/summary-jpy.png),
[after marketplace filter](evidence/website_qa_2026-10-18/summary-usd-after-filter.png).
Relevant implementation: [EstimatedSummaries](../services/frontend/user-webpage/src/EstimatedSummaries.tsx).

### Q07 Make summary and record scopes unmistakable

**Reproduce:** Search Transactions for `QA-NO-SUCH-SKU-20261018`. Also compare the USD summary
with the unfiltered record table below it.

**Observed:** The table becomes empty while the summary cards remain unchanged. With no search,
USD summaries can sit above EUR and SEK rows. This follows the current contract: summary currency
does not filter the table, and table search/type/source controls do not redefine all summary totals.
The small scope note names the filters that apply, but does not directly explain these exclusions.

**Improve:** Label the controls Summary currency and Search records, and show a concise scope note
when the records differ from the summary scope. Offer an explicit, clearly named way to view the
records behind a card. Preserve the existing calculation rules unless deliberately redesigned.

**Acceptance:** An empty table with nonzero totals clearly explains why, and a user can identify
which filters affect each total without inferring it from the numbers.

Evidence: [current desktop scope](evidence/website_qa_2026-10-18/desktop-transactions.png).
Relevant implementation: [TransactionSummaries](../services/frontend/user-webpage/src/TransactionSummaries.tsx).

### Q08 Distinguish offline data from loading

**Reproduce:** Load Transactions, disconnect the browser network, then open an uncached Finances
tab. Allow the automatic-refresh interval to pass, then reconnect.

**Observed:** In Chromium and WebKit, cached Transactions still shows 25 rows and totals with no
offline notice. The uncached tab continues to show Loading rows without explaining that requests
are paused. Reconnection recovers correctly. The check simulated disconnection and advanced browser
timers past the refresh interval.

**Improve:** Show Offline with the last successful refresh time for cached data. Explain that an
uncached view is waiting for a connection, and resume automatically. Keep the existing automatic
refresh approach rather than adding a routine reload button.

**Acceptance:** Users can distinguish current, cached/offline, loading, and failed states.

Evidence: [offline loading](evidence/website_qa_2026-10-18/offline-loading.png),
[two-engine observations](evidence/website_qa_2026-10-18/observations.json).
Relevant implementation: [useWorkspaceRefresh](../services/frontend/user-webpage/src/use-workspace-refresh.ts).

### Q09 Help users compare related financial types

**Reproduce:** Open Financial review → Data Kiosk → 2026 → USD → July, then Amounts by type.

**Observed:** The `-1,633.66 USD` total difference leads to 18 source/type rows in separate blocks.
Related names differ: Coupon participation fee and Coupon performance fee versus Coupon fees;
FBA storage fee versus Storage fees; Long term storage fee versus Aged storage fees. Users must decide
which can be compared and subtract amounts manually.

**Improve:** Add a comparison layer for documented equivalent fee families, with both source totals,
a difference, and source-specific drilldowns together. Retain native labels and an unmatched or
uncertain group. Do not assume Advertising and Sponsored Products cover the same activity, or imply
that an aggregate difference identifies the responsible SKU.

**Acceptance:** Supported comparisons are easy to inspect; uncertain mappings remain visibly uncertain.

Relevant implementation: [FinancialReviewTypes](../services/frontend/user-webpage/src/FinancialReviewTypes.tsx).

### Q10 Connect comparison records to their original evidence

**Reproduce:** Open Financial review → Data Kiosk → July 2026/USD and expand Source records.
Separately, inspect a known Finances row, copy its Amazon transaction ID from Additional details,
and search Finances for that ID.

**Observed:** Financial review shows internal source-row/version identifiers as plain text without
a detail action. Searching for the known Amazon ID returns zero rows because Search only covers
SKU, type, and marketplace. The administrator must reconstruct the date/SKU/type trail manually.
The Data Kiosk category for July/USD has 325 source records, making that inconvenient.

**Improve:** Add an administrator-only View source record action using the exact source row and
version, plus exact Amazon transaction-ID lookup in Finances. Provide SKU/marketplace refinements
inside source records while keeping the account-wide comparison total clearly labelled.

**Acceptance:** A comparison record can be traced to the same original evidence without manual
re-searching, and member access remains restricted.

Relevant implementation: [FinancialReviewRecords](../services/frontend/user-webpage/src/FinancialReviewRecords.tsx),
[source search configuration](../services/frontend/user-webpage/src/api/config.ts).

### Q11 Put payout summaries before long record tables

**Reproduce:** Open the first July USD company payout at 1440 × 900 and find Marketplace breakdown.

**Observed:** Its heading starts about **3,597 CSS pixels** from the drawer content start, below the
type breakdown and an automatically displayed 50-record page. This report has 5,205 records in total.
There is no section shortcut near the report total.

**Improve:** Move marketplace totals above raw records, or provide compact section navigation at the
top. Open detailed records deliberately from a type or amount rather than letting them dominate the
initial report. Keep zero rows, pagination, and exact calculations.

**Acceptance:** A desktop user can reach either primary breakdown without scrolling past 50 records.

Evidence: [marketplace position](evidence/website_qa_2026-10-18/payout-marketplace-position.png).
Relevant implementation: [RowDetail](../services/frontend/user-webpage/src/RowDetail.tsx),
[PayoutAmounts](../services/frontend/user-webpage/src/PayoutAmounts.tsx).

### Q12 Keep the main monetary result visible on desktop

**Reproduce:** Open administrator Transactions at 1440 px width and leave horizontal scroll at the start.

**Observed:** The table viewport is **1,367 px** wide and its content **1,507 px** wide. The company
amount is off-screen to the right. At 1920 px, the table fits. Horizontal controls work, but a primary
result is hidden on a common desktop/laptop width, not just on phones.

**Improve:** Prioritize Company amount in the default layout, pin it with an identity column, or
offer a compact monetary view. Keep secondary fields available without relying on a wider monitor.

**Acceptance:** At 1440 px, users can read the SKU and company amount together without horizontal travel.

Evidence: [1440 px Transactions](evidence/website_qa_2026-10-18/desktop-transactions.png).
Relevant implementation: [FinancialTable](../services/frontend/user-webpage/src/FinancialTable.tsx).

### Q13 Add an account recovery path

**Reproduce:** Open Sign in and look for help when the password is forgotten.

**Observed:** The screen offers email, password, Sign in, and Create an account, but no password
recovery route. Creating another account does not recover an existing company membership.

**Improve:** Provide Forgot password and a complete recovery flow, including expired-link handling.

**Acceptance:** An existing user can start recovery from Sign in and return to their original account.

Relevant implementation: [LoginPanel](../services/frontend/user-webpage/src/LoginPanel.tsx).

### Q14 Explain the currency scope of inventory sales ordering

**Reproduce:** Open administrator Inventory across marketplaces and choose Sales · last 90 days →
Highest first.

**Observed:** Native JPY and USD values are ordered without conversion: `148,916.00 JPY` appears
above `39,464.78 USD`. The sample has ten non-null JPY sales values and thirteen USD values. The
no-conversion explanation is in the caption about **2,675 px** down the table, below the initial
1,000 px-high desktop viewport. The ranking follows the documented policy but can look like a
comparable measure of sales performance before the user reaches that qualification.

**Improve:** Explain raw-currency ordering in the sort menu or near the column heading. Offer a
currency/marketplace scope or separate groups when ranking sales. Currency conversion is not required.

**Acceptance:** Users understand the comparison basis before applying or reading a cross-market sales order.

Evidence: [sales-order observations](evidence/website_qa_2026-10-18/observations.json).
Relevant implementation: [InventoryTable](../services/frontend/user-webpage/src/InventoryTable.tsx).

### Q15 Explain activity eligibility inline

**Reproduce:** Open Finances and inspect Included and Exclusive under Activity eligibility.

**Observed:** The heading and introductory sentence do not explain the rule. Exclusive records get
more explanation only after opening details. Eligibility is independent of maturity and current-version
selection, so Included can easily be read as included in a payout or currently paid funds.

**Improve:** Label the concept Activity totals and provide a short help explanation: original activity
counts once; linked releases and bank transfers remain exclusive. Explain retained versus current
versions separately, and consider an eligibility filter for administrator investigations. Preserve the
requested Exclusive terminology. No duplicated-amount defect was established by this review.

**Acceptance:** The distinction is understandable without leaving the table or reading technical docs.

Relevant implementation: [view-model](../services/frontend/user-webpage/src/view-model.ts),
[RowDetail](../services/frontend/user-webpage/src/RowDetail.tsx).

### Q16 Explain display rounding without changing arithmetic

**Reproduce:** In Financial review → Data Kiosk category → July 2026/USD, add the ten displayed
Data Kiosk source type amounts.

**Observed:** They sum to `-8,555.75 USD`, while the total displays `-8,555.76 USD`. Both are correct:
the total uses exact source values and each display is rounded independently. There is no nearby
explanation, so a manual check can appear to reveal a one-cent error.

**Improve:** Add a brief note that displayed rows are rounded while totals use original precision.
Keep two-decimal display and exact storage/calculation; do not add balancing rows or alter amounts.

**Acceptance:** The one-cent display discrepancy is explained at the total without changing its value.

Evidence: [exact and displayed sums](evidence/website_qa_2026-10-18/observations.json).
Relevant implementation: [decimal formatting](../services/frontend/user-webpage/src/decimal.ts).

### Q17 Identify unsaved membership choices

**Reproduce:** In User access, open a Company A member, select Company B without saving, then reload.

**Observed:** The pending Company B selection survives, while the header still shows Company A.
The enabled Save membership button is the main clue that the selector is unsaved.

**Improve:** Label the saved assignment Current company and visibly mark a changed selection as
Unsaved change. Retain F5 persistence and the existing explicit save/revocation controls.

**Acceptance:** A returning administrator can distinguish current access from a local draft immediately.

Relevant implementation: [CompanyMembership](../services/frontend/user-webpage/src/CompanyMembership.tsx).

### Q18 Support navigation to a specific workspace view

**Reproduce:** Switch between Transactions, Finances, and Inventory, or open a report, and inspect
the address and browser history.

**Observed:** The path remains `/` and tab switches add no history entry in Chromium or WebKit.
The document title remains Administrator · A-SelBox. Local persistence restores F5, but copying the
address cannot communicate a particular tab, month, currency, or report to another authorized user.

**Improve:** Introduce stable, permission-checked routes or URL state for useful view selections,
with Back/Forward support and a tab-specific title. Keep unfinished fee drafts private to the local
session rather than putting them in URLs.

**Acceptance:** A shared report link opens the intended view for an authorized account, and navigation
history works without discarding drafts or weakening role checks.

Evidence: [navigation observations](evidence/website_qa_2026-10-18/observations.json).
Relevant implementation: [FinanceWorkspace](../services/frontend/user-webpage/src/FinanceWorkspace.tsx).

### Q19 Keep context and next actions available in long views

**Reproduce:** Read to the bottom of 100 Transactions rows; scroll a long payout or Financial review
drawer; separately keep a draft after editing a lower-list SKU in Current fees.

**Observed:** These workflows share a loss of orientation or next-step access:

- At the bottom of 100 rows, the page is scrolled **3,562 px**. Headers, Search, and the sole
  pagination control are above the viewport; no buttons remain in view.
- In a long payout, company/date scope scrolls away while the sticky title only says Selected row
  details. Financial review similarly retains Monthly financial review while the selected month
  and month navigation scroll away. Currency column headings and individual record dates remain
  available; the missing context is the report or comparison being inspected.
- After keeping a draft for a lower-list SKU, Review changes (1) is **1,358 px above the viewport**.
  The local Draft badge is visible, but the next action is not.

**Improve:** Keep table headers visible and repeat pagination below main tables. Put company,
month, currency, and category where appropriate in persistent drawer headings. Keep a compact
pending-changes bar reachable in Current fees. Preserve one natural vertical scrolling area.

**Acceptance:** Users can identify the current scope and continue the task from the bottom of a
long view without scrolling several screens back to find controls.

Evidence: [bottom of 100 rows](evidence/website_qa_2026-10-18/transactions-long-page.png),
[task measurements](evidence/website_qa_2026-10-18/usability-observations.json).
Relevant implementation: [FinanceDataset](../services/frontend/user-webpage/src/FinanceDataset.tsx),
[RowDetail](../services/frontend/user-webpage/src/RowDetail.tsx),
[CurrentFees](../services/frontend/user-webpage/src/CurrentFees.tsx).

### Q20 Make summary actions visible

**Reproduce:** Look at Latest month before hovering or clicking. Click its underlined date, then
click the surrounding card. In the initial state, look for a way to select dates in Selected dates.

**Observed:** The visible date link filters Transactions; a different, full-card button opens the
type breakdown. That button has an accessible name but **no visible text**. The initial Selected
dates card says Select a date range to see totals without providing a date-range control there;
the entry point is the Date column menu below the cards. Both functions work once discovered.

**Improve:** Add a small visible View by type or View details affordance to populated cards, and a
Choose dates action to the empty Selected dates card. Clearly distinguish viewing a breakdown
from applying the period to the record table. Keep the whole-card shortcut if useful.

**Acceptance:** The user can identify both actions from the initial screen without experimenting
with blank areas of a card or searching table headings for the date control.

Evidence: [summary actions](evidence/website_qa_2026-10-18/summary-actions.png),
[button and interaction observations](evidence/website_qa_2026-10-18/usability-observations.json).
Relevant implementation: [SummaryCard](../services/frontend/user-webpage/src/SummaryCard.tsx),
[EstimatedSummaries](../services/frontend/user-webpage/src/EstimatedSummaries.tsx).

### Q21 Let payout search recognize visible month names

**Reproduce:** In Payout reports, search for `July`, then replace it with `2026-07`.

**Observed:** July returns no results; the ISO value returns **15 reports**, although the table
displays July 2026. The placeholder says Report name or currency, but the generated report name
being searched is not a visible table column. The dedicated Month filter works separately.

**Improve:** Match the displayed month/year as well as the canonical date value, or make the common
month selector prominent and make Search's scope unambiguous. Avoid requiring knowledge of hidden
generated report names.

**Acceptance:** A user can find a displayed month using its displayed label, with consistent results
across the search and month-filter paths.

Evidence: [payout search observations](evidence/website_qa_2026-10-18/usability-observations.json).
Relevant implementation: [payout search configuration](../services/frontend/user-webpage/src/api/config.ts).

### Q22 Guide effective-date fee changes

**Reproduce:** Edit a SKU with several existing fee periods and schedule a new US rate from a
future date, while retaining the old rate before that date.

**Observed:** In the checked 11-period editor, the existing US rate is Period 4 and the new blank
entry becomes Period 12. The user must choose the new marketplace, rate, and start date, then find
the old period and set its exclusive end date to the same boundary. The scroll content is about
**1,755 px** high inside **848 px** of available space. Validation correctly catches overlap; the
inconvenience is manually coordinating the two records and remembering the boundary.

**Improve:** Offer Change rate from date on an existing marketplace period. Collect the new rate
and effective date, then preview the proposed old/new periods together. Preserve inclusive starts,
exclusive ends, exact rates, validation, and the draft/review/final-save process.

**Acceptance:** A routine future rate change can be prepared without manually locating and editing
two distant period cards. Existing historical rates remain unchanged outside the intended range.

Evidence: [fee task measurements](evidence/website_qa_2026-10-18/usability-observations.json).
Relevant implementation: [SkuConfigurationEditor](../services/frontend/user-webpage/src/SkuConfigurationEditor.tsx),
[SkuFeePeriodEditor](../services/frontend/user-webpage/src/SkuFeePeriodEditor.tsx).

### Q23 Distinguish missing inventory coverage from an empty selection

**Reproduce:** Open Inventory as a member and choose Amazon.de in Marketplace.

**Observed:** The menu offers all 24 marketplaces. Amazon.de shows 0 inventory items and No
inventory matches these filters, with no coverage explanation. A read-only capture-header check,
which also includes completed empty captures, finds captures only for Amazon.com and Amazon.co.jp.
The UI does not say that German inventory has not been imported. It also does not explicitly claim
zero stock, but the generic result leaves the user to work out why nothing is available.

**Improve:** Mark marketplace coverage in the selector or empty state. Distinguish No imported
capture, No assigned items, and No filter matches where the user's permissions allow it. A complete
empty capture must remain distinguishable from missing data.

**Acceptance:** A user can tell whether changing filters could produce results or whether source
coverage is missing, without asking an administrator to inspect the database.

Evidence: [coverage observations](evidence/website_qa_2026-10-18/usability-observations.json).
Relevant implementation: [Inventory](../services/frontend/user-webpage/src/Inventory.tsx).

### Q24 Keep active inventory filter values visible

**Reproduce:** Apply Inventory health status = Out of stock and Recommendation = Edit listing,
close the menus, then reload.

**Observed:** The selected words are absent from the visible page. Each heading only shows a count
of 1, and the empty result offers Clear inventory filters. The selections survive F5, but users
must reopen both menus to discover the combination. The count indicators are also hidden from
assistive technology, and header accessible labels do not describe the active values.

**Improve:** Show removable filter chips above the table, following the Transactions pattern.
Include the active values in accessible descriptions. Keep Clear all, but also make clearing one
constraint possible without reopening its menu.

**Acceptance:** After menu closure or F5, users can read the active health/recommendation criteria
and remove either one directly. Screen-reader users receive the same filter-state information.

Evidence: [filters after reload](evidence/website_qa_2026-10-18/inventory-hidden-filters.png),
[filter-state observations](evidence/website_qa_2026-10-18/usability-observations.json).
Relevant implementation: [InventoryTable](../services/frontend/user-webpage/src/InventoryTable.tsx),
[ColumnMenu](../services/frontend/user-webpage/src/ColumnMenu.tsx).

## Behaviors to preserve

- Financial review stays within one currency and full mature months. Year/currency selection survives F5.
- Monetary displays use two decimals, while sums retain exact values and zero-amount rows remain visible.
- Inventory health and recommendation ordering use urgency. SKU links open Transactions with the exact SKU filter.
- The two live members see four workspace tabs and only their assigned inventory: 27 and 16 items versus 48 for the administrator.
- Member account-directory reads are denied; the administrator-only Financial review read returns no rows for members.
- Fee prefix autocomplete, company/member navigation, and unfinished drafts on F5 work in the desktop walkthrough. The editor footer stays visible across the checked desktop, tablet, and phone widths.
- Tables remain within the document and provide horizontal scrolling when needed. The audit found no document-level overflow in the inspected states.
- Financial review chart keyboard navigation and the previously repaired drawer-closing behavior remain covered by passing checks.

## Suggested order of work

1. Address payout status and inventory freshness, and decide the fee-validation scope policy.
2. Fix fee dismissal/focus, currency fallback, and offline feedback.
3. Make common controls and active filters visible; retain context and next-step actions in long views.
4. Improve financial investigation links, comparison layout, desktop monetary visibility, and effective-date fee editing.
5. Add recovery and navigation flows, then refine the explanatory labels and draft indicators.

Selected screenshots and sanitized measurements are retained in
[the QA evidence directory](evidence/website_qa_2026-10-18/). Full exploratory captures and browser
scripts remain in ignored local output. No credentials or private preview-entry links are included
in the retained report or evidence.
