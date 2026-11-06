# Financial review

Financial review is an administrator-only frontend comparison of current facts, defaulting to fully
mature months for one exact marketplace across all source namespaces, companies, and SKUs. It explains source
differences; [payout reports](company_payout_reports.md) freeze company amounts separately.
Currencies remain separate in both views.

## Categories and amounts

The three category tabs use the existing allocation rules. Their labels identify a category, not
the source of every row in that tab:

| Category   | Contents                                        | Role in mature calculations                                                                                               |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Finances   | Sales, refunds, and transaction fees            | Finances supplies company amounts; Data Kiosk supplies a comparison.                                                      |
| Data Kiosk | Allocated costs such as advertising and storage | Data Kiosk supplies company costs; Finances supplies account controls.                                                    |
| SelBox     | Account charges and balance movements           | These actual source-category amounts stay with SelBox. Diagnostic differences are separate. |

Data Kiosk is the initial category. Each marketplace/month/currency row compares the signed source sums:

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

A shared frontend module computes category and fee-family differences from the exact source sums.
No difference is a transaction, a payout adjustment or a backend accounting record. A missing source
contributes zero only when successful retrieval coverage covers the comparison period for every
relevant seller. An absent side with unknown or partial coverage stays unavailable. Returned source
amounts remain visible with their coverage status. When both sides have amounts but coverage is
partial, their difference describes only the observed data; it does not certify complete retrieval. Retained
zero-amount components remain observable. Data Kiosk omits components only when all calculation
inputs are zero or absent, while preserving empty-day coverage. `ANALYSIS_ONLY` data is excluded
from additive monetary comparisons.

The UI uses the payout policy's `latest_month` to choose its default fully mature date window and
clips overview, family and detail requests to that window. The backend source readers honor the
explicit requested dates without applying a moving maturity cutoff. Retrieval coverage and the
UI's review window are separate; neither establishes Amazon finality or agreement between sources.

The independent Finances/`listSummary` check validates account activity before
payout publication. It compares native transaction totals, not Data Kiosk.
Therefore a Financial review difference can remain nonzero even when the
Amazon Summary difference is zero. Summary matching does not repair missing,
duplicated or incorrectly attributed Data Kiosk SKU costs.

Financial review follows the [native activity rules](finances_transactions.md): original activity
dates determine inclusion, linked release copies and bank transfers are excluded, and zero-value
activity remains visible. Dated API, replay, and refresh checks are indexed in
[verification evidence](evidence/README.md).

Amazon's Summary groups native Non-Amazon US activity into Amazon.com. Financial
review deliberately retains the native marketplaces in its Data Kiosk comparison.
Only the separate monthly Summary control applies that verified grouping.

## Yearly overview and monthly details

**Marketplace**, **Year**, and **Fee families** define one shared scope across the three category tabs.
The **Comparison category** caption identifies Finances, Data Kiosk, and SelBox as accounting
categories; each category compares Finances with Data Kiosk.
The initial marketplace is Amazon.com and the initial year is the latest year with fully mature
records for that marketplace/category. Native financial channels remain separate from their retail
marketplaces. Currency is an amount unit derived from the selected marketplace's actual period
rows, never a way to infer the marketplace. With one unit it is shown as a label; a secondary currency
selector appears when multiple units are available. An explicit unit remains selected even if its
scope becomes empty. Changing marketplace clears the unit and open month. Automatic selection
prefers USD when available, then another available unit; it does not add a navigation-history step.
Opening a month records its actual unit in the same action so its URL and nested selections retain
that period. Year options span available source years, including gaps.

**Fee families** opens the same checkbox menu used by table Company and SKU filters. Longer lists
include a search field; searching changes the visible choices without clearing hidden selections.
Changes apply immediately. **Done** or Escape closes the menu and returns focus to its button.
**Clear fee families** removes the selection. Selected families are alternatives: choosing
Monthly storage and Sponsored products includes both, while Marketplace, Year, amount unit, and category still
intersect that selection. An empty selection includes all families; a nonempty selection with no
matching source types stays empty. Selections remain when changing marketplace, year, currency, or category,
including families absent from the new scope. Saved preferences and `family=` URL parameters
use current family IDs, deduplicate them, and retain the filtered scope through reload and
Back/Forward navigation. Request filtering rejects unknown family IDs.
`reviewMarketplace` is a scalar URL field, separate from repeated transaction marketplace filters.
Saved report links additionally require their exact marketplace, company, dates, currency, and ID.
Currency never implies a marketplace.

