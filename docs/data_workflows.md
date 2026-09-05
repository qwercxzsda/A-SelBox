# Data workflows and intended behavior

A-SelBox separates authoritative Settlement data, transient elaboration data,
rolling estimates, and administrator-managed fee rates. The boundaries are
deliberate: they determine what can be retried, replaced, or audited.
This document defines intended behavior. The [issue list](known_issues.md)
contains only unresolved problems and proposed solutions.

## Lifecycle summary

| Data class           | Source                                                | PostgreSQL policy                                   | Purpose                                            |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Raw Settlement       | Settlement V2 TSV                                     | Insert once; never update or delete                 | Lossless ground truth                              |
| Processed Settlement | Raw Settlement plus transient inputs                  | Append one immutable result set per successful run  | Typed, company/SKU-attributed ground truth         |
| Elaboration          | Data Kiosk, FBA Long Term Storage, FBA removal detail | Never stored                                        | Explain or allocate Settlement rows during one run |
| Provision            | Data Kiosk Economics                                  | Append atomic batches; explicitly prune old results | Estimate the requested recent window               |
| Company/SKU fee rate | Database administrator                                | Append effective-dated rows; never update or delete | Resolve ownership and Selbox contract rate         |

## A. Settlement ingestion

Workflow A queries the Reports API for `DONE` Settlement V2 reports created in
the last 90 days. It checks stored report and document identities before
downloading a body.

For each new report, Python decompresses and decodes the document, locates the
supported TSV header, and verifies exact row widths. It stores:

- the Reports API identity and time window;
- aligned marketplace IDs and names;
- the ordered TSV columns;
- the first data row as exact metadata text;
- every remaining row as an exact text array with its source line number; and
- a digest of the decoded document.

Parsing does not interpret dates, amounts, currency, quantities, taxonomy, or
blank values. The report and all content rows commit in one transaction. After
insertion, both are immutable.

An exact known report is skipped. Identity anomalies and operational failures
are written only to Python logs, so correcting the cause and rerunning A is the
recovery procedure.

## B. Settlement processing

Workflow B normally selects the oldest Settlement report that has no successful
processing log. An explicit report UUID bypasses that selection and enables
reprocessing.

The workflow converts the stored raw cells before acquiring auxiliary data.
Marketplace-name lookup uses the immutable ID/name pairs captured with the
raw report. A nonblank row marketplace name must match that stored mapping.
An unrecognized name aborts the whole run during preparation, before artifact
creation, auxiliary acquisition, or result persistence. The CLI error identifies
the source line as `source_line=N`, logs `code=UNRECOGNIZED_MARKETPLACE`, and
exits with status `1` without echoing the raw row contents. This applies to reports
with either one or multiple marketplaces. A blank name uses the report's sole
marketplace ID when exactly one exists; otherwise its marketplace ID remains
unassigned. A row that references an ambiguous stored name-to-ID mapping also
fails validation; unused duplicate names do not block processing.

Every posting timestamp must fall within the Settlement header's start and end
instants, including both endpoints; timestamp comparisons account for source
time-zone offsets. Each posting's native calendar date must also fall within
the header's inclusive date window used for daily Data Kiosk acquisition.
Source dates are preserved, so this separate date check rejects offset-related
calendar spillovers even when the timestamp itself is within the header period.
An invalid row fails processing with its source line number before auxiliary
downloads or result persistence; raw ingestion continues to preserve source text.

Matching retains the earliest through latest posting dates within that validated
header window. Data Kiosk acquisition can cover additional days in the header
period without making those days eligible for matching.

The workflow derives the smallest auxiliary source set required by the report.
It may fetch:

- Data Kiosk Economics;
- FBA Long Term Storage Fee Charges; and
- FBA removal-order detail for disposal or removal evidence.

