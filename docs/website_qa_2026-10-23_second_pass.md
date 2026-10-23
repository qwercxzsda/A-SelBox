# Second UI QA review — October 23, 2026

Reviewed `feat/settlement-to-transactions` from `87353c32`, following the
[earlier timed review](website_qa_2026-10-23.md). This pass started at
**2026-10-22 16:13:26 UTC / October 23, 01:13:26 in Seoul**.

## Method and scope

Four reviewers worked in parallel on shared accessibility, company and fee forms,
financial/inventory workflows, and source lookup/authentication/navigation. Findings
were reproduced through browser interactions or focused regression scenarios before
integration. Peer review checked interactions between the changes.

Hands-on browser work used synthetic administrator and member accounts, retained
source lookup, reloads and tab changes, summary dates, fee accordions and paging,
SKU links, inventory search, and narrow layouts. Responsive cases included 320px,
390px, desktop widths, and short 256–400px viewports. Keyboard checks included Enter,
Escape, Tab, modal focus return, and controls that become unavailable during loading.

All frontend commands ran in the pinned Playwright Docker image. Browser suites
used a shared lock and at most two workers. Synthetic responses exercised slow,
failed, empty, changed, and uncertain outcomes without changing production data.
The service credentials file was not read or modified. No backend policies, financial
calculations, schema, or dependencies were changed. Existing Data Kiosk evidence
changes were preserved separately, and `feat/user-webpage` remains untouched.

## Findings and fixes

P2 denotes a disrupted workflow, missing feedback, or keyboard-access issue. P3
denotes avoidable navigation effort; these priorities do not imply accounting errors.

