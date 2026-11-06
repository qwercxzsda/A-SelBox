# Data workflows

Amazon retrieval, offline preprocessing and company calculations are separate steps. Downloads
preserve source evidence; preprocessing publishes accepted source facts; reads apply current SKU
terms; the payout worker freezes the exact inputs and amounts used for a company month.

| Source     | Downloaded evidence                                      | Accepted result                                                                         | History                                                                            |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Finances   | Transaction/Summary pages and local acquisition manifest | Stable transaction identities, immutable versions/components and exact batch membership | All accepted versions retained; unchanged states reused                            |
| Data Kiosk | Complete query/document inventory                        | Complete seller/marketplace/day/dataset versions                                        | Current, latest three independent observations and payout-pinned versions retained |
| Inventory  | Full Inventory Planning report                           | One capture per seller/marketplace/day                                                  | Same-day capture replaced atomically; prior days and raw acquisitions retained     |

The [Finances contract](finances_transactions.md), [Inventory contract](inventory_daily_captures.md),
[type registry](transaction_type_registry.md) and [source-allocation policy](source_allocation.md)
own their detailed rules. [Sync commands](../services/sync/README.md) and the
[database guide](../services/db/supabase/README.md) own execution and verification.

## Persistence and naming

An acquisition identifies a retrieved observation and its immutable archive manifest. A preprocessing
batch records a successful interpretation of that acquisition. Finance acquisition metadata enters
PostgreSQL with its first successful batch; downloads and failed preprocessing use local manifests
and logs. Data Kiosk and Inventory persist successful acquisition metadata before preprocessing.

Finance components reference `finances_transaction_versions`; batch membership records every observed
transaction/version, including reused states. Stable transaction identities select a version and its
observing batch. Data Kiosk components instead belong to complete day versions selected by day
identities. Inventory uses a single successful capture header rather than financial versions.

Financial interpretation is identified by `PREPROCESS_VERSION`. Change it when parsing,
classification, local dates or activity eligibility change, and explicitly reprocess archived inputs.
SKU terms have their own immutable versions. Imports never register ownership or invent fee rates.

Local objects use UUIDv7. Observation order comes from Finance capture start/acquisition identity or
Data Kiosk root-query creation/acquisition identity; processing an old download does not make it a
new Amazon observation. Inventory follows the original report creation time.

## Download and archive

Retrieve every page, including continuation tokens on empty pages. Finance requests use the declared
seller/marketplace roster and explicit monthly date windows; Data Kiosk retains the pinned query,
schema and ordered document inventory. Finished retrieval is evidence of the request's result, not
Amazon finality. `postedAfter` filters posting time, so older Finance changes need another retrieval
of the affected period.

### Compression and integrity

Each source document/page is archived without rewriting its decoded bytes:

1. Remove declared transport compression and calculate the document's SHA-256 and length.
1. Compress as XZ preset 2e with CRC64, then verify exact decompression.
1. Upload to private Storage and compare the downloaded archive bytes with the upload.
1. Retain the object path and independent compressed/document hashes and lengths in the manifest.

Storage and PostgreSQL do not share a transaction. Failed publication can leave uploaded evidence;
it may be shared or already referenced after an uncertain commit. Preserve it for investigation.
Raw archives are retained indefinitely. Credentials, temporary signed URLs and source bodies do not
enter logs. Missing or corrupt archived input fails offline replay without contacting Amazon.

## Finances preprocessing

Python checks identity/scope, lifecycle links, monetary partitions and every required Summary
control against the complete proposed transaction set. A previously accepted ID missing from the
same retrieval scope rejects the batch. All accepted changes and observation memberships publish
atomically; failures leave prior selections intact and create local logs only.

PostgreSQL enforces structural keys, immutable records, child inventories and consistent selected
pointers. It does not repeat Finance business validation. See the [six-table model and validation
contract](finances_transactions.md#preprocessing-and-publication) for exact rules and field placement.

## Data Kiosk preprocessing

Read complete archived acquisitions into daily versions, preserving native SKU, currency, fee
subperiod, quantities, component dimensions and source references. `(SKU, marketplace, day)` alone
is not a component key. Preserve signs and avoid adding parent totals to their child breakdowns.
Missing amounts and quantities remain unknown rather than zero.

Validate `netProductSales = orderedProductSales - refundedProductSales` and
`netUnitsSold = unitsOrdered - unitsRefunded`. Negative refunds retain their signs. Nonblank MSKU
text stays verbatim. Unknown fees, missing required collections and invalid equations fail before
publication; the acquisition remains available for investigation.

Only dates preceding the query's local creation date are complete. A successful empty day selects
zero children. A missing SKU remains absent in the replacement observation instead of falling back
to an older row. `ANALYSIS_ONLY` components stay diagnostic. The
[source policy](source_allocation.md) defines the categories used for company amounts.

## Atomic publication

Finance publishes under seller/credential-scope and payout-input locks; Data Kiosk locks day identities
in stable order and verifies expected selections. Each batch commits in one transaction. Current
Finance reads follow transaction pointers; captured reads follow batch membership. Data Kiosk reads
follow selected day versions. A partial Finance capture cannot certify a changed whole month through
an older batch.

Changed source/terms inputs rotate revision tokens and request payout work. Browser reads reload only
when relevant tokens change. The payout worker uses published data and never downloads from Amazon.
The maturity cutoff is an eligibility policy, separate from retrieval and publication success.

## Retention and comparisons

Finance retains acquisitions, batches, memberships, versions and components without a cap. Data Kiosk
keeps current versions, its latest three independent observations per day and payout-pinned versions.
Multiple reprocessings of one acquisition count as one observation. Comparison uses complete content
digests under compatible processing definitions; equal totals alone do not prove equal contents.

Data Kiosk pruning locks the day, rechecks references, records a pruning marker and removes only
eligible payloads. Headers, original counts and archives remain, distinguishing pruning from a
successful empty day. Reprocessing archives creates a new result. Finance history is not pruned.

## Company terms and payouts

[SKU terms](company_fees.md) select exact-SKU ownership and marketplace/date fee rates. Changes restate
live calculations; saved reports retain their original inputs. The [payout contract](company_payout_reports.md)
owns monthly eligibility, coherent Finance batch selection, Data Kiosk coverage, queueing and frozen
results. Summary agreement validates Finance account activity, not Data Kiosk's SKU cost allocation.

## Exact values and failures

Python `Numeric` uses finite exact decimals with a 1,000-digit source bound. Source numeric domains
have no fixed scale, and over-bound values fail without rounding. Fees preserve exact arithmetic;
frontend transport uses decimal strings. The [known issues](known_issues.md) distinguish upstream
uncertainty from publication and operational limits.
