# Monthly company payout reports

Payout reports freeze one company, one full calendar month, and one exact marketplace,
aggregating every source namespace within that scope. Currencies remain separate amount units;
they never identify a marketplace. New reports require at least one currently assigned SKU.
An eligible company/month with no monetary scope produces a zero report with no marketplace
or currency invented.
The month end must be strictly before `mature_cutoff_date`, calculated from the
database UTC date and `mature_cutoff_months = 2`. This controls publication eligibility only.
The [source/category policy](source_allocation.md) supplies the same amounts for live and saved
reads of the same revisions, independently of activity age.

The database generates reports automatically. Administrators browse every company's
saved reports and filter by company/month/marketplace; members read only their own headers,
authoritative components, and Type totals. Neither role creates reports. Saved comparison rows,
source diagnostics, and input manifests remain administrator-only in the month's
**Saved report snapshots** section of [Financial review](financial_review.md).

The list uses `public.latest_company_payout_reports`, which selects the newest saved report per
company, month, nullable `marketplace_name`, and currency. A null marketplace is a distinct
**Not specified** scope.
Search matches the displayed month/year, report name, marketplace, and currency. The view derives
`month_label` from `start_date`; company access is enforced by its invoker security and underlying RLS. The complete
`public.company_payout_reports` table retains earlier versions for history.

## Automatic generation

Company eligibility follows current SKU ownership, not membership or monetary
activity. A company without any currently assigned SKUs receives neither new
reports nor queued refresh work. Assigning its first SKU starts automatic generation;
removing its last assignment clears mutable refresh work and stops new generation.
Previously saved reports and their source evidence remain unchanged and readable.
A company with assigned SKUs but no activity remains eligible for zero reports.

The `company-payout-reports` pg_cron job runs every five minutes and processes up to
10 pending, mature company/months whose retry time has arrived. A partial index on
`private.payout_report_refresh_state` selects work where `requested_revision` is
greater than `completed_revision`. Completed months are not recalculated on each
run. The schedule is a worker cadence, not a five-minute freshness guarantee;
a large backlog can need several runs.

Source and terms publications mark affected months pending in the same transaction,
once the complete publication is validated. Ordinary source changes conservatively
mark the changed calendar months for every eligible company. Changes to source scope can
also affect other months: a new marketplace or a new historical seller/SKU relationship
can change coverage or saved manifests.
Those cases request broader checks. Ownership and fee changes include old and new
owners and other companies whose manifests depend on the changed terms. Raw archive
acquisition and inventory captures do not request payout work.

The worker also advances a small maturity frontier in the same table: each eligible company
keeps a pending future month, and newly mature months are added without rechecking
completed historical months. Failed older work does not stop the frontier advancing.
An eligible company with no refresh state is initialized from known financial history once;
historical backfills extend that range. The start includes Finances posting dates
and processed coverage, processed Data Kiosk days, saved reports, and existing
refresh state. It can precede company creation and produce zero reports for companies
that have assigned SKUs but no activity. With no financial history or refresh state,
no start month is invented. Saved reports and refresh state preserve previously discovered months.
An idle run performs indexed frontier lookups for eligible companies and checks the pending index;
it does not resolve financial inputs or validate coverage for completed reports.
Historical source discovery is needed when initializing newly eligible companies, and broader
scope changes can deliberately request historical work.

Changes advance the requested revision and clear retry delays. Successful generation
acknowledges the captured revision, so newer work cannot be erased by completing an
older request. No browser session or manual generation request is needed. Rapid
changes may be captured separately or combined before the next run; retaining every
intermediate state is not required. The latest valid state is eventually captured
while the scheduler continues running.

