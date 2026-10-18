# Website QA implementation follow-up — 2026-10-18

This follows [the original website review](website_qa_2026-10-18.md), which remains the record of the
observed problems. The changes below address Q01–Q24. Implementation, regression tests, and the live administrator/member/unassigned walkthrough are
recorded separately below. Existing financial records and account passwords were preserved.

Desktop remains the primary layout. Targeted checks also cover tablet and phone layouts where noted.
This was an expert task walkthrough and regression exercise, not a novice-user study.

## Changes by finding

| Finding | Implemented behavior | Verification group |
| --- | --- | --- |
| Q01 — Payout readiness | A selected month shows company readiness: Pending, Updating, Blocked, Complete, No activity, Not scheduled, or Not mature. Administrators can inspect ownership/fee requirements and open the relevant SKU in Current fees. Members receive an explanation without administrator-only source details. Generation and retries remain automatic. | Financial investigation |
| Q02 — Inventory age | Rows and details show the stock date, or explicitly identify an unavailable stock date and the report date. Marketplace coverage lists source report dates. Dates older than two UTC days are marked overdue; recent preprocessing does not make an older report fresh. | Inventory |
| Q03 — Fee publication scope | A valid changed SKU can be published while unrelated SKUs remain incomplete. Every changed SKU must still have a company and all required fee coverage. A failure rolls back the entire submitted batch. Global setup diagnostics and payout readiness remain strict for their required scope. | Fee configuration |
| Q04 — Unfinished fee inputs | X, Escape, and backdrop closure keep unfinished forms separately from staged changes. Resume unfinished edit reopens them. Discard edits removes the unfinished form while retaining any earlier staged version. Only Keep draft includes a SKU in the subsequent review/save batch. | Fee configuration |
| Q05 — Fee focus return | Closing an editor returns keyboard focus to its opener, with the fee panel as a fallback when the original element no longer exists. Review/editor transitions retain the outside opener. | Fee configuration |
| Q06 — Summary currency | The chosen summary currency remains selected when filters remove its records. The card reports no matching activity in that currency instead of silently choosing another currency. | Shared workspace |
| Q07 — Summary/record scope | The control says Summary currency. Record Search has a records-only description, and an adjacent note explains that records include all currencies and that Search, Type, Source, and Fee rate filters do not alter the totals above. Existing summary scope labels remain visible. | Shared workspace |
| Q08 — Offline feedback | A workspace notice distinguishes previously loaded information from an uncached view waiting for connectivity. It labels the last successful application read, not Amazon capture freshness. Queries resume on reconnection. | Shared workspace |
| Q09 — Related fee families | Financial review offers explicit related fee families with Finances, Data Kiosk, and exact difference columns. Unpaired or uncertain types remain visible and included in source totals. Advertising/Sponsored Products are not asserted to be equivalent. | Financial investigation |
| Q10 — Source evidence navigation | Administrators can open the exact retained source component and version from a comparison row. Finances also supports exact Amazon transaction-ID lookup across retained captures. An unavailable version is reported as unavailable; another capture is not silently substituted. | Financial investigation |
| Q11 — Payout hierarchy | The expandable Marketplace breakdown sits after Amounts by type and before Records. Reaching it no longer requires scrolling through the record page. Zero rows and pagination remain intact. | Report inspection |
| Q12 — Desktop company amount | Transactions pins Company amount at the right edge on desktop widths of at least 1100 px. At 1440 px, the initial view exposes the SKU and company amount together while other columns remain horizontally scrollable. | Shared workspace |
| Q13 — Password recovery | Sign in offers Forgot password, a recovery-link request form, and a verified-link password-update form. Password confirmation and expired/invalid-link handling are included. The preview proxy, callback allowlist, and local mail capture are configured; a disposable account completed the real email/link/update/sign-in flow. Hosted delivery requires a mail provider. | Authentication |
| Q14 — Inventory sales currencies | Sales ordering explains that it compares original currency amounts without conversion, both in its ordering guidance and beside the sorted results. It directs users to one marketplace for comparisons. No exchange-rate conversion or ranking calculation was added. | Inventory |
| Q15 — Activity meaning | Finances explains original economic activity, held funds, linked releases, transfers, and directly posted released fees. Row details repeat the relevant exclusion explanation. Capture selection, maturity, and ownership remain separate payout eligibility rules. No new Activity filter was added. | Financial investigation |
| Q16 — Rounding explanation | Totals explain that each displayed amount is rounded to two decimals while totals use original precision. Displayed rows therefore may not add exactly to the displayed total. No balancing amounts or arithmetic changes were introduced. | Report inspection |
| Q17 — Membership drafts | Membership editing labels the saved Current company separately from Unsaved change. A restored draft company selection does not change access until Save membership succeeds. | Fee configuration |
| Q18 — Shareable navigation | Validated URL state preserves supported tabs, filters, paging, sorting, review scope, and report identity. Back/Forward and F5 restore navigation. Drafts, passwords, and session tokens are not serialized into workspace links. Administrator-only tabs remain permission checked. | Shared workspace |
| Q19 — Long-view orientation | Long main record lists retain visual column headings and offer navigation below the table. Payout/review headers retain their company/month/currency/category context. Current fees keeps its pending-change/review bar reachable after editing a lower-list SKU. | Shared workspace; Fee configuration; Report inspection |
| Q20 — Visible summary actions | Populated cards visibly offer View by type. Selected dates offers Choose dates or Change dates, opening the existing date-range editor. The period-label action continues to filter Transactions to that period. | Shared workspace |
| Q21 — Payout month search | Search matches the visible English month/year through a derived view column based on start_date, independently of report_name. Generated report-name/ISO-month and currency searches remain supported. Page and count queries use the same search condition and company access rules. | Report inspection |
| Q22 — Guided rate changes | Change rate from date previews one interval split, with the old exclusive end equal to the new inclusive start. The existing end is preserved. Choosing the existing start replaces that interval's rate without creating an empty period. Apply preview, Keep draft, review, and final save remain explicit. | Fee configuration |
| Q23 — Inventory empty states | Coverage distinguishes no imported marketplace snapshot, a valid empty capture, items unavailable to a member's company, and a filter with no matches. Snapshot coverage is checked separately from filtered inventory rows. | Inventory |
| Q24 — Inventory filter visibility | Removable chips show active search, marketplace, SKU, health, and recommendation values, including unavailable values. Chips survive F5; removing one preserves the other filters. | Inventory |

