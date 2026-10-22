# Timed UI usability review — October 23, 2026

Reviewed `feat/settlement-to-transactions` from **789a49af**, following the
[October 20 review](website_qa_2026-10-20.md). This pass targets additional workflow failures rather
than repeating those earlier fixes. The review began at **2026-10-22 14:56:51 UTC** (23:56:51 in
Seoul); the closing time and validation totals are recorded below.

## Review method

- Parallel QA passes covered shared controls, forms, financial investigations, and recovery states.
  New issues were reproduced before implementation and checked again after fixes.
- Hands-on browser checks covered keyboard navigation, a long account identity at 320px, browser
  Back, sign-in/signup transitions, session-restore failure and Retry, unfinished fee edits, and
  native keyboard entry in the guided rate-change form.
- Automated scenarios exercised administrator/member restrictions, delayed and failed responses,
  stale or uncertain writes, long identifiers, narrow layouts, and short viewports equivalent to
  zoomed desktop layouts. Checks include Chromium and Playwright WebKit.
- All frontend commands ran in the pinned Docker image. The local UI used synthetic Auth/API
  responses. Production records, credentials, passwords, and database schema were not changed.
- The existing uncommitted Data Kiosk investigation files were left separate. This review makes no
  changes to `feat/user-webpage`.

## Findings and fixes

P2 means a workflow can lose input, hide necessary feedback, or interrupt keyboard operation. P3
means avoidable navigation friction. These priorities do not imply accounting errors.

| ID  | Priority | Reproduced problem                                                                                                                          | Implemented behavior                                                                                                                                                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01 | P2       | Next/Previous becomes disabled during a delayed page request and loses keyboard focus; pressing Enter again no longer continues paging.     | Pagination retains the focused control, marks it unavailable accessibly, guards duplicate activation, and excludes unavailable controls from normal Tab traversal.                                                                 |
| H02 | P2       | Escape in an edited page number closes its containing financial-review drawer before cancelling the draft.                                  | The first Escape cancels the page edit. A subsequent Escape retains normal drawer closing behavior.                                                                                                                                |
| H03 | P2       | Empty-result recovery removes its focused Reset/Clear button and strands keyboard users.                                                    | Transactions, payout reports, Companies, and Current fees return keyboard focus to search while clearing the intended criteria.                                                                                                    |
| H04 | P2       | Clearing filter selections or using Type Select/Deselect matches disables its own focused button.                                           | Focus moves to the menu search or first checkbox while the action applies. The menu stays usable without restarting keyboard navigation.                                                                                           |
| H05 | P2       | Invalid date ranges show a general alert without focusing or associating the invalid inputs.                                                | Date errors identify and describe the relevant fields, retain entered values, and focus the field requiring correction. Date handling was extracted into `DateFilter.tsx`.                                                         |
| H06 | P2       | Browser Back/Forward restores the correct tab or page but leaves focus on the page body.                                                    | A guarded history-only fallback focuses the restored workspace tab. Existing dialog autofocus and normal search/tab interactions retain control.                                                                                   |
| H07 | P2       | Editing, adding, or removing fee periods erases the entered guided rate/date.                                                               | Guided inputs survive related manual edits; affected previews are invalidated and must be reviewed again. Removing preceding periods adjusts the selected index; removing the targeted period clears that now-inapplicable helper. |
| H08 | P2       | Pressing Change rate from date again silently replaces an unfinished guided edit.                                                           | A second guided change cannot start until the current one is applied or cancelled.                                                                                                                                                 |
| H09 | P2       | Discarding a staged SKU in review removes the focused control.                                                                              | Focus moves to the next or previous draft, or Back to editing when no draft remains.                                                                                                                                               |
| H10 | P2       | At 320×320, the fixed review footer covers all proposed changes and the Complete SKU action.                                                | Short-height drawers use one scrolling body so content and actions are both reachable. Normal-height sticky actions remain intact.                                                                                                 |
| H11 | P2       | A membership conflict refresh remounts the form and erases its explanation; an uncertain write can misleadingly appear definitively failed. | Feedback lives above the keyed editor, survives refresh, and explicitly distinguishes uncertain outcomes from confirmed success. Backend authorization and atomic stale-write checks are unchanged.                                |
| H12 | P2       | Recovery-link results and password-update server errors lose keyboard position after the submit state changes.                              | Existing result/error feedback receives focus; entered values and explicit submission behavior are preserved.                                                                                                                      |
| H13 | P2       | Opening the first source record in a long table leaves loading/error/missing feedback below the entire table.                               | Selection immediately opens the same visible detail drawer for loading, retryable error, missing data, or success. Escape/close cancels selection and returns focus; late responses cannot reopen it.                              |
| H14 | P3       | Retained-source lookup paging is only below the list, and returning to a cached page leaves the viewport at its final records.              | Lookup results have top/bottom pagination, with focus and scrolling returning to the result start on explicit page changes.                                                                                                        |
| H15 | P2       | A supported 512-character transaction ID stretches the phone page to roughly 4070px.                                                        | The lookup identifier wraps within the phone viewport.                                                                                                                                                                             |
| H16 | P2       | A long SKU stretches a source-detail heading to roughly 2744px.                                                                             | Detail titles wrap inside the drawer without expanding the page.                                                                                                                                                                   |
| H17 | P2       | A failed second page of payout readiness/setup hides the pager, preventing a return to cached page one.                                     | Previous remains available when a later page fails, retaining a local recovery route.                                                                                                                                              |
| H18 | P3       | Switching between Sign in and Create account leaves focus on the toggle below the form, so the next Tab skips the inputs.                   | Focus moves to the new form heading; Tab proceeds to Email. This does not open a mobile keyboard automatically.                                                                                                                    |