The database derives source scope and computes amounts. It accepts no calculated
client amounts or caller-selected historical versions. A company/month reuses
reports whose latest scope and input versions still match, and creates only missing
or outdated reports. All marketplace/currency scopes for one company/month succeed atomically, including
deferred integrity checks. Incomplete Data Kiosk coverage, unresolved ownership,
missing fees, or invalid inputs block that month and are retried with backoff.
Other months can still complete. The worker includes marketplace/currency scopes in current
company data or previous reports for that company/month. A company with only
Data Kiosk costs has a valid scope. Previously reported scopes remain as zero reports when their
amounts disappear.

`public.payout_report_policy()` is read-only and returns `mature_cutoff_date`,
`latest_month`, and `mature_cutoff_months`. Saved results refresh in the browser
through lightweight company-scoped `payouts` revision checks; unchanged report reuse does
not rotate the token. There is no public generation RPC. The private worker and
internal publisher use the same monetary formula as Transactions. The publisher discovers source
namespaces, current normalized versions and
required seller/marketplace pairs; callers cannot restrict a report to a namespace or choose its
source versions. The [saved-input contract](#saved-inputs) defines validation and retained references.
Trusted publication requires an explicit `marketplace_name` field, which may be null.
Missing marketplace metadata is rejected.

The eligibility rule also applies to trusted direct publication. The internal monthly
generator returns no reports for a company without current SKU assignments; the
single-report publisher rejects it with SQLSTATE `23514` and
`Payout reports require at least one currently assigned SKU`. Historical assignments
or previous reports alone do not make a company eligible.

## Comparing estimates and saved reports

Select the same company, full mature calendar month, exact marketplace, and currency to compare a
live estimate with its latest marketplace payout report. When the company has current SKU
assignments, coverage is complete, ownership and fees resolve, and automatic
generation has caught up to the current inputs,
their company amount, source amount, service fee, amount types, and contributing
records agree across all source namespaces. A SKU filter narrows the estimate further.

Estimates use current inputs; reports freeze the versions used when saved. A
source or fee change can therefore change an estimate before the scheduled worker
captures the new report. The previous saved report remains available during that
interval. If the company loses its last SKU assignment, its saved reports remain
historical snapshots and no longer track current estimates until a SKU is assigned again.
Recent activity follows the same source/category rule in Transactions, but its month is not yet
eligible for a saved payout. Both views use the same amount-by-type and record layout.

Both drawers start with **Total** (Reported amount, Service fee, Company amount),
then **Amounts by type**, then **Records**. Selecting a category or Type's record
count narrows the records below; **Show all records** clears that selection.
Records share date, SKU, marketplace, source, Type, quantity, and amount columns,
with 50-row pages. Payout drawer headings retain company, month, marketplace scope, and currency
while scrolling.
The Total and Amounts by type use the same amount columns; the breakdown's
total row repeats the complete sum so category subtotals can be compared with it.
Displayed amounts are independently rounded to two decimals; totals use original precision, so
adding displayed rows may not reproduce the displayed total exactly.
Saved comparisons, account reconciliation, and processing metadata are available
in the administrator's [Financial review](financial_review.md#saved-report-snapshots).

`public.payout_report_totals(p_report_id, p_group_by_type, p_limit, p_offset)`
returns the same exact-string amount and count fields as `transaction_totals`.
Grouping by Type combines all namespaces within that report's saved marketplace scope.
The total and contributing-record count include every authoritative row, including
zero amounts. A zero amount does not change a row's authority or turn it into a
comparison row. Ownership, coverage, and applicable fee rules still apply.
Totals always cover the complete report, independently of the loaded record page.

## Empty aggregates

An empty monetary aggregate is distinct from a company without assigned SKUs.
The former can produce a zero report; the latter is ineligible for new reports.

Every report uses `COALESCE(SUM(...), 0)`. No matching monetary rows therefore
produce zero through the ordinary aggregation. This does not certify inactivity or
complete upstream acquisition/preprocessing. A zero total can also result from
amounts that cancel each other or from authoritative zero-amount rows; those
reports retain their component rows and ordinary coverage requirements.

A scope containing authoritative company rows requires complete successful Finance coverage and
Data Kiosk day versions, including when its total is zero. Finance
preprocessing has already matched the required account/currency Summary controls before accepting
the batch. Empty successful observations require their own controls; missing Finance inputs are
not invented as zero.

A company with no identifiable source scope can still have an explicit empty
input inventory. Incomplete source coverage, unresolved ownership or missing applicable fees block
publication before both reuse and creation. SKU-less account controls never
create company ownership.

The declared coverage pairs use the company's discovered source namespaces. For
each namespace, they include marketplaces known from Data Kiosk days at any date
and named marketplaces on selected Finances rows in the requested month. Each pair requires the
entire month's days, even if that namespace has no available inputs in the month.
A marketplace known only from historical Finances rows outside the requested
month does not by itself add a required coverage pair. This preserves the existing
declared-scope policy without inventing seller/marketplace combinations.

Current and historical company SKU assignments identify every namespace containing
matching source facts; earlier reports preserve already captured source scopes.
An assignment has no namespace of its own. Available source versions, including processed empty days, and current terms
are retained as snapshot inputs. Unknown ownership within this source scope remains
an error. A company with no identifiable seller can have an empty input inventory.

With no monetary scope, the header has null `marketplace_name` and `currency`.
Its totals are zero and it has no component or
diagnostic source scope; available source/terms manifests can still be present. A known
marketplace/currency remains in its header even when its aggregate becomes zero. A null
marketplace with a known currency is a distinct unspecified-marketplace monetary scope.

While the company remains eligible, later refreshes can save zero totals for a
previous marketplace/currency scope whose amounts disappeared. Existing snapshots remain immutable.

## Saved inputs

Publication selects current source versions after checking successful period coverage, ownership,
fees and compatible Finance/Data Kiosk preprocessing labels within each seller namespace. Label
checks include successful empty Finance coverage. The [Finance preprocessing contract](finances_transactions.md#activity-and-summary-validation)
owns component, lifecycle and Summary validation; payout generation does not repeat those checks.

Each report directly references immutable contents through three manifests:

| Table | One row identifies |
| --- | --- |
| `payout_report_finances_versions` | `report_id`, `transaction_id`, `version_id` |
| `payout_report_data_kiosk_versions` | `report_id`, `day_id`, `version_id` |
| `payout_report_terms_versions` | `report_id`, `sku_id`, `terms_version_id` |

Source references cover the report's marketplace and month across its selected sellers, including
versions that contain no company monetary rows. Terms references preserve the ownership and fees
used to resolve those inputs. Batch membership remains source-processing history.

The header's `source_coverage` stores validated intervals with source, seller, marketplace, start
date and end date, including successful empty retrievals. Intervals are merged and sorted; they
contain scope metadata only. Frozen reads use these intervals and version references independently
of current selections, later retrievals, preprocessing labels or the moving maturity cutoff.

The header freezes the reported amount, service fee and company amount. Its `component_count`
records the complete number of derived records, including administrator-only supporting rows.
Record pages and Type breakdowns are calculated from the saved revisions when requested.

## Reuse unchanged reports

Both publication paths compare only the latest report by save time for the same
company, calendar month, marketplace, and currency. Reuse requires the same scope
and exact sets of Finance transaction-version IDs, Data Kiosk day-version IDs and SKU
terms-version IDs across all namespaces. The dataset is `economics`.

A pending request whose inputs still match adds no duplicate. A publication's UUID,
creation time, report name, or change reason does not force a new report; a reused
report keeps its original values for those fields.

If the latest report differs or does not exist, publication creates a new snapshot.
Changed source or terms revisions create a report even when rounded totals are
unchanged or an older report matches. Downloading or preprocessing again with unchanged normalized
versions reuses the latest report. Batch IDs, observation IDs and preprocessing labels are not
part of report identity. Concurrent matching requests serialize and return the same report.

## Company records

Preprocessing already assigns every monetary transaction to the Finances
(`FINANCES`), SelBox (`SELBOX`), or Data Kiosk (`DATA_KIOSK`) category. Publication
does not reclassify them. Saved company amounts combine:

- Finances activity amounts in the Finances category, assigned through exact SKU ownership.
- Data Kiosk amounts in the Data Kiosk category, assigned through exact SKU ownership.
- Applicable signed service fees.

Company records are calculated on demand from the saved source and terms revisions, using the same
formula as current Transactions. They are limited to the header's exact marketplace
and currency. The complete required source and terms manifests remain pinned for validation;
they are not narrowed to only the rows contributing money to this report.
Only components marked `authoritative = true` contribute to report header totals.
Comparison and analysis records expose source detail with null company/fee
contributions. The payout drawer's Records section shows authoritative rows from
both monetary sources. Administrators inspect non-authoritative comparisons in
**Financial review → month → Saved report snapshots**, selecting a saved company report.
The records RPC prevents members from reading these
supporting rows even by requesting them directly through the API. Zero amounts
do not determine authority: authoritative zero rows remain ordinary payout
records. Values remain exact decimal strings in the browser and `Decimal` in Python.

## Administrator financial review

[Financial review](financial_review.md) compares current native source amounts and opens saved
reports through the month's **Saved report snapshots** section. The selected report retains its
calculated supporting rows and exposes the account diagnostics below. Its source accounts can include
other companies; those diagnostics are separate from the company's frozen payout.

Saved links require the report ID, company, dates, currency, and `reportMarketplace`.
An empty marketplace value explicitly selects the unspecified scope; omission is invalid.
Currency never supplies a guessed marketplace.

## Account reconciliation from saved inputs

Reconciliation is a frontend diagnostic. The backend's `report_source_totals` function accepts a
report ID and grouping/paging options, follows its [saved inputs](#saved-inputs), and returns
additive source/category amounts, counts and coverage. It accepts no replacement references or
report-scope overrides. Each selected version is counted once.

The frontend uses the same exact-decimal comparison module for current and report data. For costs,
it subtracts Data Kiosk's `DATA_KIOSK` amount from Finances' `DATA_KIOSK` amount. Missing source values
become zero only when retrieval coverage establishes a covered empty scope; otherwise the UI keeps
an unavailable comparison. Currencies and source scopes remain separate. No diagnostic row or
formula is stored in the financial schema or inserted into the transaction ledger.

Saved report headers and manifests remain immutable. Diagnostic reads do not overwrite the frozen
payout totals, change fees or ownership, or publish another report.
The [read contract](financial_review.md#read-contract) specifies aggregate fields, coverage,
revision tokens and complete daily comparison groups. Members cannot access these account-wide
aggregates or source manifests. The same accounts can occur in several reports; their diagnostic
amounts must not be added across reports.

## Integrity and access

Reports and complete source/terms manifests are immutable. Publication checks derived record counts
and exact monetary sums against those inputs before freezing the header. Administrator source-aggregate
readers return saved inputs without deriving reconciliation values. A null currency is restricted to
an empty aggregate. The worker, direct monthly generator,
and single-report publisher acquire the exclusive payout-input transaction advisory
guard before selecting sources and terms. The worker skips its run if the guard is busy;
direct publication waits. Source and terms publishers acquire the shared guard before
publication. Publications that arrive during generation wait for it to finish, then
commit their changes and pending revisions together. The guard preserves a stable input selection
and current assignment eligibility throughout generation. Capture uses `READ COMMITTED`.

Reassignment corrects mistaken ownership retroactively in live calculations and
future generation for eligible companies; it does not establish a dated transfer.
Saved reports keep their original company and amounts, including after the last
SKU is reassigned away. Required unassigned SKUs within an eligible company's source
scope block generation.
Member access follows the report's saved company and the member's current application
account. Approval, adjustments, currency rounding,
and payment execution remain separate features.

## Scheduler operations

Fresh installation registers the job in `cron.database_name`, normally `postgres`.
pg_cron permits only one extension database per cluster. An auxiliary database
installs the worker but emits a notice and does not register another schedule;
such a database needs its own explicitly configured scheduler to refresh reports.

`private.payout_report_refresh_state` holds the pending work as mutable operational metadata,
separate from immutable saved reports:

| Columns                                     | Purpose                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `company_id`, `month`                       | Identify one company and calendar month.                                        |
| `requested_revision`, `completed_revision`  | A larger requested revision means generation is pending.                        |
| `next_attempt_at`                           | Earliest attempt time, including retry backoff. Maturity is checked separately. |
| `failure_count`                             | Consecutive failures since the last success or changed inputs.                  |
| `last_attempt_at`, `last_success_at`        | Latest attempt and latest successful generation or reuse.                       |
| `last_error_sqlstate`, `last_error_message` | Latest failure, cleared after successful generation or reuse.                   |

The table and worker are DB-administrator capabilities, unavailable to application
roles. These read-only queries inspect progress and the schedule:

```sql
select company_id, month, requested_revision, completed_revision,
       next_attempt_at, failure_count, last_attempt_at, last_success_at,
       last_error_sqlstate, last_error_message
from private.payout_report_refresh_state
where requested_revision > completed_revision
order by next_attempt_at, month, company_id;

select jobname, schedule, active from cron.job
where jobname = 'company-payout-reports';
```

Each run returns checked, created, reused, and failed counts. Failures are isolated
by company/month and preserve any earlier successful report. Retrying begins after
five minutes and doubles after repeated failures, up to six hours. A source or terms
change resets the delay so corrected inputs can be processed on the next eligible
run. Successful months leave the pending index; they return only when another
change requests work.

## Verification

The disposable database suite covers category authority, exact boundary dates,
monthly eligibility, reconciliation, tenant isolation, immutable snapshots,
marketplace isolation, unchanged-input reuse, concurrent publication, and immutable source history.
Automatic refresh tests cover maturity discovery, targeted invalidation, idle runs,
first-SKU activation, last-SKU removal, assigned SKUs without activity,
blocked-month recovery, retry backoff, concurrent publication, and denied application
generation access.
Frontend tests run in Docker. The [database verification guide](../services/db/supabase/README.md#verification)
lists maintained disposable-database and Auth/REST checks, including independent payout-total oracles.

## Data Kiosk coverage for native channels

The [source-allocation contract](source_allocation.md#data-kiosk-coverage-for-native-channels)
defines the verified Data Kiosk coverage mappings. These affect required input coverage, while
reports retain each component's native marketplace and fee scope.

## Automatic report readiness

The payout list defaults to the latest eligible month and shows readiness for the selected month,
scoped to selected companies across all marketplaces. Financial review's saved snapshots follow its
selected review month; a recent month has no saved payouts until it becomes eligible.
Marketplace filters narrow the report list, not readiness. Statuses distinguish Pending,
Updating (new inputs pending while a previous report exists), Blocked, Complete, No activity,
Not scheduled (no current SKU assignment and no report), and Not mature. A zero-valued record still
counts as activity; No activity means the saved header's `component_count` is zero.

`public.payout_readiness(p_month, p_company_ids, p_limit, p_offset)` reads only bounded company,
refresh-state and report-header metadata. It does not scan financial history. Members can read only
their own company's status and receive generic setup/source/processing reasons without raw worker
errors or SKU identities. Administrators may expand a setup block using
`public.payout_setup_blockers(p_company_id, p_month, p_limit, p_offset)`. This on-demand query reuses
the generator's authoritative month/source/ownership/fee rules and preserves zero-value components.
It lists missing owner mappings or fee periods with affected dates and marketplaces. Selecting a SKU
opens its configuration; it does not publish ownership or fee changes.

The company-scoped payouts revision changes when refresh state changes, including
failed attempts with no report publication. Successful status reads stay cached until that token or
fee metadata changes; failed operational reads retry on automatic checks. The normal payout worker
remains responsible for creation and retries.
