# Website usability QA — October 20, 2026

Reviewed `feat/settlement-to-transactions` from **cce47cfb**, including the newer Finances source,
yearly financial review, payout readiness, inventory coverage, URL navigation, password recovery,
and unfinished fee-edit recovery. Fixes in this review are applied to that branch's existing
worktree. This extends the
[October 18 implementation review](website_qa_improvements_2026-10-18.md).

## Method and scope

- Ran the current frontend in Docker with synthetic Auth/API responses from this branch's own
  fixtures. No production records, credentials, fee publications, or live passwords were changed.
- Directly inspected desktop and 390px phone layouts in the in-app browser, including populated
  transaction/source views, the yearly review chart and monthly drilldown, payout reports, inventory
  coverage and paging, tab changes, filters, and keyboard focus.
- Used focused browser regressions to reproduce defects, then checked the fixes alongside the
  existing draft, recovery, source lookup, family comparison, payout, offline, and URL-state tests.
- An independent code review checked the combined changes. Separate navigation probes found no
  selected-tab or URL rollback after a drawer closes; pointer clicks during its exit animation can
  still be intercepted by the closing overlay.

This is an expert walkthrough and regression review, not a first-time-user study.

## Findings and implemented fixes

P2 indicates task interruption, inaccessible feedback, or information that becomes hard to use. P3
indicates avoidable navigation or clarity friction.

| ID  | Priority | Reproduction and impact                                                                                                            | Implemented behavior                                                                                                                                                                                                                                                        |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U01 | P2       | Enter on a search clear button removes the focused control; subsequent typing does not reach the field.                            | A shared `SearchInput` restores field focus across table, company, fee, inventory, and option searches. Existing search descriptions and filters are retained.                                                                                                              |
| U02 | P2       | Keyboard removal of a financial, payout, or inventory filter chip loses focus, especially when it is the last chip.                | Typed refs return keyboard focus to the relevant search field while retaining unrelated criteria, search text, ordering, and page size. Pointer clearing does not focus an editable field.                                                                                  |
| U03 | P3       | Generic checkbox menus provide no obvious completion action or explanation of when changes apply.                                  | Every selection menu has immediate-apply guidance and a sticky Done button. Type's existing footer is shared with the other menus.                                                                                                                                          |
| U04 | P2       | Bottom Previous on a cached inventory page leaves the viewport at that page's last rows.                                           | Explicit page changes from below the list start scroll and focus the top pagination controls. Coverage information and URL page state remain intact.                                                                                                                        |
| U05 | P3       | Inventory's off-screen recommendation/health columns require horizontal gestures or reaching the bottom scrollbar.                 | The existing shared Left/Right controls are available near the table start, with boundary states and native scrolling retained.                                                                                                                                             |
| U06 | P2       | Activating inventory filters adds a clear-all button that squeezes the phone Marketplace control into a truncated label.           | Clear inventory filters occupies its own row on narrow screens. Individual chips and snapshot coverage retain their existing behavior.                                                                                                                                      |
| U07 | P2       | With platform fonts, selecting Payout reports at 390px changes the workspace tab bar from three rows to four; following tabs move. | Workspace tabs keep a constant font weight, preserving their widths while the active underline and color identify selection. Direct browser measurement confirmed identical positions after switching tabs. A fallback-font regression also reproduces the original defect. |
| U08 | P2       | Opening or cancelling membership revocation replaces the focused action and loses keyboard position.                               | Focus enters the confirmation and returns to Revoke membership after cancellation.                                                                                                                                                                                          |
| U09 | P2       | A successful membership save replaces its editor and loses focus.                                                                  | The saved-result message receives focus and Tab continues within the drawer.                                                                                                                                                                                                |
| U10 | P2       | Submitting an invalid new SKU after scrolling through periods leaves the blocking error above the visible area.                    | Validation focuses and reveals the SKU field and its error.                                                                                                                                                                                                                 |
| U11 | P2       | Phone fee forms leave too little width for marketplace and date values.                                                            | Period fields and the guided rate-change inputs use a single column at phone widths, keeping draft actions reachable.                                                                                                                                                       |
| U12 | P2       | Previewing a rate change with an invalid date/rate leaves focus on the Preview button.                                             | Focus moves to the first invalid input so correction can begin immediately.                                                                                                                                                                                                 |
| U13 | P2       | Exact percentage values such as `6.123456%` split across two or three lines in phone fee previews.                                 | Rate cells stay on one line; narrow tables use natural column sizing and compact padding. Dates and marketplace labels can wrap without splitting rates or overflowing the screen.                                                                                          |
| U14 | P2       | Password confirmation mismatch leaves focus on submit and lacks an associated invalid-field indication.                            | Confirmation receives focus, an associated inline alert, and explicit `aria-invalid`. Passwords still stay only in component memory and auth/session logic is unchanged.                                                                                                    |
| U15 | P3       | A financial-review type drilldown moves into source records with no direct return to the amounts.                                  | Back to amounts scrolls and focuses the amount section, preserving source/type/month/currency context. The amount section now uses the shared detail component.                                                                                                             |
| U16 | P2       | Clearing the selected financial-review type by keyboard removes the focused chip.                                                  | Focus returns to the Record source selector; other review context stays selected.                                                                                                                                                                                           |