The overview shows up to twelve monthly rows, January through December, without row pagination or
a separate month filter. Each row shows the monthly source sums, monthly difference, and
**Running difference**: the exact sum of monthly differences from the start of the selected year
through that row. Missing months have no row. An unavailable monthly comparison makes the running
value unavailable; it is not silently counted as zero.
Period totals, the **Monthly and running differences** chart, and the monthly rows use the same year,
marketplace, currency, category, and family selection. The optional **Fee family breakdown** shows each named
family's source sums and difference across that period. Offsetting differences can reduce a running
total, but this does not prove that earlier captures converged or that individual source discrepancies
were resolved.

Where a source is absent in all or part of the selected scope, an overview note identifies it or
counts the months with records from only one source, and shows each source's record count. An absent
source contributes zero only for a covered empty period. Missing retrieval coverage or malformed
counts remain unavailable instead of becoming zero.
A zero amount can still have source records, and a zero difference can result from cancelling
amounts; neither establishes complete source coverage.

Each monthly chart bar is divided into fee-family segments. Positive family differences stack above
zero and negative differences below zero, so opposing amounts remain visible even when their net
monthly difference is zero. The named legend and family colors remain stable when filtering.
Subdued lines in those colors show each family's running difference; a stronger line retains the
total running difference. The compact legend shows up to six families, ranked by the absolute
running difference at the latest observed month. **Show all … families** expands only the legend;
every selected family remains plotted. The axis identifies the currency and uses compact magnitude
labels, with unabbreviated amounts in their titles.

The visible **Chart values** section starts at the latest observed month. Hovering or focusing a
plotted month updates it, and **Chart month** provides a keyboard and touch control. The readout
shows total monthly and running differences and initially the largest absolute monthly family
difference on narrow phones, or the three largest on wider screens. An action exposes every family
value in a bounded, keyboard-scrollable list. Registry-defined source-only families carry **Finances
only** or **Data Kiosk only** markers in the legend, readout, and month descriptions. These markers
describe the family definition rather than absence of observed rows. Clicking or activating a
plotted month, or choosing **Open month details**, opens that month's drawer.

A family absent from an otherwise populated month contributes zero and carries its running amount
forward. A month with no source records remains a gap in every line. All arithmetic uses exact
decimal values before display rounding; chart coordinates are only a visual approximation. If
family aggregates cannot be reconciled with the monthly totals, the chart keeps the total series
and explains that the family series are unavailable, with a retry action.

Selecting a month opens its totals and **Amounts by type** in a drawer, with the overview's marketplace, currency
and selected families retained throughout current totals, types, and source records. The saved-report
list retains the month, marketplace, and currency but each saved report keeps its complete historical scope.
Choosing a type opens and focuses records for the same category, month, marketplace, currency, selected families,
source, and exact raw type. Type and record tables use 50-row pages. Source-filter state is saved
separately for each category, month, marketplace, currency, and selected family scope. Changing Marketplace, Year, Currency,
or Fee families closes the monthly drawer. **Previous** and **Next** within the
drawer move to older and newer available months of that year. A type's sum and count cover all
matching records, independently of the loaded record page.
Closing the month drawer returns focus to its opener after the exit transition, without scrolling
the page. A drawer restored by a page reload returns focus to the monthly list instead. This also
keeps X-button closing usable without clicking the underlying page again.

