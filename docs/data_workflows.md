# Data workflows

Finances and Data Kiosk provide the financial inputs. Download and archive Amazon responses first;
preprocess successful acquisitions offline; publish complete daily versions atomically; calculate
company ownership and fees from selected source versions and current SKU terms. The scheduled payout
worker saves exact input versions and amounts when a company month becomes ready.

The separate [inventory workflow](inventory_daily_captures.md) retains one preprocessed capture per
seller, marketplace and day for approximate replenishment. Inventory never enters financial totals.

The [Finances contract](finances_transactions.md), [source allocation](source_allocation.md),
[company fees](company_fees.md), [payout contract](company_payout_reports.md), and
[query contract](transaction_query_contracts.md) define their respective calculations. The
[sync guide](../services/sync/README.md) owns executable commands; the
[database guide](../services/db/supabase/README.md) owns installation and verification.

## Persistence and naming

| Object                      | Meaning and policy                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Acquisition                 | One successfully archived Amazon retrieval and its complete request/page inventory. Immutable and retained indefinitely.            |
| Preprocess batch            | One complete offline publication from an acquisition. Owns all covered day versions.                                                |
| Day                         | Stable seller/marketplace/local-date identity with a selected `current_version_id`. Data Kiosk additionally identifies its dataset. |
| Preprocess version          | Immutable complete contents of one day, including an explicit empty result.                                                         |
| Native Finances transaction | Original API identity, signed control amount, status and lifecycle links within one version.                                        |
| Component                   | One member of the transaction's complete monetary partition, preserving source SKU evidence and native provenance.                  |
| SKU terms version           | Immutable company assignment and the complete marketplace fee inventory for an exact SKU.                                           |
| Payout report               | Immutable company/month/marketplace/currency amounts plus exact source, Summary-control and terms manifests.                        |

Successful acquisitions and preprocessing results are the only persisted acquisition/publication
states. Running and failed attempts use logs. Imports do not create SKU configuration, assign
companies, or invent missing rates. Derived service fees and company amounts are calculated from
source facts and terms; they are not copied into source transaction tables.

Both financial sources use `version_id` on children, `batch_id` on day versions, and
`current_version_id` on day identities. Finances components also have a composite
`(version_id, transaction_id)` foreign key to their native parent. Different daily versions may
contain the same Amazon transaction ID; a calculation selects one complete version per day.

The current shared processor definition is `PREPROCESS_VERSION = "v3"`. Source headers retain the
actual definition used. Changing parsing, classification, local-date interpretation or activity
selection requires explicit offline reprocessing. Compatibility requires the same definition on all
required financial inputs; filtering incompatible inputs out does not establish complete coverage.

Local objects use UUIDv7 identities. Financial observation order is separate: Finances uses capture
start time and acquisition ID; Data Kiosk uses root query creation time and acquisition ID. Replaying
an old acquisition never makes its Amazon observation newer. SKU terms use their own revision number.

## Download and archive

Finances retrieves `listTransactions` and date-range `listSummary` using API `2024-06-19`. Requests
span complete marketplace-local dates and are split at calendar-month boundaries. Transaction calls
remain regional and unfiltered by marketplace, account, status, order or SKU. The archived coverage
roster records every included financial marketplace and named time zone. Follow every continuation
token, including tokens on an empty page. A complete traversal is not an Amazon snapshot guarantee.

The Finances transport retains decoded HTTP response bytes before JSON parsing, avoiding floating
point conversion. Each transaction and Summary page stores its operation, page number, exact request
parameters, timestamps, terminal flag and safe API provenance. Failed transaction pagination cannot
publish a successful acquisition. A failed Summary retrieval leaves the completed transaction
capture available with an explicit unavailable control; it cannot establish payout readiness.

Data Kiosk retains the root query identity, definition, schema, marketplace, requested dates,
ordered page/query/document inventory and terminal status. Restricted queries and incomplete page
inventories cannot establish complete daily coverage.

