# Company ownership and fees

SQL calculates company amounts from complete source versions and selected SKU
terms. Correcting rates or reassigning a SKU restates live history without
reprocessing Amazon sources. [Frozen payout reports](company_payout_reports.md)
preserve previously published calculations; approval and payment execution are
not implemented.

The [workflow contract](data_workflows.md) owns acquisition, preprocessing,
version ordering, precision, and retention. The
[source policy](source_allocation.md) owns which Amazon source
supplies each component. The [database guide](../services/db/supabase/README.md)
documents executable interfaces and verification commands.

## Boundaries

Python stores validated source facts independently of company ownership and fee
coverage. PostgreSQL resolves ownership and calculates fees at read time; source
transactions contain no copied company, fee-rate, or payable values. Missing
business configuration does not prevent preprocessing, but it prevents complete
financial totals for the affected scope.

Both sources use the shared [`PREPROCESS_VERSION`](../services/sync/src/preprocess_version.py).
A strict combined read requires this exact name on every required selected source version. Marketplace
names join as exact `text`, validated against the same supported-name list in Python and database
`CHECK` constraints. Original API IDs
remain in source provenance. Queries accept explicit dates and apply the mature cutoff date
rule described in the source policy.

## Ownership and fee configuration

| Table                | Purpose                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `skus`        | Stable exact SKU identity and selected `current_terms_version_id`.                                         |
| `sku_terms_versions` | Immutable company assignment or explicit unassignment, revision number, reason, and complete fee inventory count. |
| `sku_fee_periods`    | Marketplace-specific effective periods and rates belonging to one terms version.                                  |

These tables live in `public`; trusted writers publish through
`private.publish_sku_terms(jsonb)`. Operators use the caller-checked atomic batch
`public.publish_sku_configuration(...)` REST RPC. UUIDv7 identifiers and audit times
are generated automatically. Administrators provide business terms and an
expected current version. `version_number` labels publications within one SKU;
the current pointer selects the revision. `company_skus` is an assigned-only
current projection view, and `current_sku_fee_periods` projects its selected
periods. Both views are read-only.

The **Current fees** screen lets administrators stage multiple assignment and fee changes,
review them, and save one complete batch. `public.sku_configuration()` includes imported-only
and unassigned SKUs for administrators, so incomplete settings can be repaired. Company members
receive only their own assigned SKUs and can inspect their fees and coverage without editing.

### Administrator completeness

Every administrator save must leave every known exact SKU assigned to a company. Known names
come from the SKU registry and both retained source histories, including names found only in
historical versions. A batch contains at least one changed SKU and a nonblank change reason.
Only changed SKUs are submitted, but unchanged incomplete settings also block a save. Each
changed SKU supplies a complete fee inventory and its expected current version; stale edits
and invalid batches publish nothing.

Required fee dates come from the selected current source versions:

| Source | Rows requiring coverage | Effective date |
| --- | --- | --- |
| Settlement | Category `SETTLEMENT`, transaction type `Order` or `Refund`, amount type `ItemPrice`, description `Principal` | `posted_date` |
| Data Kiosk | Category other than `SELBOX` with a nonnull `fee_base` | `activity_date` |

Both sources contribute requirements independently of today's maturity boundary, including
zero bases. Historical source versions contribute known SKU names but no required fee dates.
Coverage applies to each recorded marketplace/date; dates without qualifying activity need
no fee period. A 0% rate is complete coverage. Noncommission activity requires ownership but
does not require a fee. Separate adjacent periods may cover a requirement; overlaps are
rejected. Read diagnostics compress consecutive required or uncovered dates into half-open
ranges and identify missing companies separately.

This is validation of the configuration known when the batch is checked. Older incomplete
terms remain readable, and subsequent imports can introduce new SKUs or fee requirements.
These gaps appear on the screen and must be repaired before the next administrator save.
Source imports never invent an owner or rate. Saved payout snapshots remain unchanged.

### Stable identity and versioned ownership

`UNIQUE (sku)` establishes one stable identity across namespaces and marketplaces.
The selected revision assigns one company or explicit `company_id = NULL`.
Original nonblank SKU text is preserved verbatim, so padded and unpadded SKUs remain distinct.
The same exact SKU imported through different seller namespaces has one owner and one
selected fee revision. Namespaces remain source provenance; they never partition ownership.

The selected version must belong to that same SKU. The first publication
creates the identity and required first revision atomically; there is no dummy
initial owner and no automatic registration during source imports. Later
trusted publications may reassign or unassign the SKU while preserving identity and immutable
history. Administrator publications require complete ownership and coverage as described above.
There is no global fee-configuration version or ownership effective-date model.

The selected company is treated as the correct historical owner. Reassignment
corrects a mistaken assignment across all dates in live reads and future payout
generation; it does not represent a transfer effective from a particular date.
Saved reports retain their original company and amounts.

