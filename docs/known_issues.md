# Known issues

The [workflow](data_workflows.md), [Finances implementation](finances_transactions.md)
and [source allocation policy](source_allocation.md) describe current behavior.
This register records remaining limitations and explicit deferred decisions.
Historical investigation files preserve earlier measurements; they do not define
the current production inputs.

## Issue index

| Issue | Status |
| --- | --- |
| [Refund commission over-credit](#deferred-refund-commission-over-credit-risk) | Postponed |
| [Company payout workflow](#company-payout-workflow) | Postponed |
| [Advertising attribution](#advertising-attribution) | Postponed pending Ads API access |
| [Data Kiosk source discrepancies](#data-kiosk-source-discrepancies) | Postponed; current source policy retained |
| [Finances observation boundaries](#finances-observation-boundaries) | Documented limitation |
| [Native SKU identity](#native-sku-identity) | Documented limitation |
| [Source vocabulary](#source-vocabulary) | Documented limitation |
| [Archive bucket visibility race](#archive-bucket-visibility-race) | Accepted operational assumption |
| [Marketplace routing configuration race](#marketplace-routing-configuration-race) | Accepted operational assumption |
| [Data Kiosk completeness and finality](#data-kiosk-completeness-and-finality) | Documented limitation |
| [Nullable Data Kiosk list entries](#nullable-data-kiosk-list-entries) | Documented limitation |
| [Empty Sellers response and SDK decoding](#empty-sellers-response-and-sdk-decoding) | Documented limitation |
| [Source publication ordering](#source-publication-ordering-across-workers) | Documented limitation |
| [Live calculation query scope](#live-calculation-query-scope) | Documented limitation |
| [Storage and database publication](#storage-and-database-publication) | Documented limitation |
| [Operational tooling](#manual-operational-tooling) | Documented limitation |
| [Deployment and verification scope](#deployment-and-verification-scope) | Documented limitation |

## Deferred refund commission over-credit risk

Live fees use each refund's own activity-date rate. A USD 100 sale at 5% charges
USD 5; a full refund at 7% credits USD 7. The example returns USD 2 more commission
than was charged. It is an arithmetic consequence, not a measured loss.

Live reads and frozen reports preserve this formula. Matching a refund to the
original sale's commission requires a separate refund-policy decision.

## Company payout workflow

Automatic immutable monthly reports and member access are implemented. Approval,
payment execution, adjustments, negative-balance handling and currency rounding
remain outside the calculation workflow. A saved report does not prove payment.
An explicitly empty company with no identified source scope does not certify
upstream inactivity. Source arrival can generate a later immutable report.

## Advertising attribution

Finances/Summary agreement checks charged advertising amounts at account level.
It does not establish why Data Kiosk's Sponsored Products attribution differs.
The detailed advertising investigation remains deferred until Ads API access
is available. No account-level residual is redistributed to company SKUs.

## Data Kiosk source discrepancies

On October 18, 2026, the user postponed addressing these SKU cost-allocation discrepancies.
Independent allocation replacements and corrections remain deferred; the investigation and
supporting evidence are retained for later work.

The accepted policy continues to use Data Kiosk costs for company allocation.
Finances supplies independent account controls, and their difference stays with
SelBox. Disposal, inbound placement/transportation and promotion investigations
have identified source discrepancies that repeated complete captures alone do
not repair. Advertising has a separate scope/access investigation above.

A zero Finances/`listSummary` difference establishes agreement between those
account inputs. It does not establish correct Data Kiosk SKU attribution. The
[Data Kiosk payout audit](evidence/data_kiosk_payout_impact_2026-10-02.md) retains
the measured exposure and conditions; changing the financial source does not
apply its suggested company cost corrections automatically.

The [expanded comparison](evidence/expanded_source_comparison_2026-10-17.md)
matches operational records to native billing: US September includes
USD 430.44 of excess allocation, and Australia's January–October 15 disposal
excess is AUD 23.56. Japan's disposal gap instead resolves through later billing.
German January–September transport costs retain EUR 527.2307 of unallocated
shipment costs, plus EUR 0.0003 of precision difference. These are specific
observed cohorts, not a universal row-deduplication or cost-allocation rule.

The [independent allocation investigation](evidence/sku_cost_allocation_feasibility_2026-10-18.md)
identifies removal and aged-storage reports with direct SKU amounts, and distinguishes those
from transport approximations and unresolved shared costs. Amazon documents that storage
amounts can repeat across MSKUs sharing an FNSKU; SKU-grain output is not always an additive
partition of the account charge. No replacement allocation policy has been applied.

## Finances observation boundaries

Complete pagination is not a shared atomic Amazon snapshot. New records or status
changes can appear on a later request for the same posting period. Requests use
posting dates, not modification dates. Original/release links must identify each
activity contribution; statuses alone are insufficient. Missing or conflicting
required identity/linkage information fails preprocessing instead of guessing.

Finances pages and Summary responses have no common snapshot token. An omitted `postedBefore`
uses Amazon's approximately request-time-minus-two-minutes default, without promising one frozen
upper cutoff across all pages. Python validates Summary only for the declared complete local-day
interval inside that retrieval. If a required control is unavailable or mismatched, the batch is
rejected and prior accepted state remains selected. Partial boundary-day transactions can be
accepted without certifying those days as reconciled. The maturity cutoff sets payout eligibility
and the routine refresh lookback; it does not prove that Amazon will never revise older periods.

Historical access is finite. Retain raw captures independently of Amazon's
retrieval window, including data needed to reproduce saved reports. See the
[API and refresh contract](finances_transactions.md).

## Native SKU identity

Allocation uses exact native product SKU strings. Missing SKUs are never inferred
from currency, an order total or an account residual. A nonempty native product
identifier does not by itself prove it is the merchant SKU used by another
source; liquidations can expose FNSKU-like identifiers. Such identities require
reviewed mapping or explicit configuration. Raw native parent context remains
archived, and unresolved ownership blocks company payout publication.

## Source vocabulary

The [registry](transaction_type_registry.md) admits reviewed native transaction
paths. New paths fail the complete preprocessing publication, preserving the
archive and previous current versions. Unsupported future responses or rare
families are not accepted through a generic charge or adjustment fallback.
A successful tested month does not establish universal future payload support.

## Archive bucket visibility race

The archive service checks that its bucket is private before upload and verifies
it afterward. A privileged visibility change between HTTP requests is not atomic
with the upload. Normal commands do not change visibility. The operating assumption
is that trusted administration keeps it stable during acquisition.

## Marketplace routing configuration race

The explicit SP-API client checks process-global routing configuration before
SDK construction. Concurrent mutation of that environment variable could race the
SDK's own read. Normal commands do not mutate it; trusted configuration management
must keep routing stable during a process.

## Data Kiosk completeness and finality

Three equal independent observations are diagnostic evidence, not financial
finality. Reprocessing one capture is not another Amazon observation. Known
Data Kiosk omissions and SKU allocation discrepancies can remain stable across
fresh queries and differ by grouping grain. Complete days, valid arithmetic and
source agreement on unrelated categories do not prove company cost correctness.
The current policy does not substitute ASIN-level amounts or distribute residuals
without an explicit allocation decision.

Historical completeness can also regress: repeating Japan's exact June–October
query restored JPY 272,415 of July fees missing from the October 3 capture, while
older Swedish ordinary fee omissions persist. Raw Data Kiosk net proceeds changed
with Japan's missing fees; valid internal arithmetic alone did not detect them.
See the [dated source controls](evidence/expanded_source_comparison_2026-10-17.md).

## Nullable Data Kiosk list entries

The Amazon Economics schema permits null entries in several collections.
Preprocessing requires each supplied monetary list entry to be an object. Such
responses remain archived but fail preprocessing until evidence establishes a
safe interpretation. An unknown amount is not silently skipped or invented as zero.

## Empty Sellers response and SDK decoding

The installed SDK can turn a valid empty participation list into an empty mapping,
which is also compatible with malformed responses. Participation discovery rejects
that ambiguous representation. It does not infer that the seller has no stores.
An SDK or response-adapter change must preserve the distinction before relaxing it.

## Source publication ordering across workers

Finances observation ordering uses capture start and acquisition identity; Data
Kiosk uses query creation and acquisition identity. Reprocessing the same source
observation requires a greater result UUID plus a matching expected-current
reference. Python UUIDv7 is monotonic within one process, not a cross-worker clock.
A stale or lower local version fails instead of overwriting a newer selection.
Company terms use a locked revision counter. Trusted workers must keep clocks and
capture serialization consistent.

## Live calculation query scope

Date/SKU filters restrict source facts before aggregation and fee lookup. Exact
counts and broad period totals can still process many authorized rows. Reported
amount ordering is limited to 10,000 matching rows; date ordering remains available
for larger scopes. Browser count/catalog caches reduce repeated requests but do
not replace request-time authorization.

Separate live page requests do not share an atomic database snapshot. Benchmarks
and short concurrent bursts do not establish sustained production capacity.
See [query contracts](transaction_query_contracts.md) and
[database performance](database_performance.md).

## Storage and database publication

Object upload and PostgreSQL publication do not share a transaction. A failed
publication can leave an archived object without a successful acquisition header.
Preserve it for investigation; do not infer that an uploaded object changed current
financial facts. Finance batch membership, new transaction versions/components and selected pointers publish
atomically after Python validation. Data Kiosk likewise publishes complete day versions, selected
observations and reusable-version membership atomically.

## Manual operational tooling

The payout worker handles pending calculations and retry backoff. It does not
download new Amazon data. Acquisition and offline preprocessing have separate
commands and logs; their successful publication enqueues affected payout months.
Source failures preserve prior current selections and captured evidence.

## Deployment and verification scope

Disposable PostgreSQL and Supabase tests cover native source publication, account
and company access, frozen calculations, lifecycle exclusion, Summary gates,
concurrency and immutable history. The [verification evidence index](evidence/README.md)
distinguishes live API captures from synthetic edge cases and archived replays.

Synthetic owners and fee rates are test configuration, not approved business
assignments. These checks do not prove universal source support, financial
finality, production capacity, or that a payment was approved or executed.
