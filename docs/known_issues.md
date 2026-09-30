# Known issues

The [workflow contract](data_workflows.md) and [company-fee contract](company_fees.md) describe
implemented behavior. This register records current limitations, their operating assumptions, and
conditions for revisiting them. Remove completed fixes from this register; current behavior belongs
in the implementation guides.

## Classification vocabulary

Use exactly these status names in the issue index and future status updates.

| Status                    | Meaning                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unresolved**            | Investigation, a decision, or corrective work remains open; no acceptance or explicit postponement has been recorded.                                        |
| **Postponed**             | Reviewed and deliberately deferred until a stated phase or evidence trigger.                                                                                 |
| **Accepted**              | Reviewed and deliberately retained under a stated policy or operating assumption; no corrective change is planned while that condition holds.                |
| **Documented limitation** | A boundary of the current architecture, source evidence, tooling, or verification. This status does not imply a defect, acceptance decision, or planned fix. |

Each issue has one status. Acceptance retains a condition under its stated policy or operating
assumption; revisit it if that condition changes. Postponement requires a reason and a revisit
trigger. Neither status establishes the cause of a discrepancy or guarantees source correctness.

## Issue index

| Issue                                                                                               | Status                |
| --------------------------------------------------------------------------------------------------- | --------------------- |
| [Retrocharge validation](#retrocharge-validation)                                                   | Postponed             |
| [Refund commission over-credit](#deferred-refund-commission-over-credit-risk)                       | Postponed             |
| [Company payout workflow](#company-payout-workflow)                                                 | Postponed             |
| [Reviewed Settlement amounts retained by SelBox](#reviewed-settlement-amounts-retained-by-selbox) | Accepted              |
| [Archive bucket visibility race](#archive-bucket-visibility-race)                                   | Accepted              |
| [Marketplace routing configuration race](#marketplace-routing-configuration-race)                   | Accepted              |
| [Data Kiosk disposal discrepancy](#data-kiosk-disposal-discrepancy)                                 | Accepted |
| [Out-of-period Settlement postings](#out-of-period-settlement-postings)                             | Accepted              |
| [Trailing-omission parsing assumption](#trailing-omission-parsing-assumption)                       | Accepted              |
| [Data Kiosk completeness and finality](#data-kiosk-completeness-and-finality)                       | Documented limitation |
| [Nullable Data Kiosk list entries](#nullable-data-kiosk-list-entries)                               | Documented limitation |
| [Empty Sellers response and SDK decoding](#empty-sellers-response-and-sdk-decoding)                 | Documented limitation |
| [Source publication ordering across workers](#source-publication-ordering-across-workers)           | Documented limitation |
| [Live calculation query scope](#live-calculation-query-scope)                                       | Documented limitation |
| [Storage and database publication](#storage-and-database-publication)                               | Documented limitation |
| [Manual operational tooling](#manual-operational-tooling)                                           | Documented limitation |
| [Deployment and verification scope](#deployment-and-verification-scope)                             | Documented limitation |

## Postponed

### Retrocharge validation

**Reason: insufficient concrete Amazon evidence.**

[`validate_retrocharge_groups`](../services/sync/src/settlement_preprocess/retrocharges.py) requires
exactly one tax and one withholding row for each principal/shipping component group, plus exact zero
net for the whole event. For example, a synthetic same-event group containing `Tax +3`,
`MarketplaceFacilitatorTax-Principal -1`, and `MarketplaceFacilitatorVAT-Principal -2` has complete
coverage and zero net but is rejected as ambiguous.

**Revisit when a concrete Amazon SP-API example establishes a supported source pattern rejected by
these checks.** Keep the existing Python preprocessing checks unchanged. If preprocessing fails,
retain the archived input, review the evidence, revise the rule when justified, and rerun
preprocessing. General seller-remitted tax behavior alone does not establish a nonzero retrocharge
example or its accounting treatment.

Reviewed complete source coverage remains required. Unidentified, incomplete, or cross-report groups
cannot be admitted merely because an available subset nets to zero. This postponement is not a claim
that Amazon universally guarantees zero-net retrocharges. The
[classification audit](evidence/settlement_classification_audit_2026-09-08.md) records the observed
zero-net groups and limits of their coverage.

Because monetary zero is checked across the event, a principal imbalance can cancel a shipping
imbalance. Whether each pair must independently net to zero also requires concrete source evidence
before changing the rule.

### Deferred refund commission over-credit risk

**Reason and revisit phase: a separate decision on refund commission policy.**

Live fees use each refund's own posting-date rate. A USD 100 sale at 5% charges USD 5; a later full
refund at 7% credits USD 7. Together they return USD 2 more commission than was charged. This is an
arithmetic example, not a measured loss in the archived Amazon reports.

Both live reads and frozen payout reports use this signed calculation without matching the original
sale's commission. The [source and payout policy](source_allocation.md) retains this formula pending
the separate refund-policy decision.

### Company payout workflow

**Reason and revisit phase: payout approval and payment workflow.**

[Monthly payout snapshots](company_payout_reports.md), administrator generation, and
members' own-company access are implemented. Approval, payment execution, adjustments,
negative-balance handling, and currency rounding remain decisions for the payment workflow.
Saved reports preserve a calculation; they do not establish an approved or paid amount.

A [zero aggregate](company_payout_reports.md#empty-aggregates) can reflect incomplete
upstream acquisition or preprocessing. It does not certify inactivity. Reports are
created only on request, so later source arrival does not change a saved result.

## Accepted

### Reviewed Settlement amounts retained by SelBox

The registry explicitly defines all accepted Settlement types, including reviewed `SELBOX`
charges. Preserve their source SKU and signed amount without asserting that every retained
transaction is an operating expense. Unknown types reject the complete report before publication;
there is no automatic retained category.

EPR charges, generic `Fee Adjustment`, Vine enrollment, advertiser refunds, and inbound defect fees
currently have no approved settlement cost rule. Their Data Kiosk representation remains unverified;
ordinary storage evidence does not justify a universal interpretation of generic adjustments. These
reviewed types remain explicitly retained, rather than being mapped to company costs. The
[EPR and adjustment investigation](evidence/data_kiosk_epr_and_adjustment_coverage_2026-09-13.md)
records the checked responses and why they do not establish individual cost coverage.

Approved Data Kiosk costs supply company amounts at every age, independently of an individual
Settlement match. The registry controls both sources: unknown monetary components abort
preprocessing, and missing required source coverage blocks authoritative totals. See the
[explicit rules](settlement_component_categories.md).

### Data Kiosk disposal discrepancy

**Decision: use Data Kiosk costs and retain their difference from Settlement controls with SelBox.**

Amazon's raw Data Kiosk disposal costs can differ from Settlement deductions, even
after fresh queries. The internal cause remains unconfirmed. The
[disposal investigation](evidence/data_kiosk_disposal_discrepancy_2026-09-07.md) retains
the measured amounts and controls as historical evidence.

The [source policy](source_allocation.md) preserves costs in the Data Kiosk category and SelBox
variance. For mature dates it records Settlement report controls minus Data Kiosk amounts in
that category per day/marketplace/seller/currency, so the complete account ledger reconciles
to Settlement. Recent dates use only Data Kiosk. FBA and Finances are not inputs.

### Archive bucket visibility race

**Decision: retain the existing checks under the assumption that trusted administration keeps bucket
visibility stable during operations.**

[`SupabaseArchiveStorage.put`](../services/sync/src/archives/storage.py) checks the bucket's private
flag in one HTTP request, then uploads in another. A privileged concurrent change making the bucket
public between those requests permits an upload before the later read-back check fails.

Normal commands do not change bucket visibility. Repeated checks cannot make the requests atomic.
Revisit if mutable visibility must be supported, using control over visibility changes or a
transactional Storage capability.

### Marketplace routing configuration race

**Decision: retain the existing checks under the assumption that trusted configuration management
keeps process-global routing stable during client construction.**

[`create_explicit_sp_api_client`](../services/sync/src/amazon/client.py) checks
`SP_API_DEFAULT_MARKETPLACE` before constructing the SDK client. The installed SDK reads that
process-global variable again in its constructor. A concurrent in-process change can therefore route
the client to another marketplace after the explicit routing check.

Normal commands do not make this change. Revisit if mutable process-global routing must be
supported. A lock around only this helper cannot synchronize arbitrary writers; support would need a
defined configuration policy or verified SDK routing boundary.

### Out-of-period Settlement postings

**Decision: preserve valid postings in their original Settlement with diagnostics.**

Settlement rows can carry posting timestamps outside their report's header period. The
implementation preserves valid out-of-period timestamps and dates while requiring exact report
reconciliation. Malformed or contradictory dates still fail. Consumers cannot assume every posting
lies inside the report's header period. The
[classification audit](evidence/settlement_classification_audit_2026-09-08.md) records reserve
postings after their report's end timestamp.

### Trailing-omission parsing assumption

**Decision: normalize permitted optional trailing omissions and retain diagnostics.**

Optional trailing omissions are normalized with source-width diagnostics; supplied interior cells
stay in place and missing required values still fail. The
[parsing contract](data_workflows.md#trailing-empty-fields) defines the permitted suffix for each
row role. The
[trailing-column investigation](evidence/settlement_trailing_columns_investigation_2026-09-11.md)
records the shortened source rows supporting this convention.

The accepted assumption is that these omissions belong to the optional trailing suffix. A plausible
row and exact monetary reconciliation cannot prove that an interior delimiter was never lost.
Revisit if a concrete source example contradicts the trailing-omission convention.

## Documented limitation

### Data Kiosk completeness and finality

Three equal independent Data Kiosk observations are diagnostic evidence, not financial finality. A
reprocessing rerun is not another Amazon observation. Matching observations do not establish
universal source coverage or prevent later Amazon revisions.

Unsupported monetary components, uncertain component overlap, and incomplete requested day coverage
fail the affected selection. Keep explicit business coverage and the source-selection checks;
numerical agreement cannot replace them. See the [workflow contract](data_workflows.md).

### Nullable Data Kiosk list entries

The
[Amazon Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)
allows null entries inside `ads`, `fees`, `charges`, `components`, and `properties` lists. The
normalizer requires each supplied entry to be an object, so a response containing such an entry can
be archived but fails preprocessing.

Keep the current rejection until concrete source evidence establishes how to interpret these
entries. Skipping an unknown charge could understate costs; neither silently omitting it nor
inventing a zero amount is justified. A supported null collection and an empty collection already
retain their distinct meanings.

### Empty Sellers response and SDK decoding

The official Sellers model permits an empty participation list. The installed `python-amazon-sp-api`
2.1.20 response constructor uses `payload or kwargs`, which turns a valid empty list into an empty
mapping before our parser sees it. `fetch_marketplace_participations()` therefore rejects this
response with `SellersParticipationResponseError` rather than returning no marketplaces.

The same SDK conversion can produce an empty mapping for a missing or malformed payload, so
accepting every mapping as an empty list would hide invalid responses. Keep the current rejection
until an explicit SDK or response-adapter change can preserve the original distinction.

### Source publication ordering across workers

Settlement replacements and reprocessing of one Data Kiosk observation require a greater result UUID
in addition to a matching expected-current reference. `uuid.uuid7()` is monotonic within one Python
process; it does not establish ordering across independent generators or clocks.

A lower UUID fails publication with SQLSTATE `23514` even when the expected-current reference
matches, preserving the old selection. Clock skew or competing workers can therefore reject an
otherwise current edit. There is no cross-worker clock policy or automatic retry. Company terms use
an identity-locked revision counter instead.

### Live calculation query scope

Live reads use relational current-source joins, selected terms evaluated once per query, and
caller-bound source authorization. Date and SKU filters can reach source facts. Date and
reported-amount page requests, including text search, select the visible page before calculating its
fees. Search matches visible text through frontend-resolved exact value sets; fee status and
versions are excluded. Amount
ordering is limited to 10,000 fully filtered, authorized matches; a 10,001-row probe rejects larger
scopes before sorting. The [query contract](transaction_query_contracts.md) defines supported
ordering, filters, and result shapes.

The frontend renders rows before requesting their exact count. Financial counts are reused across
page and sort changes until a relevant source or fee revision invalidates them; account and payout
counts expire after 30 seconds. This reduces repeat work and often improves first-row latency, but a
cold page and separate count can consume more database time than a combined request.

Summary cards discover the latest transaction date and aggregate only the requested day, month, or
selected DATE range through dedicated RPCs. Compatible facts are combined before resolving fees;
Source, Marketplace, and Type options come from static catalogs. Company-member SKU options reuse
loaded assignments. Administrator SKU catalogs are preloaded from source history and registrations,
then reused by menus and table search. Search text is resolved on the frontend to exact OR sets;
Currency is excluded. Empty matches avoid a source scan, while broad matching sets, full-period
totals, and exact counts can still process many rows under RLS. No substring index is required.
Explicit continuation markers protect against response caps, but multiple pages are live estimates
and do not share an atomic database snapshot.

Synthetic larger-data checks and short concurrent-read bursts do not establish sustained production
capacity, storage locality, or a latency bound. Monitor real query plans and timings as the workload
grows. The [performance guide](database_performance.md) records the current design, measurements,
and possible responses to those costs.

### Storage and database publication

Storage uploads and PostgreSQL publication do not share a transaction. A failed publication may
leave an unreferenced archive object for reconciliation; it must never create a successful
acquisition with missing files.

Retention removes only eligible complete Data Kiosk result payloads, preserving audit headers,
current versions, pinned evidence, and every successful archive and acquisition. Increasing a
retention limit does not restore already-pruned payloads; retained archives can be explicitly
reprocessed. See the
[database guide](../services/db/supabase/README.md#observation-comparison-and-retention).

### Manual operational tooling

Publication failures roll back completely and remain in Python logs; the service does not
automatically retry them. Report publication and fee administration have trusted Python repository
interfaces; operators also manage member access, publish complete terms, and generate
eligible monthly payout reports through REST and the administration UI. Payment approval
and execution are not implemented. Payout dependencies are immutable and have no
independent pin-update interface.

These are current tooling boundaries, not recorded decisions to implement retries or another
administration interface. See the
[database guide](../services/db/supabase/README.md#observation-comparison-and-retention).

### Deployment and verification scope

The [local verification suites](../services/db/supabase/README.md#verification) install the baseline
in disposable PostgreSQL databases and exercise local Supabase Storage, Auth, and PostgREST. They
cover source publication, financial calculations, tenant permissions, frozen payouts, and concurrent
publication and retention using synthetic Amazon documents.

The [full-seed configuration verifier](../services/db/supabase/README.md#full-seed-configuration-verification)
restores a current-schema fixture into a disposable Supabase stack and tests its configuration
through actual Auth and PostgREST, including atomic writes and member restrictions. Independent
source-authority and reconciliation checks complement those API checks. Verification preserves the
supplied seed file and source facts; archive replay remains a separate check.
The [recorded fixture run](evidence/global_sku_identity/configuration_seed.json) passed with
complete settings for 63 global SKUs and preserved all 103,244 source facts.

The fixture uses synthetic assignments and fees, with one owner per exact SKU and compatible fee
periods. These checks do not establish real business assignments, approved rates,
universal Amazon payload support, country coverage, financial finality, or production capacity.