Long Term Storage (aged-inventory), disposal, and removal charges use only
FBA report evidence. Data Kiosk observations for these categories cannot be
used for Settlement allocation, even when fetched for other charges. A
successful FBA acquisition with no eligible observations leaves the charge
unassigned; partial FBA evidence leaves the unmatched amount as a residual.
Acquisition and parsing failures still abort processing. Data Kiosk remains
the auxiliary source for the other categories configured to use it.

Within one Settlement report, removal/disposal charges with the same removal
reference are combined across posting dates and order/shipment references.
Category, currency, and marketplace boundaries remain separate. Matching FBA
rows supply the SKU breakdown and must agree on one single-day `request-date`.
That request date becomes the group's representative date and the activity
date used to resolve each SKU's company and fee-rate version, even when Amazon
posts the charge months later. Original Settlement posting dates and references
remain preserved on the processed source entries.

Each matched FBA amount and quantity is allocated once within the report.
The difference between the Settlement group total and the FBA amounts remains
an unassigned residual on the same request date, preserving the Settlement
total exactly. Without matched FBA evidence, the whole group stays unassigned
on its latest Settlement posting date because no request date is known.
Conflicting or non-single-day removal request dates fail processing; they are
not replaced with posting dates.

The current source, request-date ownership, and marketplace-name validation
policies are recorded as `settlement-processing-v4`. Existing results retain
their original processing version until the report is explicitly processed again
in a new immutable run.

These inputs are processed in memory and written only to a local,
owner-readable artifact directory. PostgreSQL receives only the resulting
Settlement processing records.

Elaboration preserves source evidence: missing native fee dates are not
invented for allocation, zero-valued FBA charges do not create observations,
and negative FBA source charges fail validation. Aged-storage requests cover
closed calendar months. Unmatched evidence can leave an unassigned residual.

After loading the applicable company/SKU fee rates, Python builds the complete
processed result. One transaction inserts the processing log, typed report,
typed entries, and final results with direct foreign keys to their processing
log. If any step fails,
none of those rows commits.

Raw and processed Settlement batches queue inventory checks on parent and
child inserts. Writers keep these checks deferred until the complete batch is
present; forcing them earlier can reject an incomplete intermediate state.

