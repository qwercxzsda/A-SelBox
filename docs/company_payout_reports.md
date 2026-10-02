# Monthly company payout reports

Payout reports freeze one company and one full calendar month, aggregating every
source namespace and separating only currencies. A company/month with no known
currency still produces an aggregate of zero without inventing a currency.
The month end must be strictly before `mature_cutoff_date`, calculated from the
database UTC date and `mature_cutoff_months = 2`. The
[source policy](source_allocation.md) defines the boundary and applies identically
to mature live reads.

The database generates reports automatically. Administrators browse every company's
saved reports and filter by company/month; members read only their own headers,
authoritative components, and marketplace totals. Neither role creates reports.
Each known currency report includes a marketplace breakdown. Saved comparison rows,
account reconciliation, and input manifests remain administrator-only in the month's
**Saved report snapshots** section of [Financial review](financial_review.md).

The default list uses `public.latest_company_payout_reports`, which selects the
newest saved report per company, month, and currency. The complete
`public.company_payout_reports` table retains earlier versions for history.

## Automatic generation

The `company-payout-reports` pg_cron job runs every five minutes and processes up to
10 pending, mature company/months whose retry time has arrived. A partial index on
`private.payout_report_refresh_state` selects work where `requested_revision` is
greater than `completed_revision`. Completed months are not recalculated on each
run. The schedule is a worker cadence, not a five-minute freshness guarantee;
a large backlog can need several runs.

Source and terms publications mark affected months pending in the same transaction,
once the complete publication is validated. Ordinary source changes conservatively
mark the changed calendar months for every company. Changes to source scope can
also affect other months: a new marketplace, a new historical seller/SKU relationship,
or pruning its last retained evidence can change coverage or saved manifests.
Those cases request broader checks. Ownership and fee changes include old and new
owners and other companies whose manifests depend on the changed terms. Raw archive
acquisition and inventory captures do not request payout work.

The worker also advances a small maturity frontier in the same table: each company
keeps a pending future month, and newly mature months are added without rechecking
completed historical months. Failed older work does not stop the frontier advancing.
A company with no refresh state is initialized from known financial history once;
historical backfills extend that range. The start includes Settlement posting dates
and processed coverage, processed Data Kiosk days, saved reports, and existing
refresh state. It can precede company creation and produce zero reports for companies
with no activity. With no financial history or refresh state, no start month is
invented. Saved reports and refresh state preserve older months after source pruning.
An idle run performs indexed frontier lookups per company and checks the pending index;
it does not resolve financial inputs or validate coverage for completed reports.
Historical source discovery is needed when initializing new companies, and broader
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
or outdated reports. All currencies for one company/month succeed atomically, including
deferred integrity checks. Incomplete Data Kiosk coverage, unresolved ownership,
missing fees, or invalid inputs block that month and are retried with backoff.
Other months can still complete. The worker includes every
currency in current data or previous reports for that company/month.
A company with only Data Kiosk costs has a valid scope. Previous currencies remain when
their amounts disappear; with no known currency, the company/month itself is the scope.

`public.payout_report_policy()` is read-only and returns `mature_cutoff_date`,
`latest_month`, and `mature_cutoff_months`. Saved results refresh in the browser
through lightweight company-scoped `payouts` revision checks; unchanged report reuse does
not rotate the token. There is no public generation RPC. The private worker and
internal publisher use calculation version `v1`, independently of the source
`preprocess_version`. The publisher discovers source namespaces, settlements, and
required seller/marketplace pairs; callers cannot restrict a report to a namespace
or choose its source versions. Preprocessing must be compatible within each
namespace. Separate namespaces can use different preprocessing versions, retained
through their pinned input manifests.

## Comparing estimates and saved reports

Select the same company, full mature calendar month, and currency to compare a
live estimate with its latest payout report. With complete coverage, resolved
ownership and fees, and automatic generation caught up to the current inputs,
their company amount, source amount, service fee, amount types, and contributing
records agree across all source namespaces. SKU or marketplace filters narrow
an estimate and no longer represent the whole company report.

Estimates use current inputs; reports freeze the versions used when saved. A
source or fee change can therefore change an estimate before the scheduled worker
captures the new report. The previous saved report remains available during that
interval. Recent dates can also differ because the live source-authority policy
has not yet reached maturity. The two views use the same amount-by-type and record
layout so their monetary results can be inspected in the same way.

Both drawers start with **Total** (Reported amount, Service fee, Company amount),
then **Amounts by type**, then **Records**. Selecting a category or Type's record
count narrows the records below; **Show all records** clears that selection.
Records share date, SKU, marketplace, source, Type, quantity, and amount columns,
with 50-row pages. The report's marketplace breakdown is a secondary expandable
section. The Total and Amounts by type use the same amount columns; the breakdown's
total row repeats the complete sum so category subtotals can be compared with it.
Saved comparisons, account reconciliation, and processing metadata are available
in the administrator's [Financial review](financial_review.md#saved-report-snapshots).