| ID  | Priority | Reproduction                                                                                                                                                | Result after the fix                                                                                                                                                                                           |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01 | P2       | Page a detail table or Retry a failed detail request. The activated control disappears and focus falls to the page body.                                    | The labelled results group receives focus before the action; responses do not take focus from a different control.                                                                                             |
| Q02 | P2       | A source revision shrinks a later detail page while its record is focused. Automatic page correction removes the record.                                    | Focus is recovered only when the previously focused node was removed and no meaningful control owns focus.                                                                                                     |
| Q03 | P2       | A detail request completes with no records after its loading status.                                                                                        | Empty results now announce completion as a live status.                                                                                                                                                        |
| Q04 | P2       | Open a column filter inside Monthly financial review and press Escape on a checkbox or Close control. Both the filter and drawer close.                     | Escape closes the filter first and preserves its parent drawer.                                                                                                                                                |
| Q05 | P2       | Open Choose dates and inspect the icon-only close control.                                                                                                  | The button has the accessible name “Close summary dates.” The other drawer close controls were audited and already had names.                                                                                  |
| Q06 | P2       | Search inventory while its option catalog is delayed, or fail an uncached inventory page. The page shows no loading message or misleadingly says “0 items.” | Inventory distinguishes loading, unavailable, and confirmed counts. Existing search/request semantics are preserved.                                                                                           |
| Q07 | P3       | Page through a long readiness/setup list, then return to a cached page. The viewport remains at the bottom.                                                 | Explicit paging returns focus and scroll position to the relevant result section.                                                                                                                              |
| Q08 | P3       | Reach the end of a long payout report list. Paging requires returning to the top.                                                                           | A shared list footer provides Previous, Next, and Back to filters. Nested saved snapshots scroll below their measured sticky drawer header.                                                                    |
| Q09 | P3       | Browse 25 fee SKUs, including expanded fee periods, before changing pages.                                                                                  | The fee list uses the same footer. Page changes preserve expansions, drafts, search, and row size.                                                                                                             |
| Q10 | P2       | Use the review month buttons to reach the first or last available month. Native disabling removes keyboard focus.                                           | Guarded unavailable buttons retain focus, prevent duplicate activation, and are skipped by normal Tab navigation.                                                                                              |
| Q11 | P2       | Visit source lookup page 2, switch tabs or reload, then close a restored source record. Lookup returns to page 1.                                           | Lookup page position is saved alongside the transaction selection. A new search resets to page 1; an empty later page explains its scope and retains Previous.                                                 |
| Q12 | P2       | A loaded source record fails a background refresh. Its cached details hide the failure inside the open drawer.                                              | The drawer shows a local error, Retry, and an explicit last-loaded-record explanation.                                                                                                                         |
| Q13 | P2       | Retry initially unavailable source details, or retry a cached record that has since disappeared. Replacing the content loses keyboard position.             | Recovery focuses the loaded record heading or the drawer’s Close control when the record no longer exists. Keyboard navigation remains inside the drawer, and late responses respect focus moved elsewhere.    |
| Q14 | P2       | Submit failed sign-in/signup details using the keyboard. Feedback is shown but focus does not return to a useful correction point.                          | Result/error feedback receives focus, followed by Email on Tab. Values remain available after failure; signup confirmation also receives focus.                                                                |
| Q15 | P2       | Create a company or encounter a blocked deletion after its action disables.                                                                                 | Feedback receives focus when appropriate, without taking focus from a user who has moved to company search.                                                                                                    |
| Q16 | P2       | Open an invalid fee draft from review when the invalid field is deep in its period list.                                                                    | The first invalid field receives focus and scrolls into view, including later fee periods.                                                                                                                     |
| Q17 | P2       | Save membership, close the drawer, and reopen it while the request is pending. Save becomes available again.                                                | A per-user mutation tracks the existing request across drawer/tab instances and prevents a duplicate write. Confirmed completion clears the original draft.                                                    |
| Q18 | P2       | A membership save settles after navigation, conflicts with changed access, or completes after a different user’s save.                                      | The mounted editor observes the relevant pending operation; feedback survives keyed editor replacement and cannot be overwritten by another user’s late completion. No stale notice is replayed.               |
| Q19 | P2       | Press Enter on a SKU link in Current fees or Inventory. Transactions opens with focus on the body.                                                          | Cross-tab navigation focuses and reveals its destination tab. Initial mounting, browser-history scroll behavior, ordinary tab clicks, and restored-dialog autofocus remain intact.                             |
| Q20 | P3       | A fast count failure finishes between the cache-triggered request and the count observer enabling, causing a duplicate automatic request.                   | The observer does not reacquire an already failed count. Explicit Retry, a later source revision, and forced refresh remain available. The race was also reproduced on the original branch without StrictMode. |

## Refactoring and regression boundaries

- `ListPageNavigation` shares footer behavior and accessible labels across fees and payouts.
- `useActionFeedbackFocus` centralizes guarded feedback focus for company actions.
- `use-workspace-navigation-focus` replaces the history-only hook with a named navigation fallback.
- Membership mutations remain single-attempt operations, retain stale-write/API checks, and do
  not queue an offline replay. Tests cover reopen, tab return, conflict, uncertain response,
  retry, later revocation, and concurrent users completing in a different order.
- Source recovery has a stable focus boundary and checks the current focus before intervening.
- Successful short-height exploration confirmed that date validation, Type batch controls, and
  Done remain reachable; no unrelated layout rewrite was made.
- Cross-browser traces identified three test assumptions: viewport coordinates changed during
  legitimate scrolling, Firefox caps one oversized wheel gesture, and cancellation error text
  differs by engine. Test corrections preserve layout, focus, scroll-boundary, request-ordering,
  and single-refresh assertions. The count race was fixed in application code, with exact request
  counts retained and two additional recovery regressions.

## Verification before pre-commit refactoring

- Prettier, ESLint, TypeScript, the production build, and `git diff --check` pass.
- All **317 unit tests** pass.
- All **540 Chromium scenarios** pass on the QA-pass code in one complete two-worker
  run (**9.4 minutes**), with no retries. This includes **46 new scenarios** from this pass.
- **539 WebKit scenarios** pass, with one existing unsupported mobile-wheel emulation skip.
- **531 Firefox scenarios** pass. Nine existing mobile-emulation-only scenarios are
  excluded because Playwright does not support that Firefox context option; Chromium
  and WebKit cover those groups.