## Successful exploration and limits of findings

- The long account identity fit at 320px without clipping Sign out or widening the page.
- Session verification failure presented Retry; after recovery, an unfinished 6.25% fee edit was
  still available through Resume unfinished edit.
- A guided 2026-10-01 / 7.125% change retained both values after adding another period and required
  a fresh preview. Native keyboard date entry was used during the hands-on check.
- Back/Forward correctly closed and restored date/month filter state; no stale uncontrolled-field
  fix was needed. Long-option menus remained usable at a 640×360 viewport corresponding to a zoomed
  desktop layout.
- Independent code review found no concrete regression in cancellation, history autofocus,
  unavailable-pagination guards, or fee-period index handling.

## Verification

The review and fixes ran for approximately **58 minutes**, from **14:56:51 to 15:54:45 UTC**
(October 22, 23:56:51 to October 23, 00:54:45 in Seoul), including the final verification.

- Prettier, ESLint, TypeScript, production build, and `git diff --check` passed.
- All **317 unit tests** passed.
- **494 Chromium scenarios** verified: 488 passed in the complete run, and the six failures under
  initial browser-load contention passed a one-worker rerun in 20.8 seconds.
- **38 focused WebKit scenarios** verified: 32 passed initially, and six execution timeouts passed
  the isolated one-worker rerun in 32 seconds.
- Added **40 browser regression scenarios**, each covering a reproduced behavior or a necessary
  boundary of the fix. Existing role, reload, cancellation, and financial checks remain included.

The concurrent integration runs overloaded the local browser environment; their failure details were
recorded. Serial reruns used the original timeouts and unchanged application code. The counts above
describe the review run plus those explicit reruns.

The pre-commit cleanup shares the guarded pagination step button, isolates history-focus recovery in
a dedicated hook, and simplifies fee-period index adjustment into a pure helper. Membership errors
narrow their API type once, and status-only detail panels no longer need a dummy null child. These
refactors preserve the behavior described in this report.

Pre-commit revalidation passed without retries: all 317 unit tests, all 494 Chromium scenarios in
one complete run (two workers, 8.4 minutes), and all 38 focused WebKit scenarios in a separate run
(two workers, 1.5 minutes). Formatting, lint, TypeScript, production build, and diff checks also
passed. Browser engines ran sequentially to avoid the earlier resource contention.

New regression coverage lives in:

- `auth-mode-focus.spec.mjs`, `workspace-history-focus.spec.mjs`
- `filter-recovery-usability.spec.mjs`, `filter-navigation-usability.spec.mjs`,
  `pagination-keyboard-usability.spec.mjs`
- `fee-editing-transitions.spec.mjs`, `fee-drawer-short-viewport.spec.mjs`,
  `membership-error-recovery.spec.mjs`, and additions to `password-recovery.spec.mjs`
- `financial-source-feedback.spec.mjs`, `financial-source-navigation.spec.mjs`,
  `payout-readiness-recovery.spec.mjs`, and their shared synthetic fixture

The local validation logs and selected before/after screenshots are retained under the ignored
`services/frontend/user-webpage/output/qa-hour-2026-10-23/` directory.

## Boundaries

This is an expert usability and regression pass, not a novice-user study, penetration test, or
production load test. Synthetic responses do not establish production data correctness or external
email delivery. Playwright WebKit runs on Linux; it does not certify physical iPhone touch behavior
or screen-reader speech output. The authentication review consulted the official
[password-flow documentation](https://supabase.com/docs/guides/auth/passwords) and
[session documentation](https://supabase.com/docs/guides/auth/sessions); no Auth API or schema
changes were needed.