## Preserved behavior and boundaries

- Monetary values, fee rates, API payloads, storage, and calculations retain exact precision. Monetary
  displays remain two decimals, including zero and JPY. The rate-change helper preserves rate strings
  with up to six fractional digits.
- Fee batches remain atomic and use expected-version checks. The server rechecks administrator
  access after waiting for locks. Invalid changed SKUs and stale versions publish nothing. Unrelated
  gaps remain visible and can still block the financial scope that requires them.
- No manual payout-generation or inventory reload controls were introduced. Payout maturity, source
  authority, reconciliation arithmetic, and deferred cost-allocation decisions were not changed.
- Related fee families are diagnostic comparisons, not proof of equal billing periods, SKU
  allocation, coverage, or eventual convergence. Missing rows are identified; uncertain source
  equivalences are not filled in with assumptions.
- Source navigation reads retained normalized components and provenance. It does not promise access
  to a deleted payload or fetch a fresh Amazon transaction on demand. Multiple captures are separate
  observations and must not be added together.
- Read-only workspace links do not grant access. Backend authorization remains authoritative, and
  stored preferences are isolated by user, role, company, browser tab, and Supabase project.
- These UI changes do not repair the audited April ownership assignments, create approved fee
  rates, refresh an old inventory capture, or resolve the underlying Amazon source discrepancies.

## Confirmed automated checks

Counts below describe focused runs and may overlap; they are not a combined full-suite total.

### Fee configuration

