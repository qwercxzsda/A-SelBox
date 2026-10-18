# Amazon source refresh and Financial review visibility — October 18, 2026

The UI and maturity observations below describe the earlier paged month/currency layout and its
partial-month eligibility. The current [Financial review](../financial_review.md) uses a selected
year and currency, with monthly and running differences, and includes only fully mature calendar
months matching payout reports. The source-coverage verification is unchanged.

The database serving the public preview was refreshed from Amazon and verified to
have daily capture coverage from **January 1 through October 16, 2026**, inclusive.
This is year-to-date coverage, not the entire calendar year. At refresh time,
October 16 was the latest complete day shared by all configured marketplace time
zones; October 17 was still in progress in North America.

## Fresh acquisition and publication

The existing public preview routes to API port `55621` and database port `55622`.
The refresh used that database, not another running local instance. Fresh October
1–16 acquisitions were downloaded, preprocessed using version `v3`, archived and
published through the normal source workflows.

| Check | Finances | Data Kiosk |
| --- | ---: | ---: |
| Fresh acquisitions | 5 credential scopes | 18 marketplaces |
| Selected October daily versions | 304 | 288 |
| Current marketplace/channel coverage | 19 native scopes | 18 retail marketplaces |
| Selected days, January 1–October 16 | 5,491 | 5,202 |
| Current components | 811,558 | 81,621 |
| January–September version selections preserved | 5,187 | 4,914 |

Finances contains 127,549 current native transactions. All **190 current monthly
Amazon Summary controls match**, including all 19 fresh October 1–16 controls.
There are no missing requested daily versions, incompatible current versions, or
activity groups lacking their expected Summary control.

Data Kiosk has 3,782 current October components. Every requested marketplace/day
has a complete compatible capture; current version row counts match their stored
components, and no current versions are pruned. Amazon returned successful empty
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

Payout scheduling remained active throughout the refresh. The independently
checked five-minute job completed successfully at 04:10 UTC. Maturity policy,
allocation rules, source authority, fee rates and ownership were unchanged.

## Why months looked incomplete

Three separate conditions explain the reported display:

1. **Maturity filtering.** Financial review compares dates strictly before
   `2026-08-18` at this observation. January–July are complete calendar months;
   August includes August 1–17. September and October are downloaded, but not yet
   eligible for Financial review. Their source records remain available in the
   Finances and Data Kiosk tabs.
2. **Currency-row pagination.** The default page contains 25 currency rows, not
   25 whole months. The first Data Kiosk category page contains August's nine
   currencies, July's nine, and seven of June's nine. June's remaining two
   currencies appear on page two. All eight eligible months and all 72 rows are
   present over three pages.
3. **April saved payout coverage.** April is present in live Financial review,
   including nine currencies and 1,674 Data Kiosk category source rows. Its saved
   company payout reports are separately blocked by three historical SKU
   identities without ownership. They affect 244 authoritative US Finances
   components with a net amount of $15.07. No ownership was inferred or assigned.

The website now states the exclusive maturity cutoff, labels the partial month
**Mature dates only**, labels month counts **N currencies on this page**, and
explains that a month can continue on the next page. These are presentation
clarifications; the eligibility and pagination rules are unchanged.

## Verification

- 38 authenticated requests through the public preview returned HTTP 200. The
  frontend's paginated results exactly matched the full monthly RPC results:
  Data Kiosk 72 rows, Finances 72, SelBox 68. No rows were missing or duplicated.
- Two further requests using the actual frontend source client retrieved October
  16 successfully: 4,275 Finances rows and 212 Data Kiosk rows. All 25 sampled rows
  from each source matched the requested day. These are source-view row counts,
  not counts of native Amazon transactions.
- A real browser walkthrough at 1440 × 1100 verified all three Data Kiosk review
  pages, all eight eligible months and all 72 currency rows, before and after the
  copy change. Updated labels are visible; no browser errors, failed source
  requests or horizontal page overflow were observed.
- 17 relevant frontend unit tests, targeted lint/format checks and the production
  build passed. The updated build is active on the existing public preview.

Sanitized aggregate results are saved in
[the refresh verification JSON](source_refresh_2026-10-18.json). Raw acquisition
archives, before/after version IDs, API checks and browser screenshots remain in
ignored local output directories under `output/source-refresh-2026-10-18/` and
`output/financial-review-month-audit-2026-10-18/`. They are not application setup
instructions or a claim of source monetary correctness.