`public.payout_report_totals(p_report_id, p_group_by_type, p_limit, p_offset)`
returns the same exact-string amount and count fields as `transaction_totals`.
Grouping by Type combines all namespaces and marketplaces in that report.
The total and contributing-record count include every authoritative row, including
zero amounts. A zero amount does not change a row's authority or turn it into a
comparison row. Ownership, coverage, and applicable fee rules still apply.
Totals always cover the complete report, independently of the loaded record page.

## Empty aggregates

Every report uses `COALESCE(SUM(...), 0)`. No matching monetary rows therefore
produce zero through the ordinary aggregation. This does not certify inactivity or
complete upstream acquisition/preprocessing. A zero total can also result from
amounts that cancel each other or from authoritative zero-amount rows; those
reports retain their component rows and ordinary coverage requirements.

A scope containing authoritative company rows requires every day in each declared
Data Kiosk marketplace, including when its total is zero. A scope without those rows
uses available processed inputs without requiring complete day coverage. Missing
ownership, applicable fees, or invalid available inputs still block publication.
SKU-less Settlement controls in the Data Kiosk category do not. Validation applies
before both reuse and creation.

The declared coverage pairs use the company's discovered source namespaces. For
each namespace, they include marketplaces known from Data Kiosk days at any date
and named marketplaces on selected Settlement rows in the requested month. Each pair requires the
entire month's days, even if that namespace has no available inputs in the month.
A marketplace known only from historical Settlement rows outside the requested
month does not by itself add a required coverage pair. This preserves the existing
declared-scope policy without inventing seller/marketplace combinations.

Current and historical company SKU assignments identify every namespace containing
matching source facts; earlier reports preserve already captured source scopes.
An assignment has no namespace of its own. Available source versions, including processed empty days, and current terms
are retained as snapshot inputs. Unknown ownership within this source scope remains
an error. A company with no identifiable seller can have an empty input inventory.

If there is no known currency, the header's `currency` is null. Its totals are zero and it has no component or
account-reconciliation rows; available source/terms manifests can still be present.
A known currency remains in the header even when its aggregate is zero.

Later refreshes can save zero totals for a previous currency scope whose amounts
disappeared. Existing snapshots remain immutable.

## Reuse unchanged reports

Both publication paths compare only the latest report by save time for the same
company, currency, and calendar month. Reuse requires the same calculation version,
derived marketplace scope, and exact sets of selected Settlement, Data Kiosk, and
SKU terms versions across all namespaces. The pinned source versions retain their
individual preprocessing labels. The dataset is `economics`.

A pending request whose inputs still match adds no duplicate. A publication's UUID,
creation time, report name, or change reason does not force a new report; a reused
report keeps its original values for those fields.

If the latest report differs or does not exist, publication creates a new snapshot.
Changed input versions create a report even when totals are unchanged or an older
report matches. Concurrent matching requests serialize and return the same report.

## Company components

Preprocessing already assigns every monetary transaction to the Settlement
(`SETTLEMENT`), SelBox (`SELBOX`), or Data Kiosk (`DATA_KIOSK`) category. Publication
does not reclassify them. Saved company amounts combine:

- Settlement report amounts in the Settlement category, assigned through exact SKU ownership.
- Data Kiosk amounts in the Data Kiosk category, assigned through exact SKU ownership.
- Applicable signed service fees.

Only components marked `authoritative = true` contribute to report header totals.
Comparison and analysis components can retain source detail with null company/fee
contributions. The payout drawer's Records section shows authoritative rows from
both monetary sources. Administrators inspect non-authoritative comparisons in
**Financial review → month → Saved report snapshots**, selecting a saved company report.
The component table's row policy prevents company members from reading these
supporting rows even by requesting them directly through the API. Zero amounts
do not determine authority: authoritative zero rows remain ordinary payout
records. Values remain exact decimal strings in the browser and `Decimal` in Python.

## Marketplace breakdown

Each report's marketplace breakdown uses the read-only, security-invoker view
`public.payout_report_marketplace_totals`. It groups the report's frozen components
with `authoritative = true` by `report_id` and `marketplace_name`, returning exact
`source_amount`, `fee_amount`, and `company_amount` sums. It includes every matching
component, independently of which component page the browser has loaded.

A null marketplace remains one distinct group and is displayed as **Not specified**.
Summing each amount column across the marketplace groups reproduces the corresponding
report header total. Each currency report keeps its currency separate. A report with
no authoritative components has no marketplace rows. The view follows the saved report's access rules.

