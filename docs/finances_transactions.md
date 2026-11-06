# Finances transactions

Finances API `2024-06-19` supplies native transactions through `listTransactions` and independent
account totals through `listSummary`. The application archives complete response pages, validates
an observation in Python, and atomically publishes stable transaction identities, immutable
transaction versions, and their monetary components. Unchanged transactions reuse their existing
versions across successful preprocessing batches.

Company allocation remains separate from Amazon account reconciliation. Finances supplies mature
Finances and SelBox category amounts. Data Kiosk supplies its allocated company-cost category at all
ages and recent estimates for the other monetary categories. The existing two-calendar-month
[maturity policy](source_allocation.md) is an application cutoff, not a promise of Amazon finality.

## Acquisition scope and archives

Each acquisition declares one seller credential scope, a date range within one calendar month,
and its marketplace roster. Requests remain regional and unfiltered by marketplace, account,
status, order or SKU. Marketplace filtering can omit US merchant-fulfilled activity.
[Amazon API reference](https://developer-docs.amazon/sp-api/reference/listtransactions).

The UTC request envelope covers each declared marketplace's local midnight through the exclusive
midnight after the last requested date, including daylight-saving rules. Records in the envelope's
padding remain archived but do not enter the requested local-date scope. Follow every continuation
token, even after an empty page. Completing retrieval establishes what was fetched, not that Amazon
has supplied every economic event or will never revise it. `postedAfter` filters posting dates,
not modification dates; older changes require explicitly retrieving their posting periods again.

Raw transaction and Summary pages remain exact XZ archives in private `source-archives` Storage.
Each manifest retains request parameters, operation/page numbers, capture times, document/archive
hashes, lengths and object locations. Downloads write archives and a local acquisition manifest.
Acquisition metadata enters PostgreSQL only with a successful preprocessing batch. Failed parsing,
missing transactions or failed Summary validation produce local logs and no accepted database rows.
The [sync guide](../services/sync/README.md) owns the executable download/replay commands.

Native `Non-Amazon US`, `Non-Amazon DE`, and `Non-Amazon IT` remain distinct financial channels.
The registry binds each to its credential scope and local time zone. They do not become Inventory
or Data Kiosk stores. Summary comparison groups Non-Amazon US with Amazon.com; native transaction
provenance and company fee matching keep the original channel. DE and IT retain separate scopes
until a correspondence is established. Currency never supplies a missing marketplace.

The downloader splits requests at month boundaries and enforces Amazon's date-window limits.
Historical marketplace coverage may need an explicit known roster; unsupported source markets fail
preprocessing. Credentials stay in service configuration and never enter archive manifests.

## Six-table model

| Table                                            | One row represents                                                                                                                                                |
| --- | --- |
| `private.finances_acquisitions`                  | Archived retrieval metadata and complete page manifest, saved with its first successful preprocessing.                                                            |
| `private.finances_preprocess_batches`            | One successful preprocessing of an acquisition, with processor version and transaction/component inventory counts.                                                |
| `private.finances_transactions`                  | Stable `(seller_namespace, amazon_scope, native_transaction_id)` identity, selecting `current_version_id` and `current_batch_id`.                                 |
| `private.finances_transaction_versions`          | One immutable normalized transaction state: posting details, marketplace/account, status, lifecycle links, eligibility, total/currency and content hash.          |
| `private.finances_transaction_components`        | One immutable component within a transaction version, numbered within that version, with SKU, amount, optional quantity/fee base and native breakdown provenance. |
| `private.finances_preprocess_batch_transactions` | One observed transaction/version in a successful batch, including that capture's source page and record numbers.                                                  |

Batch membership includes unchanged reused versions. A batch with no transactions is still a
successful observation with a declared scope. Full source JSON remains in page archives. Components keep
`breakdown_path`, `item_index` and `breakdown_indexes`; transaction-wide fields are stored once on
the parent version. Page/record locations belong to batch membership because pagination can change
without changing a transaction's normalized state.

The transaction's current pointer selects one version observed by its current batch. Both pointers
must identify the same membership. A version has no originating-batch field: several batches can
observe it, and a later observation can return to a previously stored state. Content hashes cover
normalized stored state and exclude observation locations. Processing labels remain on batches.

For example, two captures of transaction A with unchanged amounts/status produce two batches and
two memberships, but one transaction version and one component set. If its status or financial
contents change, publication stores another version and moves A's pointers. Prior versions remain
immutable. Current reads select each transaction's pointer; historical batch reads use membership,
not whatever is current today.

## Preprocessing and publication

Python validates the complete candidate before writing accepted evidence:

- Verify archive integrity, pagination, declared marketplace/date scope and native identities.
- Reject conflicting duplicates and a previously accepted ID missing from the later retrieval's
  comparable scope. Existing records outside that scope do not count as missing.
- Validate native dates, currencies, nested amount partitions, supported monetary paths and the
  complete component inventory.
- Resolve original/release links using incoming and accepted identities. An affected transaction
  outside the proposed capture cannot have its eligibility silently changed.
- Match every required Amazon Summary account/currency scope, including zero-activity scopes.
- Reject older acquisitions that would replace newer accepted observations.

A failure leaves previous current selections intact and is logged locally. A successful publication
locks the relevant seller/credential scope and shares the payout-input guard, then writes acquisition
metadata, batch, new versions/components, all memberships and pointer changes in one transaction.
It never combines unvalidated partial captures into a certified monthly result.

PostgreSQL enforces keys, same-identity references, immutable records, complete child inventories,
and atomic selection. It does not repeat the Finance amount, lifecycle or Summary checks.
Successful source changes request payout refreshes and rotate the source revision token.

## Native transactions and monetary components

Normalize item breakdown leaves when items exist; otherwise use transaction-level breakdowns.
Each nested subtotal must equal its children, each item partition must equal its item total, and
all components must equal the native transaction total in the same currency. Parent totals are
controls over the same money, not extra amounts to add.

An $85 shipment might contain $100 of product sales and a −$15 referral fee. It has one native
transaction version and two monetary components. Its independent $85 source total detects an
omitted fee; the components support SKU attribution and distinct sales/fee calculations.

The explicit paths in
[`transaction_types/finances.py`](../services/sync/src/transaction_types/finances.py) map native detail
to types such as `PRODUCT_SALES`, `REFERRAL_FEES` and `DISPOSAL_FEES`. Missing nonzero detail or an
unknown path fails preprocessing. Source SKU text remains exact. Zero amounts and SKU-less account
facts remain evidence; missing product attribution is never invented.

Service-fee bases are signed product sales/refund amounts. Other components do not repeat shipment
quantities. Unknown quantities differ from zero. Amounts use exact decimal arithmetic and reach the
frontend as strings.

## Activity and Summary validation

Activity excludes `Transfer`, records with `DEFERRED_TRANSACTION_ID`, and records identified as
releases by another transaction's `RELEASE_TRANSACTION_ID`. Original `DEFERRED` and
`DEFERRED_RELEASED` activity and directly released events remain eligible. Equal amounts, orders or
SKUs do not prove duplication. Contradictory links, self-links and unsupported statuses fail.

For the same seller, mapped Summary marketplace, account type, currency and requested local dates:

```text
sum(eligible native transaction totals)
    = sum(their normalized component amounts)
    = listSummary.netProceeds
```

Summary is independently retrieved account evidence, never another company component. Missing,
unavailable or mismatched controls reject the whole preprocessing batch. Exact Summary response
bytes remain in the archives; successful batch membership records the precise input versions that
passed validation. A match does not certify Data Kiosk's SKU cost allocation.
[Amazon Summary scope](https://developer-docs.amazon/sp-api/docs/retrieve-financial-summary).

## Payouts, history and reads

Payouts pin successful Finance batches through `private.payout_report_finances_batches`, Data Kiosk
day versions and SKU terms. Finance membership identifies the exact immutable transaction versions
and component IDs used. Saved reports keep those inputs after later source changes. Publication
requires a coherent successful batch covering the required monthly scope whose membership matches
current transaction versions. An older successful batch cannot certify newly changed contents.
This is input selection, not another Finance business-validation pass.

Finance acquisitions, batches, memberships, transaction versions and components have no history
cap and are not pruned. Data Kiosk retains its separate latest-three-observation pruning policy.
Raw page archives remain indefinitely in either workflow.

Administrator source views expose retained transaction versions, including releases and transfers.
Company Transactions and Financial review select current activity according to allocation rules.
An acquisition is an explicit command; payout scheduling does not call Amazon. Use calendar-month
retrievals for monthly payout refreshes. A partial capture can update transactions, but cannot
certify a changed whole month through an older batch. The [payout contract](company_payout_reports.md)
and [schema reference](database_schema.md) describe the exact read and reference relationships.
