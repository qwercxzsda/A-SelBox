# Financial review

Financial review is an administrator-only comparison of current mature source facts across all
source namespaces, companies, marketplaces, and SKUs. It explains source differences; it is not a
company payout. [Payout reports](company_payout_reports.md) freeze company amounts separately.
Currencies remain separate in both views.

## Categories and amounts

The three category tabs use the existing allocation rules. Their labels identify a category, not
the source of every row in that tab:

| Category | Contents | Role in mature calculations |
| --- | --- | --- |
| Finances | Sales, refunds, and transaction fees | Finances supplies company amounts; Data Kiosk supplies a comparison. |
| Data Kiosk | Allocated costs such as advertising and storage | Data Kiosk supplies company costs; Finances supplies account controls. |
| SelBox | Account charges and balance movements | These source-category amounts stay with SelBox. They exclude retained service fees and the derived Data Kiosk difference. |

Data Kiosk is the initial category. Each month/currency row compares the signed source sums:

```text
difference = finances_amount - data_kiosk_amount
```

The Data Kiosk column labels are **Finances costs**, **Data Kiosk costs**, and
**Difference (Finances costs - Data Kiosk costs)**. The other categories use **amount** in place
of **costs**. Parenthesized formula text has less visual emphasis, without changing its accessible
label. Costs retain the source sign; the UI does not convert them to positive magnitudes.

Only the Data Kiosk category difference is the accounting reconciliation amount retained by SelBox.
Differences in the Finances and SelBox categories are diagnostic and do not create additional
payout adjustments. A source with no matching rows has a zero sum and is identified by its zero
record count. Source rows with zero amounts remain visible. `ANALYSIS_ONLY` rows do not enter
these monetary comparisons.

Dates before `mature_cutoff_date` are eligible under the shared [source policy](source_allocation.md).
A month containing the cutoff is labeled **Mature dates only**. The list and month drawer state
the exclusive cutoff date in UTC; later downloaded dates appear automatically as they mature.
Downloaded coverage and Financial review eligibility are separate: recent months can be present
in the source tabs while absent from this comparison. Maturity is an application assumption,
not proof that Amazon's sources agree or that every expected transaction has arrived.

The independent Finances/`listSummary` check validates account activity before
payout publication. It compares native transaction totals, not Data Kiosk.
Therefore a Financial review difference can remain nonzero even when the
Amazon Summary difference is zero. Summary matching does not repair missing,
duplicated or incorrectly attributed Data Kiosk SKU costs.

The [verification evidence index](evidence/README.md) records dated API, replay and source-refresh
checks. Earlier source investigations remain historical
evidence; their release-date comparisons are not the current activity-date
calculation. Financial review uses original activity dates and excludes linked
release copies and bank transfers. It retains actual zero-value activity rows.

Amazon's Summary groups native Non-Amazon US activity into Amazon.com. Financial
review deliberately retains the native marketplaces in its Data Kiosk comparison.
Only the separate monthly Summary control applies that verified grouping.

## Monthly browsing and source records

The list groups month/currency rows newest first, using the same month cells, column filters, table
typography, and pagination controls as Payout reports. **Rows** selects 25, 50, or 100 rows;
**Previous** and **Next** switch pages. The Month column filter selects an exact month. Clearing it
returns to the newest rows and preserves the chosen row count. A page counts currency rows, so a
month can continue on the next page.
The month cell says **N currencies on this page**, and a pagination hint explains the boundary;
the count does not describe the month's total currency coverage.

Selecting a month opens its totals and **Amounts by type** in a drawer. **Review currency** scopes
the type breakdown and **Source records** to the selected currency. Choosing a type opens and
focuses records for the same category, month, currency, source, and exact raw type. Type and record
tables use 50-row pages. Currency changes clear the type and page while preserving an open records
section. A type's sum and count cover all matching records, independently of the loaded record page.
Closing the month drawer returns focus to its opener after the exit transition, without scrolling
the page. A drawer restored by a page reload returns focus to the monthly list instead. This also
keeps X-button closing usable without clicking the underlying page again.

Source records expose the original amount, activity date, SKU, marketplace, exact type, source
namespace, and source row/version IDs. Finances marketplace identity is required; its native Non-Amazon US channel
remains explicit. These are current
source facts without company allocation or fee joins. A difference at account or category level
does not attribute a discrepancy to a particular SKU, transaction, campaign, or blank marketplace.

Category, row count, filters, selected month, currency, type, page, and expanded sections survive
reloads. Only view state is saved; amounts are fetched again. Lightweight source revision checks
and the maturity cutoff refresh current comparisons, including an open drawer.

## Saved report snapshots

Each month's expandable **Saved report snapshots** section lists saved company reports and their
earlier versions. This section stays scoped to its month and preserves company/currency filters
independently of the current category comparison.

Selecting a snapshot opens **Saved source details**, including **Supporting records**, saved
account reconciliation, and input metadata captured when that report was created. These details are exclusive of the company
payout amount. Account controls can include other companies or currencies from the source accounts;
they are identified separately from the report's company/month/currency scope.

Saved account controls remain immutable. The same controls can appear beside several company
reports, so they must not be added across reports. The [saved reconciliation contract](company_payout_reports.md#saved-account-reconciliation)
defines their exact identity. Members cannot read these comparison rows, controls, or
input manifests through the API.

## Read contract

| Interface | Purpose |
| --- | --- |
| `public.financial_review_records` | Current mature facts in the three monetary categories, with exact source provenance. |
| `public.financial_review_totals(p_month_from, p_month_to, p_category)` | Monthly sums, differences, and source record counts by currency. |
| `public.financial_review_type_totals(p_month_from, p_month_to, p_category, p_currency)` | Exact sums and counts by source and raw type. |
| `public.payout_reconciliation_totals` | Frozen account controls for one selected saved report, grouped by currency. |
| `public.payout_report_reconciliation` | Frozen daily account controls and their source provenance. |

Current-source interfaces use invoker security and an explicit administrator check. Month RPCs require
half-open date bounds and apply those bounds before grouping, with existing fact-date indexes.
The browser fills pages using bounded six-calendar-month queries and one-row date anchors to skip
gaps. It does not aggregate all history to count pages. Finding the newest eligible source date can
still examine source rows; bounded result size is not a constant-time guarantee.

CSV responses preserve decimal strings. Aggregate RPC projections are alphabetically ordered to
keep values aligned with headers on the deployed PostgREST CSV serializer; tests protect that
alignment. See [access control](access_control.md) for grants/RLS and the
[frontend guide](../services/frontend/user-webpage/README.md#requests-and-session-lifecycle) for
revision and cache behavior.