### Compression and integrity

For each response document or page:

1. Preserve decoded bytes, encoding, whitespace and source order exactly. Remove declared transport
   compression before calculating the document digest.
2. Record byte length and SHA-256; compress as XZ using preset 2e and CRC64.
3. Verify the byte-for-byte round trip and record the archive digest and length.
4. Upload to private Storage before atomically publishing the successful acquisition manifest.

Storage and PostgreSQL have no shared transaction. A failed manifest publication can leave an
uploaded archive. Keep it for retry or investigation; no successful acquisition may reference an
unavailable object. Logs record safe identifiers, stages and exception types, without credentials or
response bodies. Raw archives and acquisition manifests are retained indefinitely.

## Finances preprocessing

Load and verify every archived page without contacting Amazon. Validate complete local-day coverage,
page continuation, declared markets and account types. Deduplicate identical repeated native IDs
within the acquisition; conflicting records with one ID fail the batch. Reject unknown monetary
paths and invalid amount partitions rather than guessing a category or inserting a balancing row.

For monthly activity:

- Include original `DEFERRED` and `DEFERRED_RELEASED` records.
- Include directly released financial events with no original/release relationship.
- Exclude linked release representations and `Transfer` records from activity amounts.
- Preserve every source record, including excluded records, zero values and source-native absent
  SKUs, for authorized inspection.

Use explicit `DEFERRED_TRANSACTION_ID` and reverse `RELEASE_TRANSACTION_ID` links. Equal SKU, order,
amount or timestamp is not a duplicate rule. A missing older original does not turn its release into
a new sale. Eligibility is stored with the immutable version and revalidated by publication.

Each native transaction has a signed parent total. Normalize a complete set of item breakdown
leaves and verify nested sums, item totals, currency and the transaction total. The parent is a
control, not another amount to add. Preserve SKU text exactly; only source-known product attribution
may support a company component. Unknown required SKU evidence blocks publication.

Partition by native marketplace and its IANA time zone into finished local dates. Publish headers for
every covered date, including empty days. Keep all account types and currencies in each day version;
filtering a diagnostic API response cannot replace a complete day. The
[Finances contract](finances_transactions.md) defines Summary reconciliation and native provenance.

## Data Kiosk preprocessing

Read complete archived acquisitions into daily versions, preserving native SKU, currency, fee
subperiod, quantities, component dimensions and source references. `(SKU, marketplace, day)` alone
is not a component key. Preserve sales, refunds, taxes, promotions, fees and credits without adding
parent and child representations of the same money. Missing amounts and quantities are not zero.

Validate signed sales equations, including `netProductSales = orderedProductSales -
refundedProductSales` and `netUnitsSold = unitsOrdered - unitsRefunded`. Negative refund values retain
their signs. Nonblank MSKU text remains verbatim. Unknown fees, missing required collections and
invalid equations fail before publication; acquisitions remain available for investigation.

Only dates preceding the root query's local creation date are complete. A verified empty day selects
zero children and removes previous current amounts. A SKU absent from the new complete observation
stays absent; it never falls back to an older row.

Classification is per component. Data Kiosk category components supply company costs at all ages.
Finances category components supply recent estimates and become comparisons on mature dates.
`ANALYSIS_ONLY` components remain diagnostic. Current DAY/MSKU queries require an MSKU; an account
component with an MSKU cannot silently become a SelBox charge. See
[known issues](known_issues.md) for source completeness and allocation limits.

## Atomic daily publication

Lock day identities in a consistent natural order, verify expected current selections, validate
complete child inventories and publish the whole batch in one database transaction. Failure leaves
all previous selections intact. Current totals read selected complete versions, not the newest
individual rows from a mixture of captures. Conflicting current locations for one seller-scoped
native Finances transaction ID are rejected.

A changed selected version rotates its source revision token and requests affected payout work.
The browser performs lightweight revision checks; unchanged checks do not reload financial facts.
Raw administrator source tabs show retained versions for inspection. Company Transactions and
Financial review use their current selected inputs and the source-allocation policy.

