# Data Kiosk category: payout impact

Investigation date: October 2, 2026. Scope: monetary components classified
`DATA_KIOSK`, which remain authoritative for company costs after maturity.
This is not an audit of every component returned by the Data Kiosk API.
The Swedish fulfillment/referral issue belongs to the `SETTLEMENT` category
and is outside this mature-payout cost audit.

The existing dates, maturity rule, source policy and saved reports remain
unchanged. July is the latest entire calendar month admitted by the cutoff.
August findings concern estimates and future eligible reports, not a full August
saved payout. Advertising invoice investigation remains deferred until Ads API
access is available; its observed amounts and unresolved exposure are included.

## How an error reaches the payout

For an assigned SKU, these signed Data Kiosk costs enter the company's amount
directly, without an additional service-fee percentage. The reconciliation
difference is retained by SelBox. It does not repair the company's cost.

For example, with 1,000 before costs, a genuine cost of 10 should leave 990. If
Data Kiosk returns 20, the company receives a calculated amount of 980 and the
control difference adds 10 to SelBox. The account still balances to 990, despite
the company's calculated amount being 10 lower.

Therefore:

- An extra Data Kiosk cost understates the calculated company payout.
- An omitted Data Kiosk cost overstates it, if the cost belongs to that company.
- Equal total costs allocated to different companies can also misstate individual
  payouts. Account-level agreement alone does not validate SKU allocation.
- A matched cost recorded in a different month changes monthly comparisons but
  does not establish an incorrect lifetime cost. Original dates remain unchanged.

The signed Financial review difference is Settlement minus Data Kiosk. It is not
automatically a payout correction: timing, coverage and SKU attribution must
first be established. These are calculated report amounts, not executed payments.
See the [source policy](../source_allocation.md) and
[payout contract](../company_payout_reports.md).

## Types classified as Data Kiosk costs

The exact supported names come from the
[type registry](../../services/sync/src/transaction_types/data_kiosk.py).
Related accepted names are listed together; they are not additional copies of a
charge. The implementation retains each actual raw type and amount.

There are **25 accepted labels representing 15 cost types**. The current
June–September captures contain **13 types**: all 12 fee types and Sponsored
Products. Sponsored Brands/Display were not returned. There are 5,135 current
category rows: 647 fee rows and 4,488 Sponsored Products rows.

| Cost type | Accepted component types | Finding for the checked cohorts |
| --- | --- | --- |
| Coupon participation | `COUPON_PARTICIPATION_FEE` | Canadian July/August participation costs lack Data Kiosk counterparts. |
| Coupon performance | `COUPON_PERFORMANCE_FEE` | Checked US July coupon totals agree; Canadian omission is participation, not demonstrated performance charges. |
| Deal participation | `DEAL_PARTICIPATION_FEE` | One German July participation charge of EUR 16 lacks an allocated Data Kiosk counterpart. |
| Deal performance | `DEAL_PERFORMANCE_FEE` | Checked fees mostly agree at currency precision; small native allocation/precision differences remain. |
| Disposal | `DISPOSAL_FEE` | Mixture of verified delayed postings and persistent extra matching fee payloads. |
| Removal | `REMOVAL_FEE` | Checked UK June operation matches charges split across June/July. |
| Aged storage | `FBA_AGED_INVENTORY_SURCHARGE`, `LONG_TERM_STORAGE_FEE` | Checked July/August cohorts agree with Settlement or independent Finances controls. |
| Monthly storage | `FBA_STORAGE_FEE`, `MONTHLY_INVENTORY_STORAGE_FEE` | Verified service-month versus following-month billing. |
| Inbound placement | `FBA_INBOUND_CONVENIENCE_FEE`, `FBA_INBOUND_PLACEMENT_SERVICE_FEE` | US July agrees; August contains USD 833.16 of additional Data Kiosk cost versus released charges. |
| Inbound transportation | `FBA_INBOUND_TRANSPORTATION_FEE` | Fresh queries expose costs present at child-ASIN level but absent at SKU level. |
| Inbound transportation program | `FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE` | The same missing SKU allocations affect this fee; the combined July EUR difference includes timing and an omitted July cost. |
| Labeling | `LABELING_FEE` | Checked Japan July–September amounts agree with Finances, including tax; repeated same-value September charges are real separate events. |
| Sponsored Products | `SPONSORED_PRODUCTS`, `SPONSORED_PRODUCTS_CHARGE`, `SPONSORED_PRODUCTS_CHARGES`, `SPONSORED_PRODUCT_FEE` | Large observed account differences; invoice-level cause and SKU attribution remain unresolved. |
| Sponsored Brands | `SPONSORED_BRANDS`, `SPONSORED_BRANDS_CHARGE`, `SPONSORED_BRANDS_CHARGES` | Supported names; absence from a capture does not establish absence of account spend. |
| Sponsored Display | `SPONSORED_DISPLAY`, `SPONSORED_DISPLAY_CHARGE`, `SPONSORED_DISPLAY_CHARGES` | Supported names; absence from a capture does not establish absence of account spend. |

