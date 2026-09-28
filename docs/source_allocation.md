# Financial source allocation

Use the categories already assigned by preprocessing in each source. Never
reclassify a transaction based on SKU availability or the other source's rows.
The monetary categories are Settlement (`SETTLEMENT`), SelBox (`SELBOX`), and
Data Kiosk (`DATA_KIOSK`). Analysis only (`ANALYSIS_ONLY`) remains diagnostic,
not additive money. Category names describe treatment; the source identifies
whether an amount came from a Settlement report or Data Kiosk.

| Term | Meaning |
| --- | --- |
| `mature_cutoff_months` | Two calendar months |
| `mature_cutoff_date` | Database UTC date minus `mature_cutoff_months` |
| Mature | Activity date strictly before `mature_cutoff_date` |
| Recent | Activity date equal to or after `mature_cutoff_date` |

`private.mature_cutoff_date()` uses PostgreSQL's transaction-start timestamp in UTC
and calendar-month arithmetic, which clamps an unavailable day to the month's end.
Maturity is an assumption about Settlement completeness. It does not establish imported
coverage or prevent later revisions.

## Source selection

| Preprocessed category | Mature: before mature cutoff date | Recent: mature cutoff date and later |
| --- | --- | --- |
| Settlement (`SETTLEMENT`) | Use Settlement report amounts; discard Data Kiosk counterparts | Use Data Kiosk amounts; discard Settlement reports |
| SelBox (`SELBOX`) | Use Settlement report amounts; discard Data Kiosk counterparts | Use Data Kiosk amounts; discard Settlement reports |
| Data Kiosk (`DATA_KIOSK`) | Use Data Kiosk amounts; use Settlement report amounts as reconciliation controls | Use Data Kiosk amounts; discard Settlement reports |

For each mature **day, marketplace, seller, and currency**, compute:

```text
Difference = Settlement report amounts in the Data Kiosk category
           - Data Kiosk amounts in the Data Kiosk category
Accounted total  = Settlement report amounts in the Settlement category
                 + Settlement report amounts in the SelBox category
                 + Data Kiosk amounts in the Data Kiosk category
                 + Difference
                 = total Settlement report amount
```

Only the Data Kiosk category enters the difference. Data Kiosk values in the
Settlement and SelBox categories are already discarded for mature dates. Do not
subtract all Data Kiosk values a second time. Sum exact signed amounts, including
credits; never convert currencies or round the difference. Use the union of both
sources' grouping keys, so a one-sided group remains visible. A missing marketplace
stays a separate unspecified-marketplace group; never guess it from another row.
Recent dates have no Settlement difference.

The difference is a derived reconciliation entry, not a new preprocessing
classification. It appears as source `RECONCILIATION`, type
`SETTLEMENT_KIOSK_DIFFERENCE`, and category `SELBOX` in the administrator ledger.
Settlement report rows in the Data Kiosk category do not need a SKU: their amounts
are controls, while Data Kiosk rows in the same category provide company detail.
These controls contribute only to reconciliation; company amounts come from Data Kiosk.

## Company amounts and SelBox reconciliation

Exact SKU terms assign amounts in the Settlement and Data Kiosk categories to
companies. Amounts in the SelBox category and the difference stay with SelBox. An administrator sees the complete
account ledger. Company members see their own company's allocated rows; they
cannot read account-wide controls or another company's amounts. Company and SKU
selections exclude the SelBox category and difference rows, even when a raw
row in the SelBox category preserves the selected SKU. Those account amounts are never
redistributed to a company.

The current SKU assignment corrects ownership retroactively. Reassignment fixes a
past mistake for live calculations and future report generation; it is not a dated
transfer. Saved reports retain the company and amounts captured when they were created.

For mature dates, with signed service fees:

```text
Company entitlement = assigned Settlement report amounts in the Settlement category
                    + assigned Data Kiosk amounts in the Data Kiosk category
                    + signed service fees
SelBox retained amount = Settlement report amounts in the SelBox category
                      + Difference - signed service fees
sum(company entitlements) + SelBox retained amount = total Settlement report amount
```

This identity assumes company-relevant rows have resolved ownership and fees.
The reconciliation residual is not automatically profit: the SelBox category
includes balance and payment movements. Publication is not payment approval or execution.

Recent company calculations use Data Kiosk amounts in the Settlement and Data Kiosk
categories; its amounts in the SelBox category belong to SelBox. Commissions preserve the
existing date/rate and signed-fee formula. Analysis-only facts, gross/refund detail
alongside net sales, and Data Kiosk comparisons for mature dates in the Settlement and SelBox
categories never create additional company entitlement.

## Coverage, snapshots, and payout eligibility

Strict financial reads require every declared Data Kiosk day because the Data Kiosk
category supplies company costs even for mature dates. A missing day is not a verified
empty day. Required ownership and applicable fee rates must also resolve.

A [payout report](company_payout_reports.md) covers one company and a complete calendar
month whose last day is mature. On 2026-09-27 UTC, `mature_cutoff_date` is July 27:
July 26 and earlier are mature, and July 27 and later are recent. June is eligible;
July is not. Administrators generate all seller/currency scopes for that company/month
in one request. Members read only their own company's saved reports.

Payouts use the same authority and fee rules. An empty aggregate sums to zero using
available processed inputs; a scope containing authoritative company rows requires
complete declared day coverage. Reports freeze their components and source/terms
versions. Only an explicit request creates a snapshot, and matching latest inputs
reuse the latest report. The [payout contract](company_payout_reports.md) defines empty
scopes, reuse, marketplace breakdowns, and retention.

Source revision tokens include `mature_cutoff_date`, so the dashboard refreshes when
dates become mature even without an import. Raw source tabs preserve preprocessed
facts for inspection.

See [company fees](company_fees.md), [preprocessing categories](settlement_component_categories.md),
and [payout reports](company_payout_reports.md) for their separate contracts.