An assigned SKU with no fee periods still has ownership for noncommission expenses.
Unassigned source keys resolve as `MISSING_OWNERSHIP`, retaining a selected terms
reference when available. Required unassigned SKUs block complete financial totals
and payout generation; they are not silently omitted. Periods retained in an
unassigned revision are inactive.

### Publish complete terms across marketplaces

Select one complete SKU terms version before finding its effective period. Never
combine periods from different versions or fill current gaps from older terms.

| Version | Effective period          | Rate |
| ------- | ------------------------- | ---: |
| V1      | January 1 onward          |   5% |
| V2      | January 1 through June 30 |   5% |
| V2      | July 1 onward             |   7% |
| V3      | January 1 through June 30 |   6% |
| V3      | July 1 onward             |   7% |

With V3 current, June sales use 6% and August sales use 7%. V1 and V2 remain
immutable history. Each publication replaces the company's assignment and the
complete period inventory for every marketplace of that SKU. Omitted marketplace
periods lose coverage; published periods are not patched individually.

Periods are nonempty PostgreSQL `daterange` values with `[start, end)` bounds.
The lower bound is required; the upper bound may be unbounded. Overlaps are
forbidden within a version and marketplace, and allowed across different
marketplaces or versions. Rates are
exact finite percentages from 0 through 100 with at most six fractional digits,
including trailing zeros. Invalid precision is rejected without rounding.
[PostgreSQL range exclusion constraints](https://www.postgresql.org/docs/17/rangetypes.html#RANGETYPES-CONSTRAINT)
enforce nonoverlap.

An empty trusted replacement withdraws all coverage. An administrator can submit an empty fee
inventory only when that SKU has no required fee dates. An explicit 0% period provides coverage
and differs from a missing rate.

### Atomic publication

Publication locks the SKU identity and checks its expected current version, including
expected absence on first publication. It inserts the new version and complete
period inventory, validates the terms, and advances the current reference in one
transaction. It allocates the next revision number while holding the lock.
A stale edit or other failure preserves the previous selection.

Administrator batches acquire changed-SKU locks in exact text order and validate the resulting
whole configuration after all changes. Any missing ownership or required rate rolls back every
new revision and pointer update in the batch. The browser preserves drafts after rejections and
requires refreshed saved settings after a stale or unconfirmed write; it never retries publication
automatically. A failed display refresh after a confirmed save does not undo that save.

Published versions and child inventories are immutable: updates, deletions, and
additional child inserts are rejected. A deliberate reversion publishes another
version containing the desired terms. The service does not automatically retry
failed publications.

## Live read contract

A strict read selects the declared Settlement identities for mature dates and
Data Kiosk marketplace/day coverage for every date. It requires complete compatible
source versions and applies the source policy before calculating money.
It resolves SKU ownership independently of fee eligibility, then joins the
selected terms version and its marketplace period covering the source activity date.

Settlement commissions use only signed `Order / ItemPrice / Principal` and
`Refund / ItemPrice / Principal`. Normal negative refunds reduce the base without
another sign reversal. Shipping, gift wrap, taxes, promotions, and Amazon fees
are outside this base. The posting date of each row selects its rate; report end,
deposit, download, and preprocessing dates do not.

Recent Data Kiosk sales use validated `netProductSales`, preserving
`orderedProductSales` and signed `refundedProductSales` separately for analysis. The source requires
`net = ordered - refunded`, including negative refunds. Only the selected net component
supplies the recent commission base; mature dates use Settlement reports. Data Kiosk
comparisons in the Settlement category have null fee/company contributions and cannot add a
second commission. Costs in the Data Kiosk category remain authoritative and have no sales commission.

```text
fee_amount = -(fee_base * fee_rate_percent * 0.01)
company_amount = source_amount + fee_amount
```

Preserve each row's fee inputs when aggregating, keep currencies separate, and use
exact decimal arithmetic without currency rounding or a zero floor. Dashboard totals can
combine rows sharing the same fee inputs before fee lookup without changing the result. At 5%,
sales of 100 and refunds of 20 produce a fee of -4. Noncommission costs require
ownership but no rate. Fee-eligible zero amounts still require fee coverage.
Every ordinary Order/Refund row independently requires its explicit source
marketplace, including noncommission rows.

Dashboard page queries project current terms only for SKU keys on the selected page;
totals use keys in the already-filtered fact groups. Both retain left joins so missing ownership
and fee coverage remain visible as unresolved amounts. Member authorization separately uses a
caller-bound set of all currently owned keys; narrowing financial projection never narrows or
substitutes for the access check.

Refunds currently use their own posting-date rate. A sale of 100 at 5% followed
by a full refund at 7% produces fees of -5 and +7. The resulting over-credit is
[deliberately deferred](known_issues.md#deferred-refund-commission-over-credit-risk).
Live reads and frozen reports currently preserve that same formula.

### Missing configuration and diagnostics

| Situation                            | Rate                        | Fee        | Resolution          |
| ------------------------------------ | --------------------------- | ---------- | ------------------- |
| Known owner and required rate        | Selected rate, including 0% | Calculated | `APPLIED`           |
| Known owner, noncommission component | Null                        | Zero       | `NOT_APPLICABLE`    |
| Known owner, missing required period | Null                        | Null       | `MISSING_FEE`       |
| Company-relevant SKU without owner   | Null                        | Unresolved | `MISSING_OWNERSHIP` |

Diagnostic reads preserve unresolved facts and expose source version/row, company,
terms version/fee period, rate, base, amount, currency, and status. Strict financial
reads reject missing ownership, required fees, or source coverage; they cannot
produce partial totals by filtering failures or relying on `SUM` to skip nulls.
Privileged coverage checks also detect unmapped SKUs that company RLS cannot
show to a customer. Invalid required source fields fail preprocessing earlier.

### Partial live summaries

`load_company_financial_progress(...)` calls
`private.company_financial_progress(...)` for the same explicit source scope.
It requires complete source coverage and ownership, but permits missing fees.
Each company/currency result exposes:

- `source_amount`: all authoritative source amounts in that group.
- `known_fee_amount` and `known_company_amount`: sums of resolved components.
- `missing_fee_count` and `missing_fee_components`: the unresolved rows, with
  source, SKU, marketplace, activity date, source amount, and fee base.

For a resolved sale of 100 at 10%, an uncovered sale of 200, and a noncommission
cost of -5, the source total is 295, known fee is -10, and known company amount
is 85. The uncovered 200 remains in the missing-fee details. If every component
needs a missing fee, both known sums remain NULL; an explicit 0% rate yields a
known zero fee. The SQL JSON detail uses decimal strings and the Python reader
returns exact `Decimal` values.

These partial sums support live administration. Payout publication rejects missing
applicable fees; its [coverage rules](company_payout_reports.md#empty-aggregates)
distinguish scopes with authoritative rows from empty aggregates.

### Dashboard estimates and source authority

Dashboard and strict reads apply the same [source policy](source_allocation.md). Dashboard totals
sum imported authoritative rows; strict reads additionally require complete declared coverage and
resolved ownership/fees. Authoritative zero-amount rows remain in dashboard pages,
counts, totals, and payout records and retain the same ownership and applicable
fee requirements as other rows. Verified empty days satisfy coverage. Comparison
and analysis rows do not add money.

Company amounts use exact SKU ownership and the signed fee formula above. SelBox category and
reconciliation rows have no company ownership, require no fee configuration, and contribute zero
to company amounts. Company and SKU selections exclude those account rows. See the
[summary API](transaction_query_contracts.md#period-totals-and-type-breakdowns) for request scope.

For the same company, full mature month, and currency, a complete estimate and the
latest payout report agree after automatic generation has captured the current
inputs. Both combine all source namespaces. Reports retain their saved ownership
and fee versions; a newer live correction appears in the next successful refresh.

## Access and performance

Company views use `security_invoker = true`, underlying read grants, and RLS
based on `app_accounts`. Company members cannot change ownership, fee terms, or
source publications. They see selected terms for their assigned company's SKUs
and permitted current source results. Operators read all terms versions and
retained source history, publish complete terms, and read saved payout reports for
any company. The periodic worker generates eligible monthly reports automatically.
Company members can read their own saved payout reports and components. See the
[application-access contract](access_control.md). The
[PostgreSQL view contract](https://www.postgresql.org/docs/17/sql-createview.html)
defines how invoker permissions and base-table policies apply.

Indexes cover application accounts, SKU identity, selected terms, company lookup,
and source marketplace/date access. Dashboard RPCs page eligible source facts before
fee calculation and group compatible facts for totals. Views provide complete relational
reads; the [performance guide](database_performance.md) explains the access paths.
Filtered multi-company workloads in
the local database tests verify access and exact results, not production capacity.

## Implementation and acceptance

The [migration modules](../services/db/supabase/README.md#schema-modules) install the schema into a
fresh database. The [database suite](../services/db/supabase/README.md#verification) tests versioned
ownership, complete terms replacement, stale publication, frozen children,
missing-versus-zero coverage, signed fee arithmetic, and tenant isolation on
disposable databases. The source and financial unit tests verify the Python
boundaries. Current verification limits are recorded in
[known issues](known_issues.md#deployment-and-verification-scope).

The [payout publisher](company_payout_reports.md) saves exact amounts and typed
source/terms manifests protected from retention. Approval, adjustment policy,
rounding, and payment execution remain separate work; saved reports are not
evidence that a payment was approved or made.