The schema defines `totalAmount` as the final amount after promotion and tax.
Preprocessing uses that parent amount once, with an expense sign. It does not add
component breakdowns to the parent a second time.
[Official Economics schema](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql).

The audit checked all 5,135 current rows: stored amount, sign, currency, quantity
and native amount-minus-promotion-plus-tax agree, with unique current row IDs and
version/component identities. No Sweden-style zero total with cancelling
nonzero components occurs in this category. Five storage rows have a positive
quantity and a genuinely zero total and zero components; those alone do not
establish a defect. These checks establish faithful ingestion, not correctness
or completeness of Amazon's fee outputs.

## Payout-relevant discrepancies and exposure

Amounts below are evidence of differences, not approved corrections. Missing
account-level charges without SKU references cannot be assigned to a company
merely by choosing a matching amount. Repeated fee payloads also do not provide a
universally safe transaction identity.

All **2,723 Data Kiosk-category components in the latest saved reports** are
authoritative; each has zero service fee and a company amount exactly equal to
its source amount. The following risks therefore concern inputs actually used
by report calculations, rather than merely supporting-detail rows.

| Case | Measured source difference | Potential effect on calculated company amounts |
| --- | --- | --- |
| US July disposal | Data Kiosk cost 219.12 versus Settlement 198.69: **USD 20.43 extra** | Lower by 20.43 in aggregate if the matching payload excess is duplicate cost. |
| EUR July disposal | 17.76 difference comprises 5.18 of verified later postings and **12.58 of matching-payload excess** | Potentially lower by 12.58; the 5.18 timing component is not another excess. |
| German July deal | Participation billed 32 versus 16.0006; performance billed 6.17 versus 6.1702 | **EUR 15.9992 net under-deduction exposure**; affected SKU/company is not established by the control. |
| Canadian July coupon | Settlement charges **CAD 2**; no coupon fee in the retained Data Kiosk history | CAD 2 under-deduction exposure; attribution must be established. August has the same observed omission. |
| EUR July transport/program | Settlement/Finances cost 237.42 versus MSKU Data Kiosk 53.0129 | **EUR 70.0471 omitted July SKU cost** identified at child-ASIN level; the rest of the July difference relates to an earlier cost's posting. |
| US August placement | Settlement/Finances cost 636.92 versus Data Kiosk 1,470.08 | **USD 833.16 extra estimated cost**; future report exposure if those inputs persist. |
| Australia August disposal | One corroborated 101-unit cost of 23.33 appears twice in Data Kiosk, totaling 46.66 | **AUD 23.33 extra estimated cost** for that cohort; a separate 0.23 charge reduces the overall monthly gap to 23.10. |

US August disposal has another USD 23.54 matching-payload excess. The UK August
disposal difference is predominantly the verified later GBP 255.30 charge, with
only GBP 1.48 remaining matching-payload excess. These amounts are different
months and currencies and must not be combined into one error total.

The native Data Kiosk inbound-placement repetitions add exactly to USD 833.16:
210.76, 200 and two additional 211.20 amounts. A fresh August RANGE query also
returns 1,470.08, so the excess is not caused by summing DAY captures locally.
Native shipment inventories corroborate the implicated cohorts, while missing
Data Kiosk shipment IDs prevent a general automatic deduplication rule.

### Transport: missing SKU allocations isolated by fresh queries

The same German July fee query returns **EUR 53.0129 with MSKU aggregation** and
**EUR 123.06 with CHILD_ASIN aggregation**. Both use the same dates and parent
`totalAmount` fields. This is an upstream difference in payout-relevant totals,
not a discrepancy confined to component breakdowns.

Eight completed fee-only diagnostics checked Canada July at both product levels,
Germany June/July at both levels, and Germany June/July child-ASIN daily detail.
The German transportation/program totals are:

| Cost month | MSKU total | Child-ASIN total | Missing from MSKU |
| --- | ---: | ---: | ---: |
| June | 144.3912 | 228.7198 | **84.3286** |
| July | 53.0129 | 123.0600 | **70.0471** |
| Combined | 197.4041 | 351.7798 | **154.3757** |

