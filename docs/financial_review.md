# Financial review

Financial review is an administrator-only comparison of current facts from fully mature months
across all source namespaces, companies, marketplaces, and SKUs. It explains source differences; it is not a
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

The Data Kiosk source columns are **Finances costs** and **Data Kiosk costs**. The other categories
use **amount** in place of **costs**. Monthly details label the difference with its formula;
parenthesized formula text has less visual emphasis, without changing its accessible label.
Costs retain the source sign; the UI does not convert them to positive magnitudes.

All monetary displays use two decimal places, including yen and zero. Calculations keep exact
decimal precision and round only the displayed result, with ties away from zero. Differences use
the unrounded source sums, so subtracting two displayed rounded amounts can differ by a cent from
the displayed difference. Values that round to zero display `0.00`, without a negative sign.

Only the Data Kiosk category difference is the accounting reconciliation amount retained by SelBox.
Differences in the Finances and SelBox categories are diagnostic and do not create additional
payout adjustments. A source with no matching rows has a zero sum and is identified by its zero
record count. Source rows with zero amounts remain visible. `ANALYSIS_ONLY` rows do not enter
these monetary comparisons.

Only fully mature calendar months are eligible, matching [payout reports](company_payout_reports.md).
The current-source boundary is the first day of the month containing `mature_cutoff_date`, exclusive.
For example, an August 18 cutoff includes all of July and excludes all of August, including its
otherwise mature early dates. The overview and month drawer identify the latest eligible month from
the payout policy's `latest_month`. A newly eligible month appears in full when the cutoff enters
the following month. This boundary applies to date discovery, available currencies, period and running
totals, types, and source records; a stale saved selection cannot reopen an ineligible month.
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

## Yearly overview and monthly details

**Year** and **Currency** define one shared scope across the three category tabs. The initial year
is the latest year with fully mature source records and the initial currency is USD. Changing the year or category
retains the selected currency; if it has no matching records, the view stays empty rather than
switching currencies. The currency menu includes currencies available in the selected year and
the current selection. Year options span the available source years, including intervening gaps.

The overview shows up to twelve monthly rows, January through December, without row pagination or
a separate month filter. Each row shows the monthly source sums, monthly difference, and
**Running difference**: the exact sum of monthly differences from the start of the selected year
through that row. Missing months have no row; the running sum includes only returned source facts.
Period totals and the **Monthly and running differences** chart use the same year, currency, and
category. Offsetting differences can reduce a running total, but this does not prove that earlier
captures converged or that individual source discrepancies were resolved.

Selecting a month opens its totals and **Amounts by type** in a drawer, with the overview's currency
fixed throughout totals, types, source records, and the saved-report list. Choosing a type opens and
focuses records for the same category, month, currency, source, and exact raw type. Type and record
tables use 50-row pages. Source-filter state is saved separately for each category, month, and
currency. Changing Year or Currency closes the monthly drawer. **Previous** and **Next** within the
drawer move to older and newer available months of that year. A type's sum and count cover all
matching records, independently of the loaded record page.
Closing the month drawer returns focus to its opener after the exit transition, without scrolling
the page. A drawer restored by a page reload returns focus to the monthly list instead. This also
keeps X-button closing usable without clicking the underlying page again.

Source records expose the original amount, activity date, SKU, marketplace, exact type and source
namespace. **View source record** opens the exact row/version in a nested drawer, including native
Amazon transaction IDs, linked release/deferred IDs and processing provenance when available.
The selection survives reload; a missing or pruned version shows an explicit unavailable message
instead of substituting a current capture. Finances marketplace identity is required; its native Non-Amazon US channel
remains explicit. These are current
source facts without company allocation or fee joins. A difference at account or category level
does not attribute a discrepancy to a particular SKU, transaction, campaign, or blank marketplace.

Year, currency, category, selected month, source filters, detail pages, and expanded sections survive
reloads. Only view state is saved; amounts are fetched again. Lightweight source revision checks
and maturity-policy changes refresh current comparisons, including an open drawer.

## Fee family comparison and source lookup

The optional **Fee family comparison** groups already recognized fee identities: coupon participation
and performance charges, deal participation and performance charges, monthly and aged storage,
disposal, removal, labeling, inbound transportation/program charges, and subscription fees.
The display sums each source separately with exact decimal arithmetic, then shows Finances minus
Data Kiosk. Zero-value types remain. A missing side displays zero with an explicit missing-rows label;
this is not evidence of complete coverage. No dates, categories, payout authority, or allocations change.

The comparison loads all types for one selected category/month/currency, capped at 1,000 groups and
fails closed if that limit is reached. It never calculates family totals from a partial 50-row page.
**Unpaired or uncertain types** remain visible with their original amounts. Advertising and Sponsored
Products are not paired. Ambiguous convenience/placement labels also stay unpaired. Family grouping
is diagnostic, not a claim that billing periods, tax treatment or SKU allocations agree. Native
**Amounts by type** remains available below for exact type and record drilldown.

The administrator Finances tab also provides **Find Amazon transaction**, an explicit exact-ID lookup
independent of SKU/type search and current table filters. It reads a bounded page across retained
captures with an index on the native transaction ID. Results label **Current** versus **Retained**;
each row is an amount component, and repeated observations are not added together. A record opens
using both its row ID and version ID. All amount/quantity values are serialized as decimal text in
PostgreSQL before JSON reaches the browser. Neither lookup is available to members, anonymous users,
or service-role REST callers.

**Activity eligibility** describes a component within its capture. Original activity can count while
funds are still held; linked release copies and bank transfers are exclusive of activity totals.
A directly posted released fee can count. This flag is separate from current-capture selection,
month maturity, company ownership and fee configuration.

## Saved report snapshots

Each month's expandable **Saved report snapshots** section lists saved company reports and their
earlier versions. This section stays scoped to its month and the selected review currency, while
preserving its company filter independently of the current category comparison.

Selecting a snapshot opens **Saved source details**, including **Supporting records**, saved
account reconciliation, and input metadata captured when that report was created. These details are exclusive of the company
payout amount. Account controls can include other companies from the source accounts; the selected
review currency filters their totals and daily details, while their account scope remains separate
from the report's company scope.

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
| `public.financial_source_record(p_source, p_row_id, p_version_id)` | Exact retained source detail, with no version substitution; administrator-only. |
| `public.financial_source_transaction_lookup(p_native_transaction_id, p_limit, p_offset)` | Exact Finances native-ID component lookup across retained captures; administrator-only and bounded to 100 rows per call. |
| `public.payout_reconciliation_totals` | Frozen account controls for one selected saved report, grouped by currency. |
| `public.payout_report_reconciliation` | Frozen daily account controls and their source provenance. |

Current-source interfaces use invoker security and an explicit administrator check. Month RPCs require
half-open date bounds and apply those bounds before grouping, with existing fact-date indexes.
The browser reads the earliest and latest eligible dates with one-row date anchors, then requests
one bounded January-to-January period. The period response includes every currency to populate the
currency menu; only the selected currency enters displayed totals and running sums. Monthly detail
reads also filter by the selected currency. Finding the date bounds can still examine source rows;
bounded result size is not a constant-time guarantee.

CSV responses preserve decimal strings. Aggregate RPC projections are alphabetically ordered to
keep values aligned with headers on the deployed PostgREST CSV serializer; tests protect that
alignment. See [access control](access_control.md) for grants/RLS and the
[frontend guide](../services/frontend/user-webpage/README.md#requests-and-session-lifecycle) for
revision and cache behavior.
