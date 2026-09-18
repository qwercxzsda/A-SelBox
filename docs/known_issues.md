# Known issues

The [workflow contract](data_workflows.md) and
[company-fee contract](company_fees.md) describe implemented behavior.
This register records current limitations, their operating assumptions, and
conditions for revisiting them. Remove completed fixes from this register;
current behavior belongs in the implementation guides.

## Classification vocabulary

Use exactly these status names in the issue index and future status updates.

| Status                    | Meaning                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unresolved**            | Investigation, a decision, or corrective work remains open; no acceptance or explicit postponement has been recorded.                                        |
| **Postponed**             | Reviewed and deliberately deferred until a stated phase or evidence trigger.                                                                                 |
| **Accepted**              | Reviewed and deliberately retained under a stated policy or operating assumption; no corrective change is planned while that condition holds.                |
| **Documented limitation** | A boundary of the current architecture, source evidence, tooling, or verification. This status does not imply a defect, acceptance decision, or planned fix. |

Each issue has one status. Acceptance retains a condition under its stated
policy or operating assumption; revisit it if that condition changes.
Postponement requires a reason and a revisit trigger. Neither status establishes
the cause of a discrepancy or guarantees source correctness.

## Issue index

| Issue                                                                                               | Status                |
| --------------------------------------------------------------------------------------------------- | --------------------- |
| [Retrocharge validation](#retrocharge-validation)                                                   | Postponed             |
| [Refund commission over-credit](#deferred-refund-commission-over-credit-risk)                       | Postponed             |
| [Company payout workflow](#company-payout-workflow)                                                 | Postponed             |
| [Unmatched Settlement amounts retained by SelBox](#unmatched-settlement-amounts-retained-by-selbox) | Accepted              |
| [Archive bucket visibility race](#archive-bucket-visibility-race)                                   | Accepted              |
| [Marketplace routing configuration race](#marketplace-routing-configuration-race)                   | Accepted              |
| [Data Kiosk disposal discrepancy](#data-kiosk-disposal-discrepancy)                                 | Accepted              |
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

[`validate_retrocharge_groups`](../services/sync/src/settlement_preprocess/retrocharges.py)
requires exactly one tax and one withholding row for each principal/shipping
component group, plus exact zero net for the whole event. For example, a synthetic
same-event group containing `Tax +3`,
`MarketplaceFacilitatorTax-Principal -1`, and
`MarketplaceFacilitatorVAT-Principal -2` has complete coverage and zero net
but is rejected as ambiguous.

**Revisit when a concrete Amazon SP-API example establishes a supported source
pattern rejected by these checks.** Keep the existing Python preprocessing
checks unchanged. If preprocessing fails, retain the archived input, review
the evidence, revise the rule when justified, and rerun preprocessing. General
seller-remitted tax behavior alone does not establish a nonzero retrocharge
example or its accounting treatment.

Reviewed complete source coverage remains required. Unidentified, incomplete,
or cross-report groups cannot be admitted merely because an available subset
nets to zero. This postponement is not a claim that Amazon universally
guarantees zero-net retrocharges.
The [classification audit](evidence/settlement_classification_audit_2026-09-08.md)
records the observed zero-net groups and limits of their coverage.

Because monetary zero is checked across the event, a principal imbalance can
cancel a shipping imbalance. Whether each pair must independently net to zero
also requires concrete source evidence before changing the rule.

### Deferred refund commission over-credit risk

**Reason and revisit phase: a separate decision on refund commission policy.**

Live fees use each refund's own posting-date rate. A USD 100 sale at 5% charges
USD 5; a later full refund at 7% credits USD 7. Together they return USD 2 more
commission than was charged. This is an arithmetic example, not a
measured loss in the archived Amazon reports.

Both live reads and frozen payout reports use this signed calculation without
matching the original sale's commission. The [source and payout policy](source_allocation.md)
retains this formula pending the separate refund-policy decision.

### Company payout workflow

**Reason and revisit phase: payout approval and payment workflow.**

Immutable payout reports, exact saved components, and retention-protected
source/terms manifests are implemented. Approval and payment execution are not.
Timing and cutoffs, adjustment policy, negative balances, and currency rounding
remain decisions for that workflow.

Live calculations may change when source versions or SKU terms change. Saved
reports keep their original values but do not establish approved or paid amounts.
Use explicit business coverage for financial reads and report publication. See
the [payout report contract](company_payout_reports.md) and
[payout scope](source_allocation.md#6-live-calculation-and-frozen-payout-reports).

## Accepted

### Unmatched Settlement amounts retained by SelBox

The policy explicitly defines `SETTLEMENT` and `DATA_KIOSK` families; unmatched
Settlement rows use `SELBOX`. Preserve their source SKU, signed amount, and
nonblocking review diagnostic without asserting that every defaulted transaction
is an operating expense. A missed sale, credit, or company cost can consequently
remain with SelBox until a reviewed rule is added.

EPR charges, generic `Fee Adjustment`, Vine enrollment, advertiser refunds, and
inbound defect fees currently have no approved settlement cost rule. Their
Data Kiosk representation remains unverified; ordinary storage evidence does
not justify a universal interpretation of generic adjustments. These limitations
are retained under the default policy, not silently mapped to company costs.
The [EPR and adjustment investigation](evidence/data_kiosk_epr_and_adjustment_coverage_2026-09-13.md)
records the checked responses and why they do not establish individual cost coverage.

An approved Data Kiosk cost is selected independently of an individual settlement
match. The fallback applies only to Settlement: unknown Data Kiosk monetary
components abort preprocessing, and missing required source coverage still
blocks authoritative totals. See the [explicit rules](settlement_component_categories.md).

### Archive bucket visibility race

**Decision: retain the existing checks under the assumption that trusted
administration keeps bucket visibility stable during operations.**

[`SupabaseArchiveStorage.put`](../services/sync/src/archives/storage.py) checks
the bucket's private flag in one HTTP request, then uploads in another. A
privileged concurrent change making the bucket public between those requests
permits an upload before the later read-back check fails.

Normal commands do not change bucket visibility. Repeated checks cannot make
the requests atomic. Revisit if mutable visibility
must be supported, using control over visibility changes or a transactional
Storage capability.

### Marketplace routing configuration race

**Decision: retain the existing checks under the assumption that trusted
configuration management keeps process-global routing stable during client
construction.**

[`create_explicit_sp_api_client`](../services/sync/src/amazon/client.py) checks
`SP_API_DEFAULT_MARKETPLACE` before constructing the SDK client. The installed
SDK reads that process-global variable again in its constructor. A concurrent
in-process change can therefore route the client to another marketplace after
the explicit routing check.

Normal commands do not make this change.
Revisit if mutable process-global routing must be supported. A lock around only
this helper cannot synchronize arbitrary writers; support would need a defined
configuration policy or verified SDK routing boundary.

### Data Kiosk disposal discrepancy

**Decision: use the selected Data Kiosk costs and assign the resulting variance
to SelBox.**

Amazon's raw Data Kiosk disposal costs can differ from Settlement deductions.
The discrepancy can persist across fresh queries, and its internal cause remains
unconfirmed. Valid acquisition and exact parsing do not establish agreement
between the two sources. The
[disposal investigation](evidence/data_kiosk_disposal_discrepancy_2026-09-07.md)
retains the measured amounts, fresh-query controls, and uncertainty about the cause.

Automatic alias merging, inferred deduplication, and settlement-SKU membership
filtering are not approved corrections. The accepted variance may be a surplus
or a shortfall in other periods. An unknown cause does not reopen the recorded
source-policy decision by itself.

The [source policy](source_allocation.md#7-amount-authority-and-reconciliation)
defines the variance calculation. FBA and Finances are not application inputs.

### Out-of-period Settlement postings

**Decision: preserve valid postings in their original Settlement with diagnostics.**

Settlement rows can carry posting timestamps outside their report's header
period. The implementation preserves valid out-of-period timestamps and dates while
requiring exact report reconciliation. Malformed or contradictory dates still
fail. Consumers cannot assume every posting lies inside the report's header
period. The [classification audit](evidence/settlement_classification_audit_2026-09-08.md)
records reserve postings after their report's end timestamp.

### Trailing-omission parsing assumption

**Decision: normalize permitted optional trailing omissions and retain diagnostics.**

Optional trailing omissions are normalized with source-width diagnostics;
supplied interior cells stay in place and missing required values still fail.
The [parsing contract](data_workflows.md#trailing-empty-fields) defines the
permitted suffix for each row role.
The [trailing-column investigation](evidence/settlement_trailing_columns_investigation_2026-09-11.md)
records the shortened source rows supporting this convention.

The accepted assumption is that these omissions belong to the optional trailing
suffix. A plausible row and exact monetary reconciliation cannot prove that an
interior delimiter was never lost.
Revisit if a concrete source example contradicts the trailing-omission convention.

## Documented limitation

### Data Kiosk completeness and finality

Three equal independent Data Kiosk observations are diagnostic evidence, not
financial finality. A reprocessing rerun is not another Amazon observation.
Matching observations do not establish universal source coverage or prevent
later Amazon revisions.

Unsupported monetary components, uncertain component overlap, and incomplete
requested day coverage fail the affected selection. Keep explicit business
coverage and the source-selection checks; numerical agreement cannot replace
them. See the [workflow contract](data_workflows.md).

### Nullable Data Kiosk list entries

The [Amazon Economics schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/data-kiosk/analytics_economics_2024_03_15.graphql)
allows null entries inside `ads`, `fees`, `charges`, `components`, and `properties`
lists. The normalizer requires each supplied entry to be an object, so a response
containing such an entry can be archived but fails preprocessing.

Keep the current rejection until concrete source evidence establishes how to
interpret these entries. Skipping an unknown charge could understate costs;
neither silently omitting it nor inventing a zero amount is justified. A supported
null collection and an empty collection already retain their distinct meanings.

### Empty Sellers response and SDK decoding

The official Sellers model permits an empty participation list. The installed
`python-amazon-sp-api` 2.1.20 response constructor uses `payload or kwargs`, which
turns a valid empty list into an empty mapping before our parser sees it.
`fetch_marketplace_participations()` therefore rejects this response with
`SellersParticipationResponseError` rather than returning no marketplaces.

The same SDK conversion can produce an empty mapping for a missing or malformed
payload, so accepting every mapping as an empty list would hide invalid responses.
Keep the current rejection until an explicit SDK or response-adapter change can
preserve the original distinction.

### Source publication ordering across workers

Settlement replacements and reprocessing of one Data Kiosk observation require a
greater result UUID in addition to a matching expected-current reference.
`uuid.uuid7()` is monotonic within one Python process; it does not establish
ordering across independent generators or clocks.

A lower UUID fails publication with SQLSTATE `23514` even when the expected-current
reference matches, preserving the old selection. Clock skew or competing workers
can therefore reject an otherwise current edit. There is no cross-worker clock
policy or automatic retry. Company terms use an identity-locked revision counter
instead.

### Live calculation query scope

`live_company_components` passes arrays of all visible current source and terms
versions into the PL/pgSQL resolver before outer date predicates are applied.
Strict and partial-summary functions currently invoke that view for validation
and aggregation separately. The cost can therefore grow with the whole visible
history rather than only the requested date interval.

The [September 19 local table-loading investigation](evidence/frontend_table_loading_2026-09-19.md)
measured about 2.0 seconds for a company member's 25-row Transactions request
with an exact count, versus 1.0 second without the count. Query plans generated
48,540 permitted rows before the page limit; date filtering did not reduce that
work. The separate exact-count read repeated the resolver, and both passes
spilled intermediate results to temporary storage. Complete frontend filter-option
scans multiplied this cost across sequential requests.

The issue is documented, not fixed. These local seeded measurements do not
establish production latency or capacity; see the investigation for methods,
sanitized measurements, frontend contributors, and limitations.

### Storage and database publication

Storage uploads and PostgreSQL publication do not share a transaction. A failed
publication may leave an unreferenced archive object for reconciliation; it must
never create a successful acquisition with missing files.

Retention removes only eligible complete Data Kiosk result payloads, preserving
audit headers, current versions, pinned evidence, and every successful archive
and acquisition. Increasing a retention limit does not restore already-pruned
payloads; retained archives can be explicitly reprocessed. See the
[database guide](../services/db/supabase/README.md#observation-comparison-and-retention).

### Manual operational tooling

Publication failures roll back completely and remain in Python logs; the service
does not automatically retry them. Report publication and fee administration
have trusted Python repository interfaces; operators also manage member access
and publish complete terms through REST. No administration UI or payment
workflow is implemented. Payout dependencies are immutable and have no
independent pin-update interface.

These are current tooling boundaries, not recorded decisions to implement retries
or another administration interface. See the
[database guide](../services/db/supabase/README.md#observation-comparison-and-retention).

### Deployment and verification scope

The [local verification suites](../services/db/supabase/README.md#verification)
exercise disposable PostgreSQL databases and actual local Supabase Storage,
Auth, and PostgREST. They cover source publication, financial calculations,
operator/member permissions, frozen payouts, and concurrent publication and
retention. Their Amazon documents are synthetic; these tests make no live
Amazon requests and do not modify existing application databases.

The verification suites establish behavior for their fixtures, not universal
Amazon payload support, country coverage, financial finality, or production
capacity. Migrations provide a fresh-install baseline with no deployed-schema
upgrade or backfill path.