- Nine disposable-database publication, validation, and concurrency tests passed. They cover a
  valid correction with unrelated ownership/fee gaps, invalid changed-SKU rollback, exact rates,
  and stale versions.
- The real Auth/PostgREST SKU workflow passed in its own disposable Supabase stack. It verifies
  denied member/unassigned writes, atomic invalid-batch rejection, valid changes despite unrelated
  imported SKUs, member visibility, exact zero fees, and optimistic version conflicts.
- Thirty-eight distinct focused Chromium scenarios passed across fee/member workflows and their
  shared regression files. Obsolete assertions that unrelated gaps must block publication were
  replaced with changed-SKU validation assertions.
- Eight new WebKit scenarios passed: X/Escape/backdrop recovery and focus, reload/resume, explicit
  discard, unnamed new-SKU input recovery, guided exact rate changes at 1440 and 390 px, and the
  reachable review action after a lower-list edit.
- Twenty-five targeted form, date-split, and storage unit tests passed. Guided splits cover ongoing
  and finite periods, same-start replacement, invalid/exclusive-end dates, zero rates, six-decimal
  rates, unchanged adjacent periods, and immutable input arrays.

Relevant tests: [publication](../services/db/supabase/tests/test_sku_configuration_publication.py),
[real REST workflow](../services/db/supabase/tests/e2e/test_sku_configuration.py),
[draft recovery](../services/frontend/user-webpage/tests/e2e/fee-draft-recovery.spec.mjs),
[rate planning](../services/frontend/user-webpage/tests/sku-rate-change.test.mjs),
[membership](../services/frontend/user-webpage/tests/e2e/company-membership.spec.mjs).

### Report inspection

- Nineteen targeted Chromium scenarios passed for payout hierarchy, month-name search for both
  roles, historical-version selection and F5, zero/currency-free reports, persistent review context,
  and existing native-scroll/focus restoration after closing nested drawers.
- Nine API/codec unit tests passed, including identical visible-month filters in payout page/count
  requests.
- The payout access database test passed with a custom report name: its derived month label still
  matches the report's start date. The owner and administrator can read it; another company's member
  and an unassigned user cannot.
- Reviewed screenshots confirm readable context at 1440 and 390 px. Payout section checks include
  1440 and 1920 px; report navigation also covers 834 and 390 px.

Relevant tests: [payout sections](../services/frontend/user-webpage/tests/e2e/payout-sections.spec.mjs),
[report navigation/search](../services/frontend/user-webpage/tests/e2e/payout-groups.spec.mjs),
[review context](../services/frontend/user-webpage/tests/e2e/financial-review-context.spec.mjs),
[scroll restoration](../services/frontend/user-webpage/tests/e2e/financial-review-scroll.spec.mjs),
[payout RLS](../services/db/supabase/tests/test_payout_report_access.py).

### Shared workspace

- The four original shared-workspace browser checks passed: stable currency/date entry,
  offline/reconnect feedback, desktop amount/header/footer visibility, and URL Back/Forward.
- Seven workspace-location unit tests passed, including preservation of an incoming saved-report
  link while its parent month queries are pending. The existing scoped saved-snapshot F5 case passed.
- Independent review reproduced a new navigation regression: after choosing Financial review
  JPY/2025/Finances, reloading Transactions and returning reset the scope. Scheduling React state
  before URL serialization fixed it. The maintained regression now passes; the existing
  Back/Forward/filter/Rows/F5 case also passed again.

Relevant tests: [shared workspace](../services/frontend/user-webpage/tests/e2e/qa-workspace.spec.mjs),
[URL codecs](../services/frontend/user-webpage/tests/workspace-location.test.mjs).

### Financial investigation

- Seventeen database tests passed across payout readiness, exact-source lookup, and Financial review
  access. Forty-four relevant frontend unit tests passed, including explicit family classification,
  exact differences, source selection, readiness decoding, and existing review/revision checks.
- Six new Chromium readiness/source-family cases passed. Three source/family scenarios also passed
  in desktop WebKit.
