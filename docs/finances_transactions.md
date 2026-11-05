# Finances transactions

Finances API `2024-06-19` supplies detailed financial activity through `listTransactions` and
independent account controls through date-range `listSummary`. The implementation archives exact
response bytes and publishes complete daily versions using the same acquisition, offline
preprocessing and current-selection pattern as Data Kiosk.

Company allocation remains separate from Amazon account reconciliation. Finances supplies mature
Finances and SelBox category amounts. Data Kiosk supplies its allocated company-cost category at all
ages and recent estimates for the other monetary categories. The existing maturity rule remains
unchanged. See [source allocation](source_allocation.md).

## API scope

A successful acquisition covers complete marketplace-local dates within one calendar month, all
account types and currencies, and every declared marketplace in one seller credential scope.
Requests use regional endpoints without marketplace, account, order, status or SKU restrictions.
This follows Amazon's warning that marketplace filtering can omit US merchant-fulfilled activity.
The CLI discovers active seller marketplaces unless an explicit coverage roster is supplied.
[API reference](https://developer-docs.amazon/sp-api/reference/listtransactions).

The UTC request envelope contains each declared marketplace's local midnight through exclusive
midnight after the final date, using named time zones and daylight-saving rules. Returned edge-hour
records outside those local dates are retained in the archive but do not enter the covered day
versions. Unknown marketplace identity is rejected; currency never supplies a missing market.

Native `Non-Amazon US`, `Non-Amazon DE`, and `Non-Amazon IT` remain distinct from their retail marketplaces in
days, transactions and components. The financial-channel registry binds these verified identities
to their credential scope and local time zone; they do not become Data Kiosk or Inventory stores.
Amazon's Summary combines the US channel into the US account control. The explicit
`finances_summary_marketplace` mapping groups `Amazon.com` with `Non-Amazon US` for that comparison
and its version manifest. This does not change source marketplace provenance or company fee matching.

The DE and IT channels retain their own Summary and Data Kiosk scopes until cross-channel
correspondences are established. Sellers participation alone does not prove that financial controls can be merged.
Newly supported channels require a fresh acquisition with the complete declared roster; previously
archived coverage manifests remain immutable.

The date-span limit is 180 days; live probes additionally established a rolling two-year start-date
limit. The downloader validates these limits and splits requested ranges by calendar month.
Recent records can arrive later and statuses can change. A completed pagination traversal is an
observation, not a guarantee that Amazon will never revise the period.

## Immutable captures and daily versions

| Table | Role |
| --- | --- |
| `private.finances_acquisitions` | Completed raw transaction/Summary retrieval, request dates, coverage roster, timestamps and archived page manifests. |
| `private.finances_days` | Stable seller/native-marketplace/local-day identity and selected current version. |
| `private.finances_preprocess_batches` | One atomic offline publication referencing its acquisition. |
| `private.finances_preprocess_versions` | Complete immutable day contents, processor definition, native/component counts and comparison digest. |
| `private.finances_transactions` | Native transaction ID, posting time, type/status, account/currency, lifecycle links, eligibility and parent control amount. |
| `private.finances_transaction_components` | Exact normalized monetary partition with original SKU evidence, component key, native path and source page/record. |
| `private.finances_pruned_versions` | Explicit payload-pruning marker preserving version identity and counts. |
| `private.finances_summary_checks` | Independent Summary amount, computed native amount, scope and match result. |
| `private.finances_summary_check_versions` | Exact complete daily versions used by one Summary check. |
| `private.payout_report_finances_versions` | Daily versions pinned by a saved payout, including verified empty days. |
| `private.payout_report_finances_summary_checks` | Exact matching Summary checks retained by a saved payout. |

The [schema reference](database_schema.md) contains every column, key and relationship. Source children
reference their day version; component `(version_id, transaction_id)` must identify one native
parent in the same version. A native ID may recur in historical versions, but cannot occupy two
current locations for the same seller. Only a complete validated publication advances current
selections. Verified empty days have a version with zero children.

For example, an August 29 capture of the finished August 28 day contains transaction A for 100 USD
with `DEFERRED` status. A September 6 capture of August 28 contains the same A as
`DEFERRED_RELEASED`. Both daily versions remain immutable;
current calculations select the later complete version and count A once. They do not combine the
two versions or keep rows missing from the later observation.

## Activity eligibility and double counting

Within each selected version, the activity rule is:

```text
eligible = transactionType != Transfer
           and no DEFERRED_TRANSACTION_ID
           and no original in the acquisition points to this transaction
               through RELEASE_TRANSACTION_ID
```

These rules are applied before allocation categories or company ownership. Finances statuses mean:

| Status | Meaning |
| --- | --- |
| `DEFERRED` | The original activity is recorded while its funds remain held. |
| `DEFERRED_RELEASED` | The original activity was held and its funds were later released. |
| `RELEASED` | Released financial record; either a linked release or a directly posted event. |

A separate release B can carry the same amount as original A with a different native transaction ID.
`DEFERRED_TRANSACTION_ID` on B identifies A; `RELEASE_TRANSACTION_ID` on A can identify B. The
preprocessor evaluates both directions across the acquisition before local-day selection. A release
with its own link to a missing older original remains exclusive of activity totals. If only an
out-of-period padding record supplies the reverse link and the release has no native original
link, preprocessing rejects that unsupported dependency rather than publishing a nonreproducible
eligibility decision. Unknown statuses, contradictory
links and self-links fail validation. Equal amounts, orders or SKUs never establish duplication.

| Example record | Amount | Monthly activity |
| --- | ---: | --- |
| Original A, August 28 | +100 USD | August +100 USD |
| B releases A, September 5 | +100 USD | No additional activity |
| Direct storage fee, September 6 | -10 USD | September -10 USD |
| Genuine refund, September 10 | -20 USD | September -20 USD |
| Bank transfer | 70 USD | Exclusive of net proceeds |

Directly released fees remain eligible. So do genuine refunds, reimbursements, debt recovery and
cross-account adjustments. Excluding all released records or all balance movements would be wrong.
Preserve zero amounts and SKU-less source entries. Amazon documents the statuses and links; the
full integration selection rule is empirically verified against Summary output rather than
published as Amazon's internal implementation.

## Components and classification

Normalize item breakdown leaves when items are present; otherwise use transaction-level detail.
Never add both representations. Every child partition must equal its parent, every item's complete
component partition must equal its item total, and all components must equal the native transaction
total in the same currency. Missing nonzero detail or an unknown monetary path blocks publication.

The explicit native mapping is maintained in
[`transaction_types/finances.py`](../services/sync/src/transaction_types/finances.py). Semantic types
such as `PRODUCT_SALES`, `FBA_FULFILLMENT_FEES`, `DISPOSAL_FEES` and `BANK_TRANSFERS` are shared with
SQL/frontend catalogs. Source page, record, item, breakdown path/indexes and original API IDs remain
available independently of those readable categories. A source-native SKU is preserved verbatim;
missing product attribution cannot be invented from an account total.

Service-fee bases are the signed product sales/refund amounts. Other component quantities do not
repeat the same shipment units. Financial values remain exact decimal numbers; frontend transport
uses strings. Unknown quantities are distinct from zero.

## Summary controls and payouts

Calculate each control for the same seller, mapped Summary marketplace, account type, currency and
inclusive local-date period:

```text
computed_net_proceeds = sum(eligible native transaction totalAmount)
component_net = sum(their complete normalized components)
computed_net_proceeds == component_net == listSummary.netProceeds
```

Parent totals and component totals are alternative checks over the same money. `listSummary` has no
per-SKU dimension and is never another financial row to add. The supported target is the date-range
`netProceeds` value, not bank transfer amounts or a company payout.
[Summary scope](https://developer-docs.amazon/sp-api/docs/retrieve-financial-summary).

Each check stores its independent source location and the exact day versions used. A check for an
older selection cannot certify newly selected versions. A missing control and a zero-valued matched
control are different states. Structurally valid source captures may publish while their check is
unmatched or unavailable; complete payout generation requires matching controls for its selected
Finances inputs. No discrepancy is repaired with a synthetic monetary component.

A report pins the complete required day coverage, matching controls and company terms. The worker
retries affected months when inputs are incomplete and reacts to later source publications. The
[payout contract](company_payout_reports.md) defines the complete scope and current-source rules.

## Retention and reads

Retain current versions, the latest three independent acquisitions per day, and all payout-pinned
versions. Offline reprocessing of one acquisition is still one observation. Raw archives and
acquisition manifests remain indefinite. Comparison digests retain financial identity, amounts,
components and eligibility while excluding incidental status and response-location metadata.
Identical observations are diagnostic; they do not establish permanent finality.

Administrator raw source views expose retained daily versions, including linked releases and
transfers. Their Activity eligibility column describes the record within that version. Company
Transactions and Financial review select current versions and eligible activity. Native IDs,
account types and source locations remain available in row details. Automatic revision checks
refresh changed reads; there is no manual reload button.

Acquisition is an explicit command with requested dates; the payout cron job does not fetch Amazon
records. Older posting periods must be acquired again to observe their revisions. Use complete calendar
months for payout-eligible refreshes and backfills. A partial-month publication selects new day
versions and invalidates the prior whole-month Summary manifest; the month needs another complete
capture before its new inputs are payout-ready. The CLI splits ranges at month boundaries but
does not expand partial date ranges. Historical markets missing from active seller discovery need
an explicit known `--marketplace-id` coverage roster; undeclared source markets fail closed. Credentials live
in the service configuration and are never stored in source pages or browser settings. See the
[workflow](data_workflows.md), [sync commands](../services/sync/README.md), and
[verification evidence](evidence/README.md).
