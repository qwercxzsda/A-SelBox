# Financial source allocation

Preprocessing assigns each normalized component an explicit allocation category.
The categories are Finances (`FINANCES`), SelBox (`SELBOX`), and Data Kiosk
(`DATA_KIOSK`). Data Kiosk also retains non-additive `ANALYSIS_ONLY` detail.
A category determines treatment; the source identifies the API that supplied the fact.
Unknown monetary paths fail preprocessing rather than receiving a default category.

## Activity and current versions

Finances stores complete immutable versions of each seller/marketplace/local day.
Calculations follow the day's current version. Repeated downloads and historical
versions are never added together. Native transaction totals are controls;
normalized components partition those totals and are the allocation inputs.
Never add the parent totals and their components together.

The activity calculation excludes a release representation linked to its original
transaction and excludes native `Transfer` records. Original deferred activity,
direct charges, genuine refunds, reimbursements, debt recovery and other accepted
financial activity remain included. Status alone does not identify duplicates.
The [Finances workflow](finances_transactions.md) defines native linkage, date
scope, complete pagination, and Summary validation.

## Source selection

`private.mature_cutoff_date()` subtracts two calendar months from the database's
UTC transaction-start date. Dates strictly before that boundary are mature;
the boundary date and later dates are recent. Calendar arithmetic clamps an
unavailable day to the month's end. This is an application maturity policy,
not a guarantee that Amazon will never revise a record.

| Category        | Mature activity                                                                    | Recent activity                      |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `FINANCES`      | Finances components supply amounts; Data Kiosk counterparts are comparison detail. | Data Kiosk supplies amounts.         |
| `SELBOX`        | Finances components belong to SelBox.                                              | Data Kiosk amounts belong to SelBox. |
| `DATA_KIOSK`    | Data Kiosk supplies company costs; Finances supplies account controls.             | Data Kiosk supplies company costs.   |
| `ANALYSIS_ONLY` | Diagnostic detail; never additive.                                                 | Diagnostic detail; never additive.   |

For each mature seller, native marketplace, local activity day and currency:

```text
difference = Finances amounts in DATA_KIOSK - Data Kiosk amounts in DATA_KIOSK
accounted total = Finances amounts in FINANCES + Finances amounts in SELBOX
                + Data Kiosk amounts in DATA_KIOSK + difference
                = Finances activity amount
```

Only the Data Kiosk category enters this residual. Differences in the other
categories are diagnostic comparisons, not extra payout adjustments. Keep exact
signed amounts, zero rows and separate currencies. The union of both source key
sets preserves one-sided groups. Finances' validated native marketplace remains
unchanged, including `Non-Amazon US`.

The derived residual has source `RECONCILIATION`, type
`FINANCES_KIOSK_DIFFERENCE`, and category `SELBOX`. It belongs to the administrator's
account ledger. It is not a new Amazon fact or a company cost allocation.

## Company amounts and SelBox amounts

Exact SKU ownership assigns `FINANCES` and `DATA_KIOSK` amounts to companies.
`SELBOX` and reconciliation amounts are excluded from company and SKU selections,
even when a native account component preserves a SKU. Ownership is never inferred
from a source namespace, an account balance, or a reconciliation difference.

```text
company entitlement = assigned authoritative component amounts + signed service fees
SelBox retained amount = authoritative SELBOX amounts + difference - service fees
sum(company entitlements) + SelBox retained amount = Finances activity amount
```

The identity requires resolved company ownership and applicable fee periods.
SelBox's amount is not automatically profit: it can include balance movements.
A saved payout report records a calculation, not payment approval or execution.

Current SKU assignment corrects live ownership retroactively. It is not a dated
transfer. Saved reports preserve the ownership and fees selected at publication.
Refunds retain their own activity-date fee rate under the existing policy.

## Summary controls and payout eligibility

Finances native totals independently reconcile to Amazon `listSummary` using the
same seller, account type, currency and local date interval. Summary is a control,
not a second monetary input. `Non-Amazon US` contributes to Amazon.com's Summary
control group; raw facts and company marketplace attribution retain the native
channel. The exact day-version manifest includes both channels when present.

An exact Summary match validates the Finances account calculation. It does not
prove Data Kiosk's SKU cost allocation is correct. The Data Kiosk residual can
remain nonzero even when the Finances/Summary difference is zero.

[Payout reports](company_payout_reports.md) cover one company, exact marketplace, currency, and full
calendar month whose end is mature. Nonempty company scopes require complete compatible Data Kiosk and
Finances coverage, resolved ownership/fees, and matched Summary checks for the
exact Finances versions. Valid daily observations may be published before
reconciliation succeeds. Missing or mismatched controls block a new payout while
preserving the previous successful report.

Empty assigned companies can retain explicit zero reports without inventing a
marketplace or currency, or claiming that an unobserved seller was inactive. Source publications
and fee changes enqueue automatic refreshes. Snapshot pins preserve empty days,
financial components, and their Summary evidence; retention never removes pinned
payloads. See [company fees](company_fees.md), [native type rules](transaction_type_registry.md),
and the [payout contract](company_payout_reports.md).

## Data Kiosk coverage for native channels

Finances retains `Non-Amazon US` activity under its native channel. Data Kiosk
has no separately queryable channel for it, so required Data Kiosk coverage uses
Amazon.com. The explicit `finances_data_kiosk_marketplace` rule affects coverage
expectations and strict source selection only; it does not rename financial
facts, change their fee marketplace, or distribute Data Kiosk amounts to MCF
transactions. A company report can therefore pin both native Finances channels
and the retail store's complete Data Kiosk month.