## Existing newer workflows checked

- The Finances tab, retained-source lookup, and fee-family comparison continue to use their current
  source interfaces and category meanings.
- Year/currency selection, monthly/running differences, source-record drilldowns, and saved
  snapshots retain their scope and reload behavior.
- Payout readiness and setup blockers remain role scoped, including revision refresh.
- Inventory report age, stock age, no-snapshot versus empty-data messages, and original-currency
  sales guidance remain visible and covered by regression tests.
- Unfinished fee forms, resume/discard behavior, exact rate/date splitting, explicit staging,
  review, and save boundaries remain covered.
- Offline feedback, summary currency, read-only URL state, Back/Forward, and F5 continue to work.

## Validation

The final cleanup shares search fields and the filter-menu footer, gives password/SKU submissions
named handlers, derives membership-notice visibility once, and uses one helper for financial section
focus and scrolling. It also removes a redundant nullable recommendation-label check. These
refactors retain the interaction behavior described above.

- Prettier, ESLint, TypeScript, and the production build passed.
- All 317 unit tests passed.
- All 454 Chromium browser tests passed in the complete run with four workers.
- All 21 focused WebKit cases passed after refactoring, covering forms, financial-review navigation,
  inventory browsing, selection-menu completion, and tab stability with a fallback font.
- Added 36 browser regression cases across the new files and password-recovery suite.

The first complete run exposed a race in the existing payout-readiness test: it advanced its mocked
clock before the previous revision request completed. Its synchronization was corrected without
changing application polling or payout behavior. The corrected test passed 20 parallel repeats and
the final complete run.

The refactor checks also exposed mixed real and mocked timers in the existing inventory debounce
test. Installing the clock before application startup and settling query rendering with the clock
running preserves its exact debounce and immediate-reload assertions. The corrected test passed 20
parallel repeats without changing inventory application logic.

All frontend commands ran in the pinned Playwright Docker image. The final validation log and
reviewed screenshots are retained locally under the ignored
`services/frontend/user-webpage/output/ui-usability-latest/` directory.

New regression files:

- [Search focus](../services/frontend/user-webpage/tests/e2e/search-focus.spec.mjs)
- [Applied-filter focus](../services/frontend/user-webpage/tests/e2e/applied-filter-focus.spec.mjs)
- [Selection menu usability](../services/frontend/user-webpage/tests/e2e/selection-filter-usability.spec.mjs)
- [Forms and exact fee display](../services/frontend/user-webpage/tests/e2e/form-focus.spec.mjs)
- [Inventory browsing](../services/frontend/user-webpage/tests/e2e/inventory-browsing-usability.spec.mjs)
- [Stable workspace navigation](../services/frontend/user-webpage/tests/e2e/workspace-navigation-layout.spec.mjs)
- [Financial-review navigation](../services/frontend/user-webpage/tests/e2e/financial-review-navigation-usability.spec.mjs)

The existing
[password recovery suite](../services/frontend/user-webpage/tests/e2e/password-recovery.spec.mjs)
also includes the new mismatch regression.

## Limits

Synthetic responses establish frontend interaction behavior, not production data correctness,
external email delivery, or production API performance. Viewport checks do not certify physical
phone touch behavior or screen-reader speech output. The WebKit results are Playwright's Linux
engine, not a physical iPhone or native Safari certification. Existing accounting and
source-allocation questions are outside this UI follow-up.