- The final affected-suite rerun passes **87 scenarios**, with the same one WebKit
  skip, in **2.6 minutes**. It verifies the count fix and all three test portability
  corrections in WebKit and Firefox; the complete final Chromium run covers them too.
- A deduplicated audit accounts for all **1,611 applicable browser cases**: **1,610
  pass**, one framework limitation is skipped, and **none remain failed**.

WebKit and Firefox coverage was completed across recorded runs and targeted reruns;
it is not a claim of one uninterrupted pass. An explicit test-list resumed only cases
without a recorded pass after the initial broad WebKit run. Seven failures identified
three browser-specific test assumptions and the preexisting count race described
above. The corrected affected suites were then rerun. Firefox initially failed to
launch under the mapped host UID, before loading a page; the image's standard user
resolved that environment issue without changing application code.

Verification completed at **2026-10-22 18:01:05 UTC / October 23, 03:01:05 in Seoul**.
The old `feat/user-webpage` worktree is clean. Preexisting Data Kiosk evidence is
excluded from this change and was stashed separately during commit preparation.

## Pre-commit refactoring — October 23, 2026

- Shared `revealSection` keeps explicit list navigation's focus-before-scroll behavior
  consistent across source lookup, readiness, setup, reports, fee lists, and review sections.
- `NavigationStepButton` shares the guarded unavailable-button behavior between page
  and review-month navigation without changing their focus policy.
- `DetailPagination` separates paging presentation from detail request feedback.
- `RowDetailContent` separates loaded record rendering from drawer lifecycle and focus recovery.
- `useMembershipSaveFeedback` isolates mutation observation and result messages from
  membership mutation, persisted drafts, and cache updates. The observation tracker still
  belongs to the drawer so it survives editor remounts.

These changes introduce no dependencies or API behavior changes. Independent review checked
the preserved labels, refs, keyed children, callback order, and pending-save ownership.

Pre-commit browser checks also reproduced a source-record loading race: an error response
could settle before the drawer mounted its feedback content, leaving “Loading source
record…” visible indefinitely. `FinancialSourceRecord` now subscribes to query status
during its own render so the drawer receives current feedback. A deterministic regression
pauses the opening animation until the request settles; it failed before the fix and
passes afterward. This brings the added browser scenarios to **47**.

Pre-commit validation:

- The complete frontend check passed after the structural refactors: formatting, lint,
  **317 unit tests**, TypeScript, production build, and **540 Chromium scenarios** in
  one two-worker run (**9.6 minutes**).
- Focused WebKit and Firefox checks passed **134 cases** and exposed two WebKit failures
  caused by the source-record race described above.
- After the race fix, all **39 source-workflow cases** passed across Chromium, WebKit,
  and Firefox, including both previously failing cases and the new deterministic regression.
- Formatting, lint, all **317 unit tests**, TypeScript, and the production build passed
  again on the final application code. The build retains its existing chunk-size warning.

Pre-commit logs are retained in the ignored
`services/frontend/user-webpage/output/qa-refactor-commit-2026-10-23/` directory.
The final source-workflow result is recorded under
`services/frontend/user-webpage/test-results-qa-fast-source-error-fixed/`.

Local logs and screenshots are retained in the ignored
`services/frontend/user-webpage/output/qa-pass2-2026-10-23/` directory. New regression
files cover detail keyboard behavior, nested column menus, short viewports, source
restoration, authentication feedback, company recovery, pending membership, deep fee
validation, inventory status, fee/payout list navigation, and month navigation. Existing
SKU navigation and signup cases were strengthened with focus checks.

## Limits

This review covers expert usability and browser regressions with synthetic responses.
It does not establish production data correctness, email delivery, physical mobile
interaction, screen-reader speech output, or production load capacity. Browser engines
run on Linux; WebKit coverage is not a certification of every Safari/iPhone version.