The header's `marketplace_names` is the distinct union of named marketplaces on
the saved authoritative company components. Coverage is checked separately for
every required seller/marketplace pair; empty day inputs remain in the pinned
manifests even when they add no marketplace to this monetary summary. The
breakdown also includes the separate null-marketplace group. SelBox amounts
and the reconciliation difference remain in the separate administrator-only account
reconciliation. The view derives its totals from saved components.

## Administrator financial review

[Financial review](financial_review.md) compares current mature source facts in the
Settlement, Data Kiosk, and SelBox categories. Each category groups months and currencies
across the entire account. Its source records explain the current type subtotals without
repeated company-report snapshots. Only the Data Kiosk difference is the accounting
reconciliation amount; the other category differences are diagnostic.

The month's **Saved report snapshots** section retains the selected report's comparison
rows and frozen account controls. Those controls can include other companies and currencies,
so their account scope stays separate from the report's company/month/currency scope.
`public.payout_reconciliation_totals` groups one snapshot by currency; optional daily rows
preserve source provenance. Report diagnostics remain exclusive of the company payout amount.

## Saved account reconciliation

For each seller, currency, day, and marketplace, save these exact amounts:

| Field | Meaning |
| --- | --- |
| `settlement_category_amount` | Settlement report amounts in the Settlement category |
| `selbox_category_amount` | Settlement report amounts in the SelBox category |
| `data_kiosk_settlement_control` | Settlement report amounts in the Data Kiosk category |
| `data_kiosk_category_amount` | Data Kiosk amounts in the Data Kiosk category |

The named fields keep the source and category distinct. Their relationship is:

```text
difference = data_kiosk_settlement_control - data_kiosk_category_amount
accounted_total = settlement_category_amount + selbox_category_amount
                + data_kiosk_category_amount + difference
                = settlement_total
```

One-sided groups are retained; a null marketplace is its own explicit group.
Amounts in the SelBox category and the difference remain with SelBox. The
administrator-only `public.payout_report_reconciliation` view exposes the frozen controls in
Financial review, labelled as account-wide context. The same account controls may
appear beside several company reports: never sum those repeated snapshots across
reports. Members cannot read them or the source manifests.

## Integrity and access

Reports, company components, reconciliation rows, and complete source/terms
manifests are immutable. Integrity checks verify provenance, exact sums, complete
inventories, and the reconciliation identity against frozen versions. A null currency
is restricted to an empty company/month aggregate. Publication locks company/month,
captures its related seller set, then locks seller/month and source days in order.
Source and terms publishers acquire a shared transaction advisory guard before
publication; the worker tries the exclusive guard and skips if a publisher or
another worker holds it. Publications that arrive during generation wait for the
worker to finish, then commit their changes and pending revisions together. This
lock order prevents publication/worker deadlocks. Capture and pruning use
`READ COMMITTED` and pin all referenced days, including empty ones. Privileged publication recreates its temporary work table
to prevent caller-owned temporary tables or triggers from running with its role.

Reassignment corrects mistaken ownership retroactively in live calculations and
future generation; it does not establish a dated transfer. Saved reports keep their
original company and amounts. Required unassigned SKUs block generation.
Member access follows the report's saved company and the member's current application
account. Approval, adjustments, currency rounding,
and payment execution remain separate features.

## Scheduler operations

Fresh installation registers the job in `cron.database_name`, normally `postgres`.
pg_cron permits only one extension database per cluster. An auxiliary database
installs the worker but emits a notice and does not register another schedule;
such a database needs its own explicitly configured scheduler to refresh reports.

The existing `private.payout_report_refresh_state` table holds the pending work;
no additional application table is needed. It is mutable operational metadata,
separate from immutable saved reports:

| Columns | Purpose |
| --- | --- |
| `company_id`, `month` | Identify one company and calendar month. |
| `requested_revision`, `completed_revision` | A larger requested revision means generation is pending. |
| `next_attempt_at` | Earliest attempt time, including retry backoff. Maturity is checked separately. |
| `failure_count` | Consecutive failures since the last success or changed inputs. |
| `last_attempt_at`, `last_success_at` | Latest attempt and latest successful generation or reuse. |
| `last_error_sqlstate`, `last_error_message` | Latest failure, cleared after successful generation or reuse. |

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
marketplace totals, unchanged-input reuse, concurrent publication, and retention.
Automatic refresh tests cover maturity discovery, targeted invalidation, idle runs,
blocked-month recovery, retry backoff, concurrent publication, and denied application
generation access.
Frontend tests run in Docker. The real-seed verification tool replays archived inputs into a
disposable database without deleting account-level charges or changing their categories.

```sh
conda run -n A-SelBox python -m services.db.supabase.tests.verification.payouts --help
```
