# Amazon source refresh — October 18, 2026

This record preserves the source coverage, Summary agreement and Data Kiosk response changes
observed on October 18, 2026. Its aggregate result file records that capture's counts and metadata.

The database serving the public preview was refreshed from Amazon and verified to
have daily capture coverage from **January 1 through October 16, 2026**, inclusive.
This is year-to-date coverage, not the entire calendar year. At refresh time,
October 16 was the latest complete day shared by all configured marketplace time
zones; October 17 was still in progress in North America.

## Fresh acquisition and publication

Fresh October 1–16 acquisitions were downloaded and archived from five Finances credential scopes
and 18 Data Kiosk marketplaces. The dated comparison used preprocessing version `v3`.

| Check | Finances | Data Kiosk |
| --- | ---: | ---: |
| Fresh acquisitions | 5 credential scopes | 18 marketplaces |
| Current marketplace/channel coverage | 19 native scopes | 18 retail marketplaces |
| Current components | 811,558 | 81,621 |

The retained Finances captures contained 127,549 native transactions. All **190 captured monthly
Amazon Summary controls matched**, including the 19 fresh October 1–16 controls.

Data Kiosk has 3,782 current October components. Every requested marketplace/day
has a complete compatible capture; current version row counts match their stored
components. Amazon returned successful empty
October responses for Mexico, Saudi Arabia, UAE and Singapore. An empty successful
response is recorded as coverage, rather than treated as an unrequested day.

The fresh October response contains fewer components: the previously selected
October 1–15 had 4,301 rows; the new response has 3,570 for those same dates, plus
212 on October 16. Of 755 removed row identities, 739 had zero amounts and 16 had
nonzero amounts; 24 nonzero identities were added and 14 retained identities
changed amount. The difference is therefore mostly zero rows, but not exclusively.
For example, the same-date US total increased $30.74 (advertising +$26.20 and
disposal +$4.54), while Canada's refund and related fee rows disappeared, changing
its net amount by C$30.80. These are observed response differences, not corrections
made locally. Capture timing and query-window effects have not been isolated.
Per-market amounts, currencies and the separately added October 16 amounts are
included in the verification JSON.

Coverage means the requested queries completed and their returned records were
published. It does not establish that Amazon has supplied every economically
expected charge, or that Data Kiosk's SKU allocations are correct. The
[deferred allocation discrepancies](sku_cost_allocation_feasibility_2026-10-18.md)
remain unresolved. Finances/Summary agreement is a separate control.

Sanitized source aggregates remain in [the original result file](source_refresh_2026-10-18.json).
Raw captures and private investigation records remain under `output/source-refresh-2026-10-18/`
and `output/financial-review-month-audit-2026-10-18/`. Current retrieval/publication behavior is
specified in the [Finances contract](../finances_transactions.md) and
[Data Kiosk workflow](../data_workflows.md#data-kiosk-preprocessing).