- These checks establish authorization, scope, and UI behavior with fixtures. They do not establish
  that Amazon's two sources contain equivalent amounts.

Relevant tests: [readiness database](../services/db/supabase/tests/test_payout_readiness.py),
[source database](../services/db/supabase/tests/test_financial_source_lookup.py),
[readiness browser](../services/frontend/user-webpage/tests/e2e/payout-readiness.spec.mjs),
[source/family browser](../services/frontend/user-webpage/tests/e2e/financial-source-review.spec.mjs),
[fee families](../services/frontend/user-webpage/tests/financial-review-families.test.mjs).

### Inventory and authentication

- Inventory: thirteen focused unit tests and twenty-five Chromium cases passed. Read-only checks of
  the actual capture/availability APIs also passed. The deployed walkthrough confirmed overdue
  October 3 reports, Germany with no snapshot, retained filters, and individually removable chips.
- Authentication: twenty-nine unit tests and twenty-seven Chromium authentication, signup, restore,
  and recovery cases passed. All eight WebKit recovery cases passed across the initial run and a
  targeted retry with an appropriate wait for the cold workspace load.
- Recovery checks cover a generic email acknowledgement, removal and server verification of callback
  credentials, keeping recovery separate from the company workspace, F5 without retaining password
  fields or replaying a password update, explicit update followed by sign-in, expiry/new-link handling,
  and callback handling within an already open page. The configured live preview also completed
  recovery for a temporary unassigned account, then removed that test identity. Existing users were
  not emailed and their credentials were not changed.

Relevant tests: [inventory coverage](../services/frontend/user-webpage/tests/e2e/inventory-coverage.spec.mjs),
[inventory details](../services/frontend/user-webpage/tests/e2e/inventory-details.spec.mjs),
[password recovery](../services/frontend/user-webpage/tests/e2e/password-recovery.spec.mjs).

## Live verification

The integrated build is served by the existing gated preview and isolated Finances preview database.
The updated fee publication function, readiness/source readers and grants, readiness revision trigger,
native-ID index, and latest-report month label were applied without resetting the database or changing
imported source data, company assignments, or fee rates.

- **Administrator:** April has two blocked company/months. Expanding one shows three missing-ownership
  SKUs and their requirements; selecting one opens Current fees with the exact SKU filter.
- **Fee correction:** a local rate edit on an already configured SKU reached an enabled Save all
  changes button despite eight unrelated incomplete SKUs. Closing returned focus; F5 and Resume
  retained the exact input. The draft was discarded. Real save/rollback/concurrency behavior was
  verified in disposable database/Auth stacks, not by changing the preview's business settings.
- **Financial review:** July/USD showed six related fee families and four unpaired types, with
  advertising and Sponsored Products separate. Finances and Data Kiosk source rows opened the exact
  retained version and preserved their detail after F5. One real native transaction-ID lookup returned
  six current components, each with its own exact detail; the components were not summed as captures.
- **Both company members:** readiness contained only the caller's company; administrator tabs were
  absent. Direct attempts to read source details, native-ID lookup, setup blockers or another company's
  readiness returned 403. The administrator comparison view returned zero rows to these members.
- **All three existing accounts:** visible July search, marketplace-before-records hierarchy, rounding
  guidance, and tablet/phone document-width checks passed. No JavaScript errors or business mutations
  were recorded. The denied member requests above were deliberate access checks.
- **Shared workspace:** the chosen JPY summary currency survived an empty marketplace scope and F5;
  Choose dates opened the range editor. Company amount stayed pinned at 1440 px and 100-row lists
  exposed navigation at their bottom. Inventory source dates and missing coverage were visible.
- **Recovery/unassigned:** a temporary account received a recovery message in the local mailbox,
  followed the public preview verification URL, displayed the verified password form, accepted one
  explicit password update, and signed in with the new password. It remained unassigned with no
  company data and was then deleted. Missing-token updates returned 401. The preview captures mail
  locally; it does not send external email. Hosted deployments require their own delivery configuration.