`postedAfter` selects posting dates, not modification dates. Discovering changes to an older day
requires another acquisition covering that day. The acquisition commands require explicit date
ranges. The payout scheduler uses published data; it does not download revised Amazon transactions.
Use complete calendar months for payout-eligible refreshes: a partial-month replacement makes the
previous whole-month Summary manifest stale until a complete month is captured again. The CLI
does not expand partial ranges implicitly.

## Retention and comparisons

Finances and Data Kiosk retain the latest three independent successful observations per day, current
versions, and every version pinned by a payout. Multiple preprocessing results from one acquisition
are one observation. Raw archives and manifests are independent of this payload-retention limit.

Compare complete normalized contents under one processor definition. Equal totals can conceal
changes. Finances comparison ignores incidental status and source-page metadata while retaining
activity eligibility and financial component contents. Agreement is diagnostic, not permanent
finality or proof that Amazon refreshed its internal data between captures.

Cleanup is explicit and reference-aware. Lock the day, recheck current and payout references, mark
the version pruned, then remove eligible parent/component payloads. Retain immutable version IDs and
original counts so a pruned version cannot look like a verified empty day. Report capture cannot
pin already pruned contents. Reprocessing retained archives creates a new result; it does not undo a
pruning marker on an old identity.

## Company terms and payout reports

An administrator publishes complete SKU assignments and marketplace fee periods atomically through
`publish_sku_configuration`. Validation covers each submitted SKU's complete configuration: it needs
an owner and coverage for every required fee date. Unrelated incomplete SKUs remain in global
diagnostics without blocking a valid batch. A known 0% rate is valid. New source imports can expose
new gaps without preventing valid source publication. Reassignment restates live history; saved
reports preserve the original terms versions.

Maturity keeps the existing two-calendar-month assumption. The private payout worker processes
pending mature company months on its five-minute schedule. A small indexed revision queue and a
maturity frontier avoid repeatedly scanning all saved reports. Source and terms changes request work;
companies with no current SKU assignments retain history but receive no new reports.

Generation validates exact Finances day coverage, matching Summary controls for the selected
versions, compatible Data Kiosk coverage and resolved company terms. It aggregates across source
namespaces, separately by marketplace and currency. Matching inputs reuse an existing result; changed inputs produce
an immutable report. Incomplete months retry with backoff. The browser does not generate reports.

Company cost authority stays with Data Kiosk for its category. Equality between Finances activity
and Amazon Summary does not certify Data Kiosk cost allocation. Approval, payment execution and
currency rounding remain separate work. See the [payout contract](company_payout_reports.md).

## Exact values and failure boundaries

Python `Numeric` uses exact finite decimal arithmetic with a 1,000-digit source bound. PostgreSQL
source numeric domains have no fixed scale. Over-bound source values fail without rounding. Fee
rates are 0–100 inclusive with at most six fractional digits; calculated fees and totals preserve
exact arithmetic. Finances quantities use exact numeric values. Missing quantities remain unknown.
Frontend financial responses use decimal text and apply server-side filtering and pagination.

| Failure                                      | Outcome                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Incomplete transaction retrieval             | No successful acquisition; uploaded evidence remains available.                                          |
| Summary unavailable or unmatched             | Explicit unresolved control; no invented zero or balancing amount; affected payouts remain unready.      |
| Invalid source parsing or component sums     | No partial day publication; preserve archives and prior current selections.                              |
| Stale concurrent publication                 | Reject the stale selection and retry against explicitly read current versions.                           |
| Missing ownership, fees or required coverage | Show the gap; reject complete financial publication for the affected scope.                              |
| Retention cleanup                            | Keep raw archives, current/payout-pinned versions and the distinction between pruned and empty contents. |

[Verification evidence](evidence/README.md) distinguishes native
Amazon checks, the implemented database pipeline and synthetic Auth/REST/browser regression tests.