Result amounts and quantities follow the [financial contract](#financial-values).

Every successful reprocessing appends another immutable result set. The default
read path selects one complete run per report by `processed_at DESC, id DESC`;
it never combines results from different runs or mutates an older run.
`processed_at` is the persistence transaction's start time, not its commit
time or the age of the Amazon evidence.

Concurrent workers may select the same oldest unprocessed report and append
independent successful runs. Duplicate acquisition and processing are intended;
there is no report claim or single-worker requirement. Explicit reprocessing
has the same append-only behavior.

### FBA report acquisition

FBA structural parsing recognizes quoted TSV cells, preserves their original
newline sequences, and records physical source line numbers. Malformed quoting
is rejected before business normalization.

Acquisition reuses a matching completed (`DONE`) report when available.
Otherwise it creates a report and polls the returned ID while Amazon reports
`IN_QUEUE` or `IN_PROGRESS`. Creation failure or a terminal `CANCELLED`/`FATAL`
status ends the attempt and is logged in Python.

The defaults are 120 polls and five seconds between pending checks: about ten
minutes of waiting plus API/retry time, not a wall-clock deadline. Reaching the
poll limit logs a timeout and aborts processing. Administrators can increase
`--max-poll-attempts` or `--poll-interval-seconds` for a later invocation.
Overlapping workers or a retry after timeout may create duplicate Amazon
reports. This is accepted; pending reports are not discovered or reserved,
and no persistent request coordination is maintained.
Only explicit SDK throttling responses (`429`) receive bounded retries;
other API failures end the attempt.

## C. Data Kiosk provision

Workflow C acquires and processes a complete Data Kiosk selection before
opening its database transaction. The database stores a successful processing
log and the resulting DAY/SKU provision rows.

The transaction is scoped by seller namespace, Amazon scope, and selected
marketplaces:

1. load the effective company/SKU fee rates;
1. insert a processing log recording every covered marketplace, including
   those with no results; and
1. insert the complete processed batch linked to that log.

The latest-result views select one log per seller/scope/marketplace using
`processed_at DESC, id DESC`, matching Settlement processing. `processed_at`
defaults to the persistence transaction's start time; this is neither commit
order nor a guarantee of Amazon source freshness. Readers should use
`private.latest_data_kiosk_provisions` rather than aggregate every retained
batch. A log covering an empty marketplace makes its current result empty.
An Amazon `NO_DATA` response is a successful empty result; an error response
fails the refresh and cannot replace a previous batch with an empty one.
Separate batches isolate concurrent refreshes. An acquisition that began
earlier but reaches persistence later can become current under this intended
ordering; neither the view nor retention tries to infer Amazon source freshness.

The date window selects acquisition input, not a partial update range.
Refreshing August for one marketplace makes only the August results current;
its older rows remain historical. No filter removes dates already covered by
Settlement reports, and no combined read API chooses between the sources.

The transaction rolls back as a unit, so a failed refresh preserves the
previous estimate. Logs are immutable, and results cannot be updated or added
after their log's transaction. The explicit
`private.prune_data_kiosk_provision_results` function retains the latest `k`
batches per marketplace, counting empty batches, and deletes older result
rows while preserving every log. Refreshes do not prune automatically; see the
[retention procedure](../services/db/supabase/README.md#provision-result-retention).
Each retained log's original result count remains audit metadata after pruning;
it is not required to equal the number of rows still stored. Increasing retention
later cannot recover deleted results.

For a default whole-scope refresh, configured marketplaces that are no longer
active are included in the log's coverage with no results. Their stale
estimates stop appearing in the current view after a successful refresh of
the remaining active marketplaces. If no marketplaces remain active, the
command fails and preserves the current provision selection.

## Company/SKU fee rates

The database administrator inserts immutable rows containing seller namespace,
marketplace, SKU, company, contract period, and percentage-point fee rate.
For each seller/marketplace/SKU/company, only the newest row by
`created_at DESC, id DESC` is current. A new row replaces that company's whole
earlier entry, even when the new period is narrower. Dates outside the new
period never fall back to an older version.
The creation timestamp defaults to the insertion transaction's start time.
An older timestamp does not become current merely because it commits later;
UUID breaks equal-timestamp ties consistently.

A row for another company does not supersede the first company's entry.
The database prevents overlapping current periods for different companies
with the same seller/marketplace/SKU. Fee history remains insert-only:
updates, deletions, and truncation are rejected.
The overlap check runs in the existing table on each insert and requires
`READ COMMITTED`, the default database isolation level. When ownership changes,
insert the previous company's shortened replacement before the new company's
period. Both inserts can share a transaction; the overlap check still applies
after each insertion.

Settlement processing and provision refreshes first select current fee entries,
then resolve the entry covering the activity date. If a processed SKU has no
applicable current fee, Python logs an error and aborts the run. No processing
log or result batch commits. The database itself does not enforce complete
fee coverage; this requirement belongs to Python. Historical results keep
their original fee references and amounts.
Coverage is checked for actual SKU allocation targets. Account-level and
excluded charges, or unmatched residuals without an assigned SKU, do not
require a SKU fee. If an auxiliary target spans multiple ownership periods
and no single current fee covers its interval, Python aborts; it does not
infer a split across companies.
A current Settlement run may still reference a superseded fee; this is
permitted, and an administrator decides when to reprocess it.

Python checks fee references after a successful fee publication or Settlement
processing commit. Only the newest processing log per report, ordered by
`processed_at DESC, id DESC`, is checked. Warnings identify report UUIDs whose
results reference superseded fees. They neither block successful inserts nor
trigger reprocessing. These post-commit checks do not audit unassigned results
or warn when a later fee entry could cover their activity; missing coverage is
logged during processing instead.
A failed advisory check logs an error without rolling back the committed data.
The [administrator procedure](../services/sync/README.md#fee-publication-and-advisory-checks)
also supports checking one run, one fee identity, or all current runs.
The fee selector checks the selected row's whole company identity, including
references to its earlier versions. Direct SQL fee inserts require an explicit
Python check after commit; the Python publication helper invokes it automatically.
Successful reprocessing clears the warning by making a new run current, while
retaining the old run. If a replacement leaves required activity uncovered,
reprocessing instead fails until applicable fees are supplied.

Both processing workflows use the fee snapshot loaded for that run. Provision
rows may therefore retain a superseded fee reference if publication overlaps
their refresh. The advisory checker covers Settlement runs only; administrators
refresh affected provision batches explicitly.

A zero-percent period remains a real ownership assignment and produces a zero
fee; it satisfies the coverage requirement.

The Selbox fee base is product sales and excludes refunds.

```text
selbox_fee = -(selbox_fee_base * fee_rate_percent * 0.01)
```

## Financial values

All typed financial values use Python `Numeric`, an immutable wrapper around a
finite `Decimal`. Its constructor enforces `NUMERIC_PRECISION_BOUND = 1000`
fixed-point digits, including zeros implied by the exponent and trailing
fractional zeros. Every addition, subtraction, or multiplication creates a new
`Numeric` with an exact result, independent of the active decimal context. An
over-bound result raises `NumericBoundError` at construction; values are never
rounded or quantized to fit. Workflow B logs this as `NUMERIC_BOUND_EXCEEDED`
and writes no successful processing run.

PostgreSQL independently enforces a fee-rate bound of six fractional digits
and the business range `0%..100%`, including copied applied rates. Trailing fractional
zeros count toward the database fee-rate bound. It rejects excess
precision instead of coercing or rounding it. This is the only application
precision bound enforced by the database; monetary columns remain
unconstrained `numeric`. Python applies only the much broader general Numeric
bound to fetched fee rates, so the two layers enforce separate constraints.

### Quantities and readers

Settlement results retain separate sales, refund, and fee categories. Every
potentially quantity-bearing result amount has its own nullable quantity:
`settlement_quantity`, `elaborated_quantity`, `difference_quantity`,
`selbox_fee_base_quantity`, `selbox_fee_quantity`, and
`company_payable_quantity`. Direct results preserve category-specific source
quantities; auxiliary targets carry quantities reported by their evidence.
Unknown quantities remain null, including residual allocations whose unit
population cannot be determined. An aggregate is unknown if any component
quantity is unknown. Direct source quantities also become unknown when a group
combines different transaction/amount-type/amount-description components.
Auxiliary targets sum the reported quantities of their matched observations;
they do not apply that direct-source component check. Source Settlement
quantities accept the nonnegative PostgreSQL `bigint` range; result aggregates
use `Numeric`.

The repository has no frontend or combined reporting API. Consumers should
choose their quantity metric, such as sales units, returned units, or their
difference, and calculate statistics with exact decimal arithmetic. A consumer must select one processing run and keep categories distinct;
summing quantities across sales, refunds, and fee components double-counts
units. Aggregations must preserve unknown quantities rather than silently
ignore nulls. Local JSON artifacts serialize `Numeric` amounts as exact decimal strings;
PostgreSQL drivers return `Decimal` values. A future API must retain that
precision, for example by returning decimal strings. A display approximation is never persisted as ground truth.

## Failure boundaries

- Workflow A commits one complete raw report at a time. One report's failure
  does not block later independent reports.
- Workflow B creates local artifacts before its final database transaction. A
  failure may leave those diagnostics, but it cannot leave a successful
  processing log or partial processed result.
- Workflow C performs Amazon work before its database transaction. A failure
  leaves no successful log or partial batch and preserves the prior provision.

All three workflows are one-shot commands. Scheduling and repeated backlog
draining belong to an external operator or scheduler.