Sanitized machine observations: [financial walkthrough](evidence/website_qa_improvements_2026-10-18/financial.json),
[recovery walkthrough](evidence/website_qa_improvements_2026-10-18/recovery.json),
[final WebKit layout/scroll check](evidence/website_qa_improvements_2026-10-18/final-layout.json),
and [verification totals](evidence/website_qa_improvements_2026-10-18/verification.json).

Screenshots: [inventory freshness](evidence/website_qa_improvements_2026-10-18/inventory-desktop-viewport.png),
[desktop transactions](evidence/website_qa_improvements_2026-10-18/transactions-desktop-viewport.png),
[recovery completion](evidence/website_qa_improvements_2026-10-18/recovery-live-success.png),
[payout readiness](evidence/website_qa_improvements_2026-10-18/payout-readiness-desktop.png), and
[fee-family comparison](evidence/website_qa_improvements_2026-10-18/financial-review-families-desktop.png).

## Refactoring before commit

The final cleanup keeps the reviewed UI and financial rules while reducing repeated workflows:

- Callback restoration is separate from the main authentication hook. The callback module now covers
  both signup and password recovery by name. Internal recovery transitions are separate from guarded
  user mode switches, so a 401/403 response during a password update returns to the new-link form.
- The fee draft toolbar is shared as one component, and the editor hook owns resume/update behavior
  and resolves saved/staged baselines in one place. Unfinished inputs remain separate from staged changes.
- Inventory report ranges are grouped once per marketplace, retaining oldest/newest source dates and
  explicit unavailable dates. Shared lookup pagination preserves the same labels and next-page rules.
- The payout readiness query computes refresh/report flags once. It still reads bounded company/month
  metadata, and its applied preview definition returned the same April blocked statuses.
- Stale setup documentation was corrected: valid changed SKUs can be saved despite unrelated gaps;
  report generation retains the completeness requirements for its own scope.

The focused refactor checks passed 32 database tests, 29 authentication unit tests, 34 authentication
browser cases, 18 fee/inventory unit tests, and 25 fee/inventory browser cases. These counts overlap
with the combined suite below. The refactored frontend was activated on the existing preview;
read-only desktop checks reported no JavaScript errors or business writes.

## Final integration checks

- The final complete frontend check passed **317 unit tests and all 418 Chromium browser tests**
  in one run, together with Prettier, ESLint, TypeScript compilation and the production build.
  The browser suite completed in 7.5 minutes with no retries or remaining failures.
- **32 focused database tests** and the schema-contract check passed after refactoring. SQLFluff,
  Ruff lint/format, Markdown lint, 233 local documentation links, and diff-whitespace checks passed.
- Earlier integration caught two layout regressions: duplicated scope copy reduced desktop row
  visibility, and a taller drawer header overlapped sticky headings. Both were fixed while retaining
  the original desktop density/alignment assertions. The final suite includes a wrapped-header resize
  regression and visible-type-link keyboard/contrast checks.
- Cross-engine checks described above cover fee recovery and guided changes, financial source/family
  views, and password recovery in WebKit. Desktop, tablet and phone viewport checks passed. These
  are automated browser checks, not a claim of manual testing on every physical device.
- After the layout repairs, live desktop WebKit confirmed the table header starts exactly below the
  76.1875 px drawer header. Closing nested source details and the monthly drawer with X returned
  focus to the month opener, and wheel scrolling worked without an extra click or pointer move.
- The final refactored frontend and readiness reader were activated on the existing preview.
  Read-only desktop/API checks passed. Monetary calculations and source/fee data were not rounded
  or altered by this cleanup.

The database security advisor completed without error-level findings. It still reports five mutable
search-path warnings in pre-existing helper functions; the new readiness/source readers are not among
them. This review does not claim a full security audit or a novice-user study.

The original dated QA evidence remains unchanged. New raw runtime artifacts stay in ignored
`output/` and frontend `test-results/`; only selected screenshots and sanitized observations are
included in the documentation evidence directory.
