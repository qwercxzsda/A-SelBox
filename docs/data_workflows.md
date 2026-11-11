# Data workflows

Amazon retrieval, offline preprocessing and company calculations are separate steps. Downloads
preserve source evidence; preprocessing publishes accepted source facts; reads apply current SKU
terms; the payout worker freezes the exact inputs and amounts used for a company month.

| Source     | Downloaded evidence                                      | Accepted result                                                                         | History                                                                            |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Finances   | Transaction/Summary pages and local acquisition manifest | Stable transaction identities, immutable versions/components and exact batch membership | All accepted versions retained; unchanged states reused                            |
| Data Kiosk | Complete query/document inventory                        | Stable day identities, immutable complete-day versions/components and exact batch membership | All accepted versions retained; unchanged states reused                         |
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

Both financial sources use these six table roles in the `private` schema:

| Meaning | Finances | Data Kiosk |
| --- | --- | --- |
| Retrieved source and archive inventory | `finances_acquisitions` | `data_kiosk_acquisitions` |
| Successful preprocessing | `finances_preprocess_batches` | `data_kiosk_preprocess_batches` |
| Stable identity | `finances_transactions` | `data_kiosk_days` |
| Immutable normalized state | `finances_transaction_versions` | `data_kiosk_day_versions` |
| Monetary components within a version | `finances_transaction_components` | `data_kiosk_day_components` |
| Versions observed by each batch | `finances_preprocess_batch_transactions` | `data_kiosk_preprocess_batch_days` |

Each stable identity selects a version and its observing batch through `current_version_id` and
`current_batch_id`. Membership records every successful observation, including reused states.
Neither source version has an originating batch. Inventory uses a single successful capture header
rather than financial versions.

Financial interpretation is identified by `PREPROCESS_VERSION` (currently `v7`). Change it when parsing, filtering,
classification, local dates or activity eligibility change, and explicitly reprocess archived inputs.
SKU terms have their own immutable versions. Imports never register ownership or invent fee rates.

Local objects use UUIDv7. Observation order comes from Finance capture start/acquisition identity or
Data Kiosk root-query creation/acquisition identity; processing an old download does not make it a
new Amazon observation. Inventory follows the original report creation time.

## Download and archive

Retrieve every page, including continuation tokens on empty pages. Finance requests use the declared
seller/marketplace roster and UTC timestamp bounds. Routine Finance refreshes start at the maturity
cutoff and omit the upper bound, including available current-day activity; Data Kiosk retains the
pinned query, schema and ordered document inventory. Finished retrieval is evidence of the request's result, not
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

Python checks identity/scope, lifecycle links and monetary partitions for every observed transaction.
Summary controls compare only the separate interval of complete marketplace-local days inside the
UTC retrieval window. Partial boundary days remain valid observations without claiming complete-day
coverage. A previously accepted ID missing from the comparable UTC retrieval interval rejects the
batch. All accepted changes and observation memberships publish atomically; failures leave prior
selections intact and create local logs only.

PostgreSQL enforces structural keys, immutable records, child inventories and consistent selected
pointers. It does not repeat Finance business validation. See the [six-table model and validation
contract](finances_transactions.md#preprocessing-and-publication) for exact rules and field placement.

## Data Kiosk preprocessing

Read complete archived acquisitions into daily versions, preserving native SKU, currency, component
identity, signed amounts, quantities and fee bases as typed values. Component identities distinguish
native fee subperiods; `(SKU, marketplace, day)` alone is not a component key. Preserve signs and avoid
adding parent totals to their child breakdowns. Missing amounts and quantities remain unknown rather
than zero. Classification and fee eligibility belong to preprocessing.

Preprocessing also assigns the UTC reporting `activity_at` for each complete day: convert the next
marketplace-local midnight to UTC using the source timezone registry, then subtract one microsecond.
This respects 23-hour and 25-hour days. The original `activity_date` still governs fee periods and
payout months. The normalized instant is part of the immutable day version and content hash;
changed interpretation produces a new version. PostgreSQL indexes and filters that stored value
without a second timezone catalog or source-normalization function.

Python validates Amazon acquisition metadata, successful processing status, document identity,
and complete pagination before publication and again when constructing archived acquisition
models for replay. SQL stores that raw metadata as evidence without interpreting Amazon API
fields. Its publisher enforces normalized manifest structure, unique identities, and atomic
idempotent writes. Seller-namespace validation lives in the source domain rather than a database
repository, so acquisition and preprocessing models do not import persistence helpers.

Validate `netProductSales = orderedProductSales - refundedProductSales` and
`netUnitsSold = unitsOrdered - unitsRefunded`. Negative refunds retain their signs. Nonblank MSKU
text stays verbatim. Unknown fees, missing required collections and invalid equations fail before
publication; the acquisition remains available for investigation.

After validation, omit components whose `amount` is zero and whose `quantity` and `fee_base`
are each zero or null. Day hashes and row counts use only retained components. Detail belonging
to omitted components remains in the raw archives; changes confined to that detail do not change
the day hash. Keep the day version even when all components are omitted.

Reuse a day version and its entire component set when its normalized contents match an existing
version for that day. A changed component creates a new complete day version; a return to a previous
state reuses that earlier version. Hashes exclude preprocessing labels and archive document/line
positions. Labels belong to successful batches. Nested source JSON stays in compressed archives,
not in normalized rows. To inspect the original row, use the selected batch's acquisition archive,
day, SKU and deterministic component key.

Only dates preceding the query's local creation date are complete. A successful empty day selects
zero children. A missing SKU remains absent in the replacement observation instead of falling back
to an older row. `ANALYSIS_ONLY` components stay diagnostic. The
[source policy](source_allocation.md) defines the categories used for company amounts.

## Atomic publication

Finance publishes under seller/credential-scope and payout-input locks; Data Kiosk locks day identities
in stable order and verifies expected selections. Each batch commits in one transaction. Current
Finance reads follow transaction pointers; Data Kiosk reads follow day pointers. Both select an
observing batch as well as a version. Historical reads follow exact batch membership. A partial
Finance capture cannot certify a changed whole month through an older batch.

Changed source/terms inputs rotate revision tokens and request payout work. Browser reads reload only
when relevant tokens change. The payout worker uses published data and never downloads from Amazon.
The maturity cutoff sets payout eligibility and the default Finance refresh lookback. Neither
retrieval nor publication establishes Amazon finality.

## Immutable history

Finance and Data Kiosk retain acquisitions, successful batches, memberships, versions, components
and raw archives indefinitely. Reprocessing creates a new batch and reuses unchanged normalized
versions. Current selections may advance without rewriting historical contents. Empty versions
retain successful coverage with no fabricated monetary rows. Payout references identify exact
transaction/day versions and company terms directly; reports retain compact validated coverage
intervals for their original scope. A new observation of unchanged versions does not create another
payout.

## Company terms and payouts

[SKU terms](company_fees.md) select exact-SKU ownership and marketplace/date fee rates. Changes restate
live calculations; saved reports retain their original inputs. The [payout contract](company_payout_reports.md)
owns monthly eligibility, source-version selection, coverage, queueing and frozen
results. Summary agreement validates Finance account activity, not Data Kiosk's SKU cost allocation.

## Exact values and failures

Python `Numeric` uses finite exact decimals with a 1,000-digit source bound. Source numeric domains
have no fixed scale, and over-bound values fail without rounding. Fees preserve exact arithmetic;
frontend transport uses decimal strings. The [known issues](known_issues.md) distinguish upstream
uncertainty from publication and operational limits.
