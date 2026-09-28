# Monthly company payout reports

Payout reports freeze one company and one full calendar month, separately by
seller and currency where those scopes are known. A company/month with no known
scope still produces an aggregate of zero, without inventing a seller or currency.
The month end must be strictly before `mature_cutoff_date`, calculated from the
database UTC date and `mature_cutoff_months = 2`. The
[source policy](source_allocation.md) defines the boundary and applies identically
to mature live reads.

Administrators choose a company and month in the Payout reports tab, then generate
all eligible reports in one action. Each known seller/currency report includes a
marketplace breakdown. Administrators can browse every company's
saved reports and filter by company/month. Company members read only their own
headers, components, and marketplace totals and cannot generate. Database permissions
enforce these rules independently of the browser. Account reconciliation and input
manifests remain administrator-only.

## Generate and read

`public.payout_report_policy()` returns `mature_cutoff_date`, `latest_month`, and
`mature_cutoff_months`. Administrators call:

```sql
select * from public.generate_company_payout_reports(
    p_company_id := '<company UUID>', p_month := date '2026-06-01'
);
```

The database derives source scope and computes amounts. It accepts no calculated
client amounts or caller-selected historical versions. It returns one
`(report_id uuid, created boolean)` row per scope: `created = true` means
a new immutable report was saved; `false` means the latest saved report was
reused. Each seller/currency report is checked independently: the batch reuses
reports whose latest scope and input versions still match, and creates only
missing or outdated reports. The UI distinguishes created and reused reports.
All scopes from one invocation succeed atomically. The action includes every
seller/currency scope in current data or previous reports for that company/month.
A company with only Data Kiosk costs has a valid scope. Previous scopes remain when
their amounts disappear; with no known scope, the company/month itself is the scope.
The browser does not require separate currency requests.

The trusted `publish_company_payout_report(...)` API publishes one known scope and
returns its saved UUID. Both paths apply the same rules and calculation version `v1`,
independently of the source `preprocess_version`.

## Empty aggregates

Every report uses `COALESCE(SUM(...), 0)`. No matching monetary rows therefore
produce zero through the ordinary aggregation. This does not certify inactivity or
complete upstream acquisition/preprocessing. A zero total can also result from
amounts that cancel each other; those reports retain their component rows.

A scope containing authoritative company rows requires every day in each declared
Data Kiosk marketplace, including when its total is zero. A scope without those rows
uses available processed inputs without requiring complete day coverage. Missing
ownership, applicable fees, or invalid available inputs still block publication.
SKU-less Settlement controls in the Data Kiosk category do not. Validation applies
before both reuse and creation.

Current and historical company SKU assignments identify every namespace containing
matching source facts; earlier reports preserve already captured source scopes.
An assignment has no namespace of its own. Available source versions, including processed empty days, and current terms
are retained as snapshot inputs. Unknown ownership within this source scope remains
an error. A company with no identifiable seller can have an empty input inventory.

If there is no known seller/currency scope, `seller_namespace`, `currency`, and
`preprocess_version` are all null. Its totals are zero and it has no component or
account-reconciliation rows; available source/terms manifests can still be present.
A known seller/currency scope retains those identifiers even when its aggregate is zero.

Snapshots are created only by an explicit generation/publication request. Source
arrival, preprocessing, corrections, and reassignment never generate reports automatically.
A later request can save zero totals for a previous currency scope whose amounts
disappeared. Existing snapshots remain immutable.

## Reuse unchanged reports

Both publication paths compare only the latest report by save time for the same
company, seller, currency, and calendar month. Reuse requires matching preprocessing
and calculation versions, marketplace scope, and exact sets of selected Settlement,
Data Kiosk, and SKU terms versions. The dataset is `economics`.

Repeating a request with unchanged inputs adds no duplicate. A request's UUID,
creation time, report name, or change reason does not force a new report; a reused
report keeps its original values for those fields.

If the latest report differs or does not exist, the request creates a new snapshot.
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
contributions. The drawer's Payout amounts section shows both monetary sources;
Supporting details shows excluded comparisons. Values remain exact decimal strings
in the browser and `Decimal` in Python.

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

The header's `marketplace_names` records marketplaces required for input coverage,
including those with verified empty Data Kiosk days and no company payout amount.
The breakdown comes from the saved authoritative company components. SelBox amounts
and the reconciliation difference remain in the separate administrator-only account
reconciliation. The view derives its totals from saved components.

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
administrator-only `public.payout_report_reconciliation` view exposes the frozen controls, and the
report drawer labels them as seller-wide context. The same account controls may
appear beside several company reports: never sum those repeated snapshots across
reports. Members cannot read them or the source manifests.

## Integrity and access

Reports, company components, reconciliation rows, and complete source/terms
manifests are immutable. Integrity checks verify provenance, exact sums, complete
inventories, and the reconciliation identity against frozen versions. Nullable scopes
are restricted to empty company/month aggregates. Publication locks company/month,
captures its related seller set, then locks seller/month and source days in order.
Concurrent newly related sellers are included
on the next request. Capture and pruning use `READ COMMITTED` and pin all referenced
days, including empty ones. Privileged publication recreates its temporary work table
to prevent caller-owned temporary tables or triggers from running with its role.

Reassignment corrects mistaken ownership retroactively in live calculations and
future generation; it does not establish a dated transfer. Saved reports keep their
original company and amounts. Required unassigned SKUs block generation.
Member access follows the report's saved company and the member's current application
account. Approval, adjustments, currency rounding,
and payment execution remain separate features.

## Verification

The disposable database suite covers category authority, exact boundary dates,
monthly eligibility, reconciliation, tenant isolation, immutable snapshots,
marketplace totals, unchanged-input reuse, concurrent publication, and retention.
Frontend tests run in Docker. The real-seed verification tool replays archived inputs into a
disposable database without deleting account-level charges or changing their categories.

```sh
conda run -n A-SelBox python -m services.db.supabase.tests.verify_real_payouts --help
```