Source records expose the original amount, activity date, SKU, marketplace, exact type and source
namespace. **View source record** opens the exact row/version in a nested drawer, including native
Amazon transaction IDs and linked release/deferred IDs when available. Displayed batch metadata
follows the [source inspector's observation selection](transaction_query_contracts.md#raw-source-pages);
the payout manifest separately preserves the observation used by a saved report.
The selection survives reload; a missing version shows an explicit unavailable message
instead of substituting a current capture. Native marketplace identity is required. These are
source facts without company allocation or fee joins. A difference at account or category level
does not attribute a discrepancy to a particular SKU, transaction, campaign, or blank marketplace.

Marketplace, year, currency, category, selected families, selected month, source filters, detail pages, and
expanded sections survive reloads. Only view state is saved; amounts are fetched again. Lightweight source revision checks
and maturity-policy changes refresh current comparisons, including an open drawer.

## Fee family comparison and source lookup

Membership is defined once in the [fee family catalog](../services/frontend/user-webpage/src/fee-family-definitions.ts).
Each supported source/type belongs to exactly one family. Display labels alone never determine
membership; the registry lists exact raw types and accepted aliases. Economic families combine
related charges, refunds, corrections, and reversals using their original signs. They do not
change source categories, activity eligibility, dates, allocations, or payout calculations.

Grouped pairs in the Finances category include:

| Family                   | Finances types                                                                     | Data Kiosk types                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Net product sales        | `PRODUCT_SALES`, signed `PRODUCT_REFUNDS`, `ZERO_ACTIVITY`                         | `NET_PRODUCT_SALES`                                                 |
| FBA fulfillment          | `FBA_FULFILLMENT_FEES`, `FULFILLMENT_FEE_CORRECTIONS`, `FULFILLMENT_FEE_REVERSALS` | `FBA_FULFILLMENT_FEE`, `FBA_FULFILLMENT_FEES`, `FBA_FULFILMENT_FEE` |
| Referral fees            | `REFERRAL_FEES`, `REFUNDED_REFERRAL_FEES`                                          | `REFERRAL_FEE`, `REFERRAL_FEES`, `REFUNDED_REFERRAL_FEE`            |
| Inventory reimbursements | `INVENTORY_REIMBURSEMENTS`, `INVENTORY_REIMBURSEMENT_REVERSALS`                    | `FBA_INVENTORY_REIMBURSEMENT`                                       |
| Liquidation fees         | `LIQUIDATION_FEES`                                                                 | `LIQUIDATION_PROCESSING_FEE`, `LIQUIDATION_REFERRAL_FEE`            |

Finances-only groups keep Shipping (credits, refunds, and chargebacks), Gift wrapping (credits and
chargebacks), Taxes collected and withheld (product, shipping, and gift-wrap taxes plus withholding),
and Promotions and points (rebates, refunds, and points) separate. Refund commission, restocking,
and liquidation proceeds also retain their own families.

Data Kiosk row counts include only retained normalized components after zero filtering. Amazon defines `netProductSales` as
ordered sales less refunded sales, with refunds assigned by refund-request time. Finances retains
its posted-activity dates, so related sales and refunds can fall in different months across the
two sources. See the
[Amazon Data Kiosk economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

The SelBox category keeps Subscription paired on its own and groups the remaining account activity:

| Family                          | Finances types                                                                      | Data Kiosk types       |
| ------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| Subscription                    | `SUBSCRIPTION_FEES`                                                                 | `SUBSCRIPTION_FEE`     |
| Seller service fees             | `EPR_FEES`, `VINE_FEES`, `INBOUND_DEFECT_FEES`                                      | No counterpart defined |
| Account credits and adjustments | `MCF_CREDITS`, `OTHER_ADJUSTMENTS`                                                  | No counterpart defined |
| Balance movements               | `DEBT_RECOVERY`, `CROSS_ACCOUNT_ADJUSTMENTS`, `RESERVE_MOVEMENTS`, `BANK_TRANSFERS` | No counterpart defined |
| Tax reclassification            | `TAX_RECLASSIFICATION`                                                              | No counterpart defined |

Catalog membership does not make a row eligible: bank transfers remain excluded from Financial
review by the activity rules.

Data Kiosk category pairs include:

| Family             | Finances types      | Data Kiosk types                                                                                         |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------- |
| Monthly storage    | `STORAGE_FEES`      | `FBA_STORAGE_FEE`, `MONTHLY_INVENTORY_STORAGE_FEE`                                                       |
| Aged storage       | `AGED_STORAGE_FEES` | `LONG_TERM_STORAGE_FEE`, `FBA_AGED_INVENTORY_SURCHARGE`                                                  |
| Sponsored products | `ADVERTISING`       | `SPONSORED_PRODUCT_FEE`, `SPONSORED_PRODUCTS`, `SPONSORED_PRODUCTS_CHARGE`, `SPONSORED_PRODUCTS_CHARGES` |

Other explicit families cover coupon and deal participation/performance charges, disposal, removal,
labeling, inbound transportation/program charges, and the remaining source identities. Sponsored
brands and Sponsored display remain distinct from Sponsored products.
Unrecognized types retain a separate named family for their exact source and raw type, such as
**Future fee · Finances**. Identical unfamiliar codes from different sources are not implicitly paired.
Selecting a family includes all its members; **Amounts by type** and source records retain each
exact type. The yearly breakdown and monthly comparison use the same definitions. Each row's
**Family definition** disclosure lists the complete membership from each source,
including **No counterpart defined** where applicable, separately from the types observed in the
selected scope. **None in this scope** means no member type was observed; it does not erase the
family's defined counterpart.

Both yearly and monthly family tables put the largest absolute difference first, retaining zero-value
types and groups whose records cancel to zero. The yearly **Show only** action selects that family
while preserving marketplace, category, year, and currency, and returns focus to the overview.

**Source coverage** distinguishes a **Finances-only family** or **Data Kiosk-only family**, as defined
by the catalog, from a paired family with no rows from an expected source in this scope. Paired
families with records from both sources use **Both sources** for a single observed month, or
**Both sources in X of Y months** for a multi-month period. X counts months with both sources; Y is
the number of months with records for that family. Inactive calendar months are excluded.
Source coverage does not establish agreement in billing dates, tax treatment, allocations, or
completeness. Source-only amounts represent unmatched coverage; neither their nonzero differences
nor a family's ranking establish an accounting error or missing import.

Family amounts are calculated from complete type aggregates for the selected marketplace, category, currency,
and month or year, never from a partial displayed type page or downloaded raw records. Reads page
through the existing type-total RPC using exact counts, with at most 50,000 aggregate groups and
200 requests. Incomplete, inconsistent, invalid, or over-limit responses show a load failure rather
than partial family totals.

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
earlier versions. This section stays scoped to its month, marketplace, and selected amount unit, while
preserving its company filter independently of the current category comparison. The current fee-family
selection does not alter a saved snapshot's amounts or supporting records; the section identifies
that historical scope explicitly. This list remains limited to the selected marketplace.

Selecting a snapshot opens **Saved source details**, including stored **Supporting records**,
**Account reconciliation** calculated from the report's saved source inputs, and input metadata.
These diagnostics are separate from the frozen company payout amount. Reconciliation uses the
selected report's own dates, marketplace and currency; its account scope can include other
companies from the source accounts.

The frontend uses the same calculation for current and saved-source aggregates. The report endpoint
follows the already-saved source references and accepts no replacement scope or version IDs.
Current ownership, fees and maturity policy do not alter those inputs. The same accounts may appear
in several company reports; do not add their diagnostic totals across reports. Members cannot read
these account-wide aggregates or source manifests.

## Read contract

| Interface | Purpose |
| --- | --- |
| `public.current_source_totals` | Exact source/category sums for the requested current-source date and marketplace scope. |
| `public.report_source_totals` | The same aggregates from one report's immutable source references and fixed scope. |
| `public.financial_review_records` | Current additive source records for administrator drill-down. |
| `public.financial_review_type_totals` | Exact source/type sums and counts within explicit half-open month bounds. |
| `public.financial_source_record` | Exact retained component/version lookup. |
| `public.financial_source_transaction_lookup` | Bounded exact native Finance transaction-ID lookup. |

The two source-total RPCs return JSON with `scope`, `revision`, `rows`, `total_count`, `next_offset`
and `coverage`. `scope` contains `start_date`, `end_date`, `marketplace_name` and `currency`; report
responses also include `report_id`. The client verifies this scope against its request. Each amount
row carries `seller_namespace`, `period`, `marketplace_name`, `currency`,
`source`, `category`, `amount` and `row_count`. Sources are `FINANCES` and `DATA_KIOSK`; additive
categories are `FINANCES`, `DATA_KIOSK` and `SELBOX`. `row_count` counts monetary components, not
Amazon transaction identities. Amounts and counts are exact strings. The frontend
pivots these rows into comparisons using its exact-decimal utilities; no derived diagnostic amount
comes from SQL.

Current arguments are `p_start`, `p_end`, `p_marketplace`, `p_grouping`, optional `p_currency` and
`p_category`, and daily `p_limit`/`p_offset`. Dates are inclusive and finite. Report arguments are
only `p_report_id`, `p_grouping`, `p_limit` and `p_offset`; its saved header fixes the date, market and
currency scope. A report with no currency has no native amount rows; readers do not invent a unit.
Both endpoints reject non-administrator authenticated callers. The default grouping is `month` for
current reads and `total` for reports. Daily pagination defaults to 50 buckets at offset zero.

`total` and `month` grouping return complete aggregates across sellers without applying page limits
or offsets; `next_offset` is null. Their `seller_namespace` is null. The `total` period is null,
and each `month` period is the first day of that month. `day` grouping retains
seller/date/market/currency buckets and pages complete buckets, including all their source/category
rows. `total_count` and `next_offset` refer to comparison buckets, not individual aggregate rows.
Source record drill-down
uses its own ordinary pagination. The frontend never computes headline totals from a detail page.

Daily buckets are ordered by seller, date, marketplace and currency using the database's text
collation; source and category order rows within each bucket. The client preserves that bucket order
across pages instead of re-sorting each page independently.

Coverage contains `{source, seller_namespace, start_date, end_date}` intervals clipped to the
inclusive response scope. Finance periods come from accepted acquisition batches; Data Kiosk
periods come from selected day headers, including empty days. Report coverage follows only its
saved manifests. Coverage is independent of category/currency filtering, and row absence alone
is not coverage or a promise of Amazon finality.

Current `revision` contains the `finances` and `data_kiosk` workspace tokens, including their
existing cutoff suffix, for authenticated administrators. Companion results with different tokens
are invalidated together. Trusted SQL reads without an administrator identity return null. Report
`revision` is always null: its immutable aggregate is cached by report ID and authorization identity.
Currencies are never combined.

Basic type and record readers retain CSV projections where appropriate. RPC CSV projections are
alphabetically ordered to preserve field alignment on PostgREST. See [access control](access_control.md)
for grants/RLS and the [frontend guide](../services/frontend/user-webpage/README.md#requests-and-session-lifecycle)
for session and cache handling.