Both missing allocations belong to the tape ASIN. June 30's 80-unit allocation
is 69.6913 transportation plus 14.6373 program fee. A separate June 8 allocation
of 99.1034 for the same ASIN under `BUTYL TAPE` is already recorded and must not
be removed or treated as the June 30 counterpart.

The additional **EUR 70.0471** is ASIN `B09V2GP4K7`, 80 units of butyl tape:
57.8904 transportation plus 12.1567 transportation-program fee. The native
shipment charged on July 3 contains `BUTYL TAPE-stickerless` (80 units) and
`ELG_Clear_stickerless` (780 units). MSKU output contains only the clear SKU's
35.5129 allocation for that cohort; child-ASIN output also contains the tape
allocation. Together they match the billed 105.56 to currency precision.

The exact shipment SKU is assigned to Company A under the terms pinned in its
July EUR report. No July German transport cost exists on that SKU or another SKU
of the tape ASIN. Adding the identified 70.0471 allocation would reduce Company
A's July calculated entitlement by **70.0471**, without changing service fees.
This establishes a concrete correction candidate. No source row or report was
changed, and Data Kiosk still lacks a native shipment ID, so the corroboration
uses shipment contents, ASIN, quantity, fee and date rather than a direct
Data Kiosk event-ID join.

June's frozen terms assign `BUTYL TAPE-stickerless` to the same company. The
identified missing deductions are therefore **84.3286 in Company A's June EUR
report and 70.0471 in its July EUR report**, totaling **154.3757** of potential
downward correction. They are deductions missing from existing saved reports,
not merely differences in account-level supporting details.

The original July transport reconciliation is still **-184.4071**, decomposed as
**-114.36 of a June 30 cost billed July 1, minus 70.0471 of July cost absent at
SKU level**. The entire July difference is not a July payout correction.
Child-ASIN expense groups on June 8, June 30, July 2 and July 15 match independent
charges on June 9, July 1, July 3 and July 16 to cents; their aggregate differs by
only 0.0002 of native precision. Native shipment contents distinguish the two
separate 114.36 charges, avoiding an amount-only match.

The evidence narrows the defect to missing product/SKU associations: July's MSKU
response contains other tape SKU variants but no transport cost on the native
shipment's `BUTYL TAPE-stickerless`. It does not establish Amazon's internal
reason, such as a listing-lifecycle issue, or justify replacing every MSKU query
with child-ASIN data.

### Other missing fees persist across product aggregation levels

Fresh Canadian July MSKU and child-ASIN responses both omit coupon fees. The
July 11 CAD 2 participation event now independently matches Finances and
Settlement by native coupon/Settlement identifiers and amount, with no
compensating event found in the captured reference history. There is no observed
later Data Kiosk counterpart through September and no evidence proving a
zero-redemption cause. Company/SKU attribution remains unresolved.

Fresh German July MSKU and child-ASIN responses both return participation
16.0006 and performance 6.1702, versus two independently identified 16
participation charges and a 6.17 performance charge. The **German** missing net
expense is **15.9992**. The larger all-EUR deal gap of 16.0132 also includes small
differences in other marketplaces. The fee data lacks the deal-to-SKU link needed
to establish why the participation fee was omitted or assign its company.

### Changing product aggregation does not generally remove extra costs

Three additional child-ASIN RANGE queries exactly reproduce current MSKU totals:

| Market/month/type | Both product aggregations | Independent billed control |
| --- | ---: | ---: |
| US July disposal | 219.12 | 198.69 |
| US August disposal | 57.50 | 33.96 |
| US August placement | 1,470.08 | 636.92 |
| Australia August disposal | 46.66 | 23.56, including a separate 0.23 earlier-operation charge |

Thus the disposal/placement discrepancies persist in Amazon's parent totals at
both product levels. All 17 non-advertising type/currency comparisons across
these three scopes agree between the two product aggregations. This rules out a simple switch to child-ASIN queries as a
general repair. The German diagnostic also returned different disposal totals at
the two levels; those alternative values have not been independently established
as correct and are not production inputs. Only the transport recovery has the
corroboration described above.

### Verified links to saved reports

All **1,336 July Data Kiosk-category source rows** are present in the latest July
reports with identical amounts. There is no publication-stage difference that
removes the suspect costs before they reach the company calculation.

- The USD 20.43 July disposal overlap appears under both
  `MICAL_SEAL_stickerless` (Company A) and `MICAL_SEAL-stickerless` (Company B).
  Removing one copy would increase combined calculated payouts by 20.43, but
  the correct SKU/company allocation is not established by equal payloads.
- The EUR 12.58 July disposal overlap appears under `EG_BLACK` and
  `ELG_Black_EU`, both assigned to Company B. Removing one copy would increase
  that company's July EUR report by 12.58. This is a conditional correction
  amount, not an approved deletion rule.
