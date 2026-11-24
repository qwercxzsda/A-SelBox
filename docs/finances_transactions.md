# Finances transactions

Finances API `2024-06-19` supplies native transactions through `listTransactions` and independent
account totals through `listSummary`. The application archives complete response pages, validates
an observation in Python, and atomically publishes stable transaction identities, immutable
transaction versions, and their monetary components. Unchanged transactions reuse their existing
versions across successful preprocessing batches.

Finances supplies the activity and posting dates for company calculation. The [allocation rules](source_allocation.md) specify the reference key for each fee.

## Acquisition scope and archives

Each acquisition declares one seller credential scope, a UTC `posted_after` timestamp, an optional
exclusive `posted_before` timestamp, and its marketplace roster. Routine refreshes start at UTC midnight three calendar months before the run date and omit `postedBefore`. Amazon then applies its
default upper bound of approximately two minutes before the request. Current-day records are
accepted; retrieval does not wait for a marketplace's local midnight or split at month boundaries.
Requests remain regional and unfiltered by marketplace, account, status, order or SKU. Marketplace
filtering can omit US merchant-fulfilled activity.
[Amazon API reference](https://developer-docs.amazon/sp-api/reference/listtransactions).

Every continuation keeps the same `postedAfter` and optional `postedBefore`, including after empty
pages. Capture and page timestamps record when the requests ran; an omitted upper parameter does
not assert one exact server snapshot time across all pages. Completing retrieval establishes what
was fetched, not that Amazon has supplied every economic event or will never revise it.
`postedAfter` filters posting dates, not modification dates. Repeated overlapping refreshes pick up
changes inside the lookback; older corrections need an explicit historical request.

The separate nullable `reconciliation_start_date` and `reconciliation_end_date` identify the common
interval of whole marketplace-local days entirely inside the retrieval window. For an open-ended
request, that interval stops before the conservative capture-start-minus-two-minutes boundary.
Amazon Summary checks apply only to those complete days. Partial boundary days still contribute
observed transactions, but never claim reconciled payout coverage. If no complete common local day
fits inside the request, both reconciliation dates are null and no Summary is requested.

Raw transaction and Summary pages remain exact XZ archives in private `source-archives` Storage.
Each manifest retains request parameters, operation/page numbers, capture times, document/archive
hashes, lengths and object locations. Downloads write archives and a local acquisition manifest.
Acquisition metadata enters PostgreSQL only with a successful preprocessing batch. Failed parsing,
missing transactions or failed Summary validation produce local logs and no accepted database rows.
The [sync guide](../services/sync/README.md) owns the executable download/replay commands.

Native `Non-Amazon US`, `Non-Amazon DE`, and `Non-Amazon IT` remain distinct financial channels.
The registry binds each to its credential scope and local time zone. They do not become Inventory
stores. Summary comparison groups Non-Amazon US, DE and IT with Amazon.com, Amazon.de
and Amazon.it respectively. This [verified Summary grouping](evidence/finances_summary_channels_2026-11-07.md)
does not relabel transactions, company fee matching, reference matches or report scopes.
Currency never supplies a missing marketplace.

The downloader enforces Amazon's timestamp/history limits, including the maximum 180-day request
window. Explicit `--posted-after` and optional `--posted-before` timestamps support historical
retrieval without changing the rolling default. Historical marketplace coverage may need an
explicit known roster; unsupported source markets fail preprocessing. Credentials stay in service
configuration and never enter archive manifests.

## Source versions

Each accepted download creates a source acquisition and preprocessing batch. The unit key for a Finances transaction consists of its regional seller account and native transaction ID. The unit selects a content version and the batch that last observed it. An identical normalized transaction reuses its version, including when Amazon returns to an earlier state. Batch membership records which version each observation saw.

`finances_transactions` holds the transaction header for one version. `finances_amounts` records signed amounts, the route for each amount, its item position and the keys needed to resolve ownership. The source archive preserves Amazon's exact response.

## Preprocessing and publication

Python validates the complete candidate before writing accepted evidence:

- Verify archive integrity, pagination, declared marketplace/timestamp scope and native identities.
- Reject conflicting duplicates and a previously accepted ID missing from the later retrieval's
  comparable UTC interval. Existing records outside that interval do not count as missing.
- Validate native dates, currencies, nested amount partitions, supported monetary paths and the
  complete component inventory.
- Resolve original/release links using incoming and accepted identities. An affected transaction
  outside the proposed capture cannot have its eligibility silently changed.
- Match every required Amazon Summary account/currency scope within the separate complete-day
  reconciliation interval, including zero-activity scopes. Partial boundary days are not included
  in that comparison.
- Reject older acquisitions that would replace newer accepted observations.

A failure leaves previous current selections intact and is logged locally. A successful publication
locks the relevant seller/credential scope and shares the payout-input guard, then writes acquisition
metadata, batch, new versions/components, all memberships and pointer changes in one transaction.
It can publish current-day observations without certifying those partial days as complete monthly
inputs. Payout coverage requires reconciled complete-day evidence matching the selected versions.

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

For the same seller, mapped Summary marketplace, account type, currency and declared complete-day
reconciliation interval:

```text
sum(eligible native transaction totals)
    = sum(their normalized component amounts)
    = listSummary.netProceeds
```

Summary is independently retrieved account evidence, never another company component. When a
complete-day reconciliation interval is declared, missing, unavailable or mismatched controls reject
the whole preprocessing batch. A capture with no such interval can publish its validated transaction
observations without a Summary control, but supplies no reconciled day coverage. Exact Summary
response bytes remain in the archives; successful batch membership identifies the versions used in
the comparison. Transactions outside the reconciliation interval remain observations, not proof of
complete account totals for those days.
[Amazon Summary scope](https://developer-docs.amazon/sp-api/docs/retrieve-financial-summary).

## Payouts, history and reads

Payouts pin the source versions for Finances, reference money and ledger months, and the assignment versions used to resolve their records.
Raw pages and their observation provenance are available for offline replay.
