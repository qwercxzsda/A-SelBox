# Finances source verification — October 14, 2026

Newly downloaded `listTransactions` and `listSummary` responses matched **19 independent
account controls** across five seller credential scopes. This record preserves the Amazon-source
findings. The implementation used for the dated checks has since been replaced; its SQL publisher,
daily Finance snapshots and test-suite counts are not current application contracts.

## Captured source results

| Scope and period | Complete native marketplace days | Native transactions | Components | Matched controls |
| --- | ---: | ---: | ---: | ---: |
| [Japan August](finances_2026-10-14/japan-2026-08-result.json) | 31 | 1,863 | 13,009 | 1 |
| [North America September](finances_2026-10-14/na-2026-09-result.json) | 120 | 2,541 | 13,939 | 4 |
| [Europe August](finances_2026-10-14/eu-2026-08-result.json) | 372 | 10,171 | 68,012 | 12 |
| [Australia August](finances_2026-10-14/australia-2026-08-result.json) | 31 | 1,075 | 6,467 | 1 |
| [Singapore August](finances_2026-10-14/singapore-2026-08-result.json) | 31 | 1 | 1 | 1 |

Every result JSON preserves the actual counts and separate marketplace/account/currency controls.
The displayed day count records the requested marketplace-days, including verified empty days.
Original aggregate JSON keys retain the terminology of that dated run. North America's four
native channels include `Non-Amazon US`, whose activity is grouped into the US Summary control while
its native marketplace remains distinct in source facts.

Examples of exact activity controls:

- Japan August: **-72,792 JPY**.
- North America September: **37.32 CAD**, **0 MXN**, and **904.32 USD**, with US
  Standard Orders **891.89 USD** and Invoiced Orders **12.43 USD** retained separately.
- Australia August: **1,090.37 AUD**.
- Singapore August: **-0.01 SGD**.

Signed native parent totals equaled their complete component partitions and the independent Summary
amounts. The parser used for the capture verified original/release identities and, where both records were
present, their seller, account, marketplace, type, currency and amount relationships. Summary seller
identity was checked against native transaction seller identity without publishing identifiers.
Two European service-fee records had empty optional `ORDER_ID` values: those remain preserved raw
without becoming lifecycle identifiers. Empty or conflicting lifecycle identifiers still fail.

These runs used file-backed private archives and an isolated PostgreSQL baseline. They did not send
Amazon mutations or alter company fee rules. The raw responses and acquisition manifests remain
under `output/finances-implementation/live/`, outside version control.

## Interpretation limits

The account control sums current-version native activity exactly once: original activity and
direct financial events contribute; linked release copies and `Transfer` do not. Zero amounts and
SKU-less source events remain present. Parent totals are checked against components, not added to
them. Dates, account types, currencies and Summary marketplace scope must match.

`listSummary` is an account control and has no SKU dimension. These matches establish neither
business ownership nor Data Kiosk's per-SKU cost correctness. Company payouts additionally apply
current SKU terms and the [source allocation policy](../source_allocation.md). Data Kiosk remains
authoritative for its company-cost category; advertising allocation and other upstream Data Kiosk
issues require their separate investigations.

## Earlier independent checks

On October 6, the supplied August 2026 monthly PDFs were reconstructed from Finances activity:

| Report | Native activity net | Summary net | PDF net before transfers | Detail lines matched |
| --- | ---: | ---: | ---: | ---: |
| United States | 4,219.76 USD | 4,219.76 USD | 4,219.76 USD | 22 nonzero lines |
| Japan | -72,792 JPY | -72,792 JPY | -72,792 JPY | 20 nonzero lines |

The US report includes Standard and Invoiced Orders and uses Pacific local dates; Japan uses Japan
local dates. Transfers appear separately. PDF headings group some transaction components
differently from application categories, so matching only names is insufficient.

On October 8, fresh Summary responses and retained complete transaction captures matched **38
marketplace/account/month controls across 18 marketplaces** for July and August, using **16,881
selected activity transactions**. This was an independent calculation over retained captures, not
the later production pipeline run above. Five controls had zero activity. Australia's August
control included **126.61 AUD debt recovery**: excluding all balance movements would break the match.

Amazon documents original activity, transaction statuses and release links; it does not publish
its complete internal Summary algorithm. The integration rule is therefore empirically verified
against Amazon's output, with continuing exact checks on new captures.
[Transaction reference](https://developer-docs.amazon/sp-api/reference/listtransactions),
[Summary guide](https://developer-docs.amazon/sp-api/docs/retrieve-financial-summary).

Private replay evidence remains under `output/pdf-summary-investigation-2026-10-06/` and
`output/summary-rule-verification-2026-10-08/`. The original PDFs and captures remain archived.

## Availability and history probes

October 7 probes tested the project's 23 configured marketplace candidates. Eighteen accepted
transaction requests. Brazil, Egypt, India, Turkey and South Africa reported that this seller had
no financial account; those markets were also absent from the seller's marketplace registrations.
This was account-specific availability, not evidence of a global API exclusion. Amazon documents
Finances availability in NA, EU and FE.
[Operation coverage](https://developer-docs.amazon/sp-api/docs/finances-api).

Historical existence probes retrieved October 10, 2024 transactions in all five credential scopes
on October 7, 2026, when that date was within the observed two-year lookback. January 2024 queries
were rejected because the start preceded two years. These were existence probes, not a complete
historical backfill. The separate maximum 180-day request span is documented; the rolling two-year
start limit was observed in real responses. Private records remain under
`output/finances-availability-2026-10-07/`.

Current behavior and reproducible checks belong to the [Finances contract](../finances_transactions.md)
and [database verification guide](../../services/db/supabase/README.md#verification). These source
findings do not make a response atomic, prove future finality or establish unknown SKU ownership.