- July German transport costs of 35.5129 are charged to Company A's
  `ELG_Clear_stickerless`; 17.50 is charged to Company B's `ELG_Black_EU`.
  The saved reports preserve the total of 53.0129 exactly.

The repeated US August placement amounts are already in current estimates:
200 applies to Company A and 633.16 to Company B. Removing those additional
amounts, if approved after source attribution, would raise their estimates by
those amounts. For the Australian August disposal cohort, the removal report
identifies `Eyeliner` (Company B); the extra matching Data Kiosk deduction is on
`Flat_Black` (Company A). Removing that extra copy would raise Company A's
estimate by 23.33. Neither case has a saved August payout yet.

Company names here are the local fixture assignments. Saved reports retain their
own pinned terms; the evidence uses those terms rather than assuming current
ownership applies retroactively to an already frozen amount.

### Ownership gaps are blocked, not silently deducted from another company

Eleven September Japanese Sponsored Products rows, totaling **JPY 6,888.51**,
lack ownership: nine for `ELG_black_stickerless` and two for
`Flat_Ash Brown-stickerless`. Live resolution is `MISSING_OWNERSHIP`, and company
amount is null. Strict totals reject the unresolved scope; automatic payout
generation also rejects missing ownership in the company's seller scope.

No September report exists. This is a configuration blocker for future reporting,
not a confirmed paid overstatement or a zero-valued cost. No owner was assigned
as part of this investigation.

## Differences that have verified counterparts

- **Monthly storage:** all 25 comparable June–August marketplace/service-month
  cohorts agree with the following month's Settlement charge to cents. This
  establishes delayed agreement, not a reason to shift application dates.
- **Removal/disposal timing:** native operation IDs explain UK July disposal
  GBP 54.02 and removal GBP 8.33, Canadian July disposal CAD 5.76, and EUR 5.18 of
  July disposal. The underlying costs have matching later charges.
- **Aged storage:** checked July/August totals agree for US, Canada, UK and
  Australia; Japanese fees also agree with independent Finances records.
- **Japan labeling:** July JPY 17,094 and August JPY 22 agree with Finances base
  and tax components. A fresh September Finances query returned 1,980 transactions
  across four pages; all five labeling charges match Data Kiosk, totaling
  **JPY 17,226**. Data Kiosk shows two 390-unit / JPY 8,580 entries on September 2
  and 4. Finances has different released transaction IDs on those dates, each
  with JPY 7,800 base plus 780 tax. These are separate billed transactions;
  Finances does not independently establish their physical unit quantities.
  Equal Data Kiosk amounts alone do not establish duplication.
  Japan still has no imported Settlement statements. Its
  large absent-Settlement comparison does not by itself establish an erroneous
  Data Kiosk cost; SKU allocation was not independently proven for labeling.

These conclusions apply to the checked cohorts, not every fee or future capture.
Singapore storage lacks enough later Settlement evidence for the same conclusion.

## Advertising remains unresolved

The July account differences for the advertising family are USD -1,660.40,
GBP -1,379.96, EUR -1,355.05 and AUD -273.66. Under a hypothetical same-period,
same-scope comparison, less-negative Data Kiosk costs would overstate company
amounts. Invoice periods, adjustments and SKU allocations have not yet been
established, so these numbers are **not confirmed payout errors**.

For the US, Settlement and Finances agree on 17 charges totaling 8,535.86, while
Data Kiosk returns 6,875.46. Both MSKU and CHILD_ASIN RANGE queries reproduce that
Economics amount. Amazon Ads invoice access is still required to explain the
remaining scope/period difference; this investigation does not resume that
deferred work. See the [advertising evidence](reconciliation_refresh_2026-10-01.md).

## Evidence and limits

The [non-advertising investigation](non_ad_reconciliation_2026-10-01.md) contains
the native operation links, capture comparisons and specific attribution limits.
The [broader Financial review investigation](financial_review_differences_2026-10-02.md)
separates other categories whose mature payout authority is Settlement.

The public [missing-fee issue #4928](https://github.com/amzn/selling-partner-api-models/issues/4928)
mentions inbound placement/transport and AWD fees. Its
[support response](https://github.com/amzn/selling-partner-api-models/issues/4928#issuecomment-4478138735)
requests account-level investigation; it does not prove that our discrepancies
share an internal cause or that a repair occurred.

Local read-only audit evidence is retained under
`output/data-kiosk-payout-audit-2026-10-02/`. No financial facts, fees, ownership,
report snapshots, source-selection rules or production date ranges were changed.
