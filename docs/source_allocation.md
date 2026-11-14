# Financial source allocation

Preprocessing assigns each normalized component an explicit allocation category.
The categories are Finances (`FINANCES`), SelBox (`SELBOX`), and Data Kiosk
(`DATA_KIOSK`). Data Kiosk also retains non-additive `ANALYSIS_ONLY` detail.
A category determines treatment; the source identifies the API that supplied the fact.
Unknown monetary paths fail preprocessing rather than receiving a default category.

## Activity and current versions

Finances stores stable seller/credential-scope/native transaction identities and immutable
transaction versions. Calculations follow each transaction's current pointer. Repeated downloads
reuse unchanged versions; historical versions are never added to current versions. Native transaction totals are controls;
normalized components partition those totals and are the allocation inputs.
Never add the parent totals and their components together.

The activity calculation excludes a release representation linked to its original
transaction and excludes native `Transfer` records. Original deferred activity,
direct charges, genuine refunds, reimbursements, debt recovery and other accepted
financial activity remain included. Status alone does not identify duplicates.
The [Finances workflow](finances_transactions.md) defines native linkage, date
scope, complete pagination, and Summary validation.

## Source selection

The source/category rule is the same for every activity date. Current reads select the
current immutable revisions and keep native activity eligibility checks. Missing Finances
activity does not make Data Kiosk sales authoritative.

| Category        | Authoritative source and treatment |
| --------------- | ---------------------------------- |
| `FINANCES`      | Eligible Finances components supply company amounts. Data Kiosk counterparts remain diagnostic detail. |
| `SELBOX`        | Eligible Finances components belong to SelBox and stay outside company allocations. |
| `DATA_KIOSK`    | Data Kiosk supplies company costs. Finances counterparts remain account controls. |
| `ANALYSIS_ONLY` | Diagnostic detail; never additive. |

Source comparisons are frontend diagnostics over exact backend aggregates. The backend supplies
current or report-referenced source/category amounts, row counts and successful retrieval coverage.
The frontend aligns matching scopes and computes differences with exact decimal arithmetic.
No diagnostic difference is an imported component, a company allocation or a transaction row.
See the [read contract](financial_review.md#read-contract).

## Company amounts and SelBox amounts

Exact SKU ownership assigns `FINANCES` and `DATA_KIOSK` amounts to companies.
`SELBOX` amounts are excluded from company and SKU selections,
even when a native account component preserves a SKU. Ownership is never inferred
from a source namespace, an account balance, or a reconciliation difference.

```text
company entitlement = assigned authoritative component amounts + signed service fees
```

Company calculations require resolved ownership and applicable fee periods.
Actual SelBox amounts can include balance movements and are not automatically profit.
A saved payout report records a calculation, not payment approval or execution.

Transactions totals, type breakdowns, and their contributing-record drawers sum the same filtered
rows as the main list. Eligible `SELBOX` activity contributes reported amounts for administrators,
with zero service fees and company amounts. Company and SKU selections omit SelBox throughout.
The shared latest-date anchor considers all authorized transaction activity.

Current SKU assignment corrects live ownership retroactively. It is not a dated
transfer. Saved reports preserve the ownership and fees selected at publication.
Refunds retain their own activity-date fee rate under the existing policy.

## Summary controls and payout eligibility

Finances native totals independently reconcile to Amazon `listSummary` using the
same seller, account type, currency and complete local-date reconciliation interval. Partial
boundary days from rolling UTC retrieval remain observations outside that comparison. Summary is a control,
not a second monetary input. `Non-Amazon US`, `Non-Amazon DE` and `Non-Amazon IT` contribute to the
Amazon.com, Amazon.de and Amazon.it Summary groups respectively. Raw facts and company marketplace
attribution retain each native channel. The successful batch membership records both channels when
present; the [EU control evidence](evidence/finances_summary_channels_2026-11-07.md) verifies this
grouping without changing Data Kiosk or payout scopes.

An exact Summary match validates the Finances account calculation. It does not
prove Data Kiosk's SKU cost allocation is correct. A frontend Data Kiosk comparison can
remain nonzero even when the Finances/Summary difference is zero.

[Payout reports](company_payout_reports.md) cover one company, exact marketplace, currency, and full
calendar month whose end is strictly before `private.mature_cutoff_date()`. That date is the
current UTC date minus two calendar months; calendar arithmetic clamps an unavailable day to the
month's end. The same cutoff supplies the default UTC `postedAfter` for Finance refreshes. It does
not hide older imported Transactions or Financial review data, switch authoritative sources, or
promise that Amazon will never revise a record. Nonempty company scopes require complete reconciled
source coverage, compatible current preprocessing labels and resolved ownership/fees. Finance
preprocessing verifies Summary for every declared reconciliation interval; missing or mismatched
required controls reject the whole batch and preserve prior accepted state. Partial-day observations
can update live transactions, but cannot certify payout coverage. Payout selection checks reconciled
period coverage against current transaction versions; it does not repeat Finance business equations.

Empty assigned companies can retain explicit zero reports without inventing a
marketplace or currency, or claiming that an unobserved seller was inactive. Source publications
and fee changes enqueue automatic refreshes. Snapshots reference Finance transaction versions,
Data Kiosk day versions and terms directly, including empty day versions. Both sources retain
immutable history without a cap. Summary evidence remains in the acquisition archives. See
[company fees](company_fees.md), [native type rules](transaction_type_registry.md),
and the [payout contract](company_payout_reports.md).

## Data Kiosk coverage for native channels

Finances retains `Non-Amazon US` activity under its native channel. Data Kiosk
has no separately queryable channel for it, so required Data Kiosk coverage uses
Amazon.com. The explicit `finances_data_kiosk_marketplace` rule affects coverage
expectations and strict source selection only; it does not rename financial
facts, change their fee marketplace, or distribute Data Kiosk amounts to MCF
transactions. A company report can therefore pin both native Finances channels
and the retail store's complete Data Kiosk month.
