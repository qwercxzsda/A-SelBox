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

Both sources use the same `PREPROCESS_VERSION`, currently `v0`. A combined read
requires this exact name on every required selected source version. Marketplace
names join through the shared `amazon_marketplace_name` enum. Original API IDs
remain in source provenance. Queries accept explicit dates without a rolling
30-day limit or age-dependent source switch.

## Ownership and fee configuration

| Table                | Purpose                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `seller_skus`        | Stable exact seller/SKU identity and selected `current_terms_version_id`.                                         |
| `sku_terms_versions` | Immutable company assignment or explicit unassignment, revision number, reason, and complete fee inventory count. |
| `sku_fee_periods`    | Marketplace-specific effective periods and rates belonging to one terms version.                                  |

These tables live in `public`; trusted writers publish through
`private.publish_sku_terms(jsonb)`. Operators use the caller-checked
`public.publish_sku_terms(...)` REST RPC. UUIDv7 identifiers and audit times
are generated automatically. Administrators provide business terms and an
expected current version. `version_number` labels publications within one SKU;
the current pointer selects the revision. `company_skus` is an assigned-only
current projection view, and `current_sku_fee_periods` projects its selected
periods. Neither is a writable ownership or schedule table.

### Stable identity and versioned ownership

`UNIQUE (seller_namespace, sku)` establishes one stable identity across marketplaces.
The selected revision assigns one company or explicit `company_id = NULL`.
Original nonblank SKU text
is preserved verbatim, so padded and unpadded SKUs remain distinct. The same SKU
from a different seller has independent ownership.

The selected version must belong to that same seller/SKU. The first publication
creates the identity and required first revision atomically; there is no dummy
initial owner and no automatic registration during source imports. Later
publications may reassign or unassign the SKU, including unassigning every
configured SKU. They preserve identity and immutable history. There is no global
fee-configuration version or ownership effective-date model.

The selected company applies across all dates in live reads. An assigned SKU
with no fee periods still has ownership for noncommission expenses. Unassigned
source keys resolve as `MISSING_OWNERSHIP`, retaining a selected terms reference
when available. Periods retained in an unassigned revision are inactive.

An administrator's unassigned list combines distinct nonblank seller/SKU keys
from current source facts with configured `seller_skus`, then selects keys with
no current company. It needs no registration job, history classification, or
persisted Default company. An optional frontend Default label grants no access.

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

An empty replacement withdraws all coverage. An explicit 0% period still
provides coverage and differs from a missing rate.

### Atomic publication

Publication locks the seller/SKU identity and checks its expected current version, including
expected absence on first publication. It inserts the new version and complete
period inventory, validates the terms, and advances the current reference in one
transaction. It allocates the next revision number while holding the lock.
A stale edit or other failure preserves the previous selection.

Published versions and child inventories are immutable: updates, deletions, and
additional child inserts are rejected. A deliberate reversion publishes another
version containing the desired terms. The service does not automatically retry
failed publications.

## Live read contract

A strict read selects complete source versions for explicitly declared
Settlement identities and Data Kiosk marketplace/day coverage, requires matching
preprocessor versions, and applies the source policy before calculating money.
It resolves seller/SKU ownership independently of fee eligibility, then joins the
selected terms version and its marketplace period covering the source activity date.

Settlement commissions use only signed `Order / ItemPrice / Principal` and
`Refund / ItemPrice / Principal`. Normal negative refunds reduce the base without
another sign reversal. Shipping, gift wrap, taxes, promotions, and Amazon fees
are outside this base. The posting date of each row selects its rate; report end,
deposit, download, and preprocessing dates do not.

Data Kiosk sales analysis uses validated `netProductSales`, preserving
`orderedProductSales` and signed `refundedProductSales` separately. It requires
`net = ordered - refunded`, including negative refunds. These analysis values
do not create a second authoritative sales commission alongside Settlement.

```text
fee_amount = -(fee_base * fee_rate_percent * 0.01)
company_amount = source_amount + fee_amount
```

Calculate each row before aggregating, preserve currencies separately, and use
exact decimal arithmetic without currency rounding or a zero floor. At 5%,
sales of 100 and refunds of 20 produce a fee of -4. Noncommission costs require
ownership but no rate. Fee-eligible zero amounts still require fee coverage.
Every ordinary Order/Refund row independently requires its explicit source
marketplace, including noncommission rows.

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

These partial sums support live administration. Payout publication uses the
strict complete calculation and rejects missing fees.

### Source authority and views

Each source has one fact table and three category views: SKU, account, and
others. The required `allocation_category` enum contains `SETTLEMENT`, `SELBOX`,
`DATA_KIOSK`, and `ANALYSIS_ONLY`; Settlement permits the first three only.

Settlement `SETTLEMENT` rows supply company amounts and eligible commissions.
Settlement `SELBOX` rows remain with SelBox. Settlement `DATA_KIOSK` rows are
reconciliation controls even when they contain an owned SKU. Approved Data Kiosk
`DATA_KIOSK` components supply company costs; its `SETTLEMENT` counterparts remain
available for comparison. `ANALYSIS_ONLY` facts stay outside authoritative totals
and the three category views.

Data Kiosk's DAY/MSKU query requires SKU and produces no account entries. A
known account component with MSKU fails preprocessing. Unknown financial labels
and missing required amounts or collections also fail the whole acquisition's
preprocessing. A recognized analysis-only component has an explicit amount and
is not a fallback for unknown money.

## Access and performance

Company views use `security_invoker = true`, underlying read grants, and RLS
based on `app_accounts`. Company members cannot change ownership, fee terms, or
source publications. They see selected terms for their assigned company's SKUs
and permitted current source results. Operators read all terms versions and
retained source history, publish complete terms, and read all saved payout
reports. Company members have no payout access. See the
[application-access contract](access_control.md). The
[PostgreSQL view contract](https://www.postgresql.org/docs/17/sql-createview.html)
defines how invoker permissions and base-table policies apply.

Indexes cover application accounts, seller/SKU identity, selected terms, company lookup,
and source marketplace/date access. Ordinary views are the current read path;
introduce caches only for a measured need. Filtered multi-company workloads in
the local database tests verify access and exact results, not production capacity.

## Implementation and acceptance

The five migration modules install this schema into a fresh database; they do
not provide an upgrade or backfill path for an existing deployment. The
[database suite](../services/db/supabase/README.md#verification) tests versioned
ownership, complete terms replacement, stale publication, frozen children,
missing-versus-zero coverage, signed fee arithmetic, and tenant isolation on
disposable databases. The source and financial unit tests verify the Python
boundaries. Current verification limits are recorded in
[known issues](known_issues.md#deployment-and-verification-scope).

The [payout publisher](company_payout_reports.md) saves exact amounts and typed
source/terms manifests protected from retention. Approval, adjustment policy,
rounding, and payment execution remain separate work; saved reports are not
evidence that a payment was approved or made.
