# European non-retail Summary grouping

Verified on November 7, 2026 using the preserved EU acquisition captured at
`2026-11-05T17:32:47.134918Z`, covering October 1–31, 2026 in marketplace-local dates.
The check independently decoded and verified the archived response pages, deduplicated native
transaction IDs, excluded transfers and linked release copies, and summed `totalAmount`.
It did not use component classification or the application's Summary marketplace mapping.

| Retail marketplace | Retail activity | Native channel | Channel activity | Combined activity | Amazon Summary |
| --- | ---: | --- | ---: | ---: | ---: |
| Amazon.de | EUR 769.37 | Non-Amazon DE | EUR −7.36 | EUR 762.01 | EUR 762.01 |
| Amazon.it | EUR 583.74 | Non-Amazon IT | EUR −11.48 | EUR 572.26 | EUR 572.26 |

Both controls use `STANDARD_ORDERS`. The response contains no separate Summary rows for the two
non-retail channels. Validation therefore groups each channel into its corresponding retail control,
including when the declared channel has no activity. Account type, currency and complete date scope
remain separate, and mismatched or missing required controls still reject preprocessing.

This grouping applies only to Summary validation. Native transaction identities, local posting
dates, Data Kiosk comparisons, company fees and payout scopes remain unchanged. The check does not
establish a mapping for any other channel or promise finality of Amazon's source data.

The protected replay result is retained in
`output/rebuild-2026-11-07/eu-summary-channel-audit.private.json`; full responses remain archived.
