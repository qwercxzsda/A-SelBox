# Daily inventory captures

Inventory supports approximate replenishment planning. Each full observation replaces the reported
quantities; stock is never calculated by accumulating sales or arrivals. Retain one normalized
capture per seller, marketplace, and day, plus the immutable source archives. Inventory does not
participate in fees, financial reconciliation, or payout calculations.

## Amazon source

Use Reports API v2021-06-30 with `GET_FBA_INVENTORY_PLANNING_DATA`. One report supplies historical
sales, stock, health, and replenishment recommendations. It requires Amazon Fulfillment access and
is requested, not scheduled through Amazon; NL, PL, SE, and BE are unavailable. See Amazon's
[FBA Manage Inventory Health report](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-manage-inventory-health-report).

Request one marketplace at a time using its configured credential scope: `createReport`, bounded
`getReport` polling, then `getReportDocument` and document download. Amazon can refresh individual
fields at different times. Keep the source dates; daily requests do not guarantee real-time stock.
The report's trailing 90-day sales are historical, not a demand forecast.

## Database model

The [full schema reference](database_schema.md) owns every application table, column, and key.
[Inventory schema](figures/database/09-daily-inventory.svg) and
[workflow](figures/database/10-inventory-workflow.svg) figures show this pipeline in detail.

| Table                              | Contents and identity                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.inventory_acquisitions`   | Immutable report metadata and verified archive manifest. Unique `(seller_namespace, amazon_scope, report_id)`.                                        |
| `private.inventory_daily_captures` | The sole successful result for `(seller_namespace, marketplace_name, capture_date)`, with acquisition ID, parser version, row count, and diagnostics. |
| `private.inventory_items`          | Exact SKU observations; primary key `(capture_id, sku)`, unique positive `(capture_id, source_line_number)`. All source metrics are nullable.         |

The capture's composite FK must match its acquisition's seller, marketplace, and original capture
date. Replacing a capture creates a fresh ID and deletes the former header and its cascading items
in one transaction. A failed publication retains the earlier complete result. Other days and all
raw acquisitions remain available. Inventory does not participate in payout calculations.

A capture records only success; there are no running/failed placeholder rows or current-version
pointer. The inventory-specific `inventory-v1` label is independent of financial preprocessing.
Change that label when parsing semantics change; replaying the selected acquisition with the same
label is an idempotent no-op.

## Report fields

Unit counts are nonnegative `bigint`; sales and coverage use finite `numeric`. Missing or invalid
optional cells stay NULL with diagnostics. A reported zero stays zero. Values are not constrained by
financial control totals or equations between overlapping inventory categories.

| Column                             | Type      | Report field                                                 |
| ---------------------------------- | --------- | ------------------------------------------------------------ |
| `snapshot_date`                    | `date`    | `snapshot-date`                                              |
| `available_quantity`               | `bigint`  | `available`                                                  |
| `fba_supply_quantity`              | `bigint`  | `Inventory Supply at FBA`                                    |
| `inbound_quantity`                 | `bigint`  | `inbound-quantity`                                           |
| `inbound_working_quantity`         | `bigint`  | `inbound-working`                                            |
| `inbound_shipped_quantity`         | `bigint`  | `inbound-shipped`                                            |
| `inbound_received_quantity`        | `bigint`  | `inbound-received`                                           |
| `reserved_quantity`                | `bigint`  | `Total Reserved Quantity`                                    |
| `reserved_transfer_quantity`       | `bigint`  | `Reserved FC Transfer`; observed alias `fc-transfer`         |
| `reserved_processing_quantity`     | `bigint`  | `Reserved FC Processing`                                     |
| `reserved_customer_order_quantity` | `bigint`  | `Reserved Customer Order`                                    |
| `unfulfillable_quantity`           | `bigint`  | `unfulfillable-quantity`                                     |
| `sales_amount_90d`                 | `numeric` | `sales-shipped-last-90-days`                                 |
| `units_shipped_90d`                | `bigint`  | `units-shipped-t90`                                          |
| `currency`                         | `text`    | `currency`                                                   |
| `health_status`                    | `text`    | `fba-inventory-level-health-status`                          |
| `minimum_inventory_units`          | `bigint`  | `fba-minimum-inventory-level`                                |
| `days_of_supply`                   | `numeric` | `days-of-supply`                                             |
| `total_days_of_supply`             | `numeric` | `Total Days of Supply (including units from open shipments)` |
| `recommended_ship_in_units`        | `bigint`  | `Recommended ship-in quantity`                               |
| `recommended_ship_in_date`         | `date`    | `Recommended ship-in date`                                   |
| `recommended_action`               | `text`    | `recommended-action`                                         |

`fc-transfer` is the observed source header; the documented `Reserved FC Transfer` spelling is also
accepted. Keep `inbound-received` distinct from the Inventory API's inbound-receiving metric. Do not
sum overlapping quantities or invent a minimum-stock-in-days value. Sales without usable currency
remain unavailable, and overlapping 90-day windows must not be summed as daily sales.

The real Japan report tested on 2026-09-29 omitted health status and minimum inventory. Those fields
correctly remain unavailable. Field availability can vary by marketplace. Nonmissing health and
recommendation values must match the fixed source vocabulary below; unsupported values fail
preprocessing instead of silently creating a new category.

## Acquisition and offline preprocessing

1. Request or resume one full report. Pending, cancelled, failed, or timed-out requests produce no
   successful acquisition and never imply zero stock. The correlated log retains the accepted report
   ID before polling so a timeout or polling failure can be resumed.
2. Download and archive decoded bytes using the shared private Storage, XZ/CRC64, SHA-256, and length
   checks. Publish the acquisition only after the archive is verified. Do not retain temporary signed
   URLs or credentials in metadata. Successful raw archives and acquisitions are retained indefinitely.
3. Preprocess a saved acquisition ID offline. Verify and decode the retained archive; never call
   Amazon or replace a failed parse with another source.
4. Parse the complete TSV with exact SKU identity. Ignore unused columns, validate categorical
   values, and diagnose missing/invalid optional metrics. Collapse identical duplicates; omit blank SKUs and
   ambiguous conflicting duplicates. A nonempty document with no usable SKU rows fails instead of
   publishing false empty stock. Unreadable bytes, wrong marketplace, and malformed rows also fail.
5. The Python repository publishes the complete capture under a database lock on the natural day key. Check the expected existing
   capture ID and observation order, then replace the header/items atomically. A genuinely empty
   valid report publishes a zero-row header. Stale workers or older observations cannot overwrite a
   newer successful capture.
6. Rotate the small `inventory` revision token at commit. Archive-only downloads, idempotent replay,
   and rollback do not change it. No financial revision token is changed by inventory publication.

This reuses Data Kiosk's archive → offline preprocess → atomic publication pattern. Inventory
combines the day identity and its one retained result into a single header, without financial
allocation components, completeness cutoffs, fee coverage, or monetary reconciliation.

## Dates, latest reads, and access

Compute `capture_date` from the original report creation time in the marketplace's named timezone,
recorded in acquisition metadata. Downloads across midnight and later reprocessing retain that
original day. Keep each row's `snapshot_date` separate; it may lag or be absent. Today's report can
produce today's inventory capture. Date filters do not establish historical stock backfill.

Within a day, order observations by `(report_created_at, acquisition_id)`. A changed parser may
replace the selected acquisition with an expected-ID check; an older observation may not displace
it. A missed day remains missing, and reads show the last successful capture with its actual dates.

`public.latest_inventory_captures` selects the latest complete header per seller/marketplace before
joining any items. `public.latest_inventory_items` then joins that capture's rows and current
ownership by exact SKU alone. An absent SKU or empty latest capture never falls back to older
per-SKU stock. Namespaces describe source provenance, not ownership; quantities across marketplaces
or namespaces are not an assumed physical total.

The browser uses those minimal capture references to distinguish marketplace availability independently
of item filters. A missing capture, a completed empty capture, and a member with no authorized items
have distinct empty states; a member is never told that another company's stock is empty. The complete
authorized item snapshot distinguishes no available items from no filter matches. Capture discovery
is paged and contains no financial amounts or item data.

Each item combines its source date and age in one row caption, with an inline Out of date warning
when needed. There is no separate marketplace freshness panel. A missing snapshot date is labelled
explicitly, with the report date as a fallback. Source dates
more than two marketplace-local calendar days old are out of date; dates beyond the marketplace's
current day receive a future-date warning. The browser uses generated IANA time zones from the same
definitions as capture creation. Stock calendar dates stay intact; fallback report timestamps convert
to the marketplace's date. On-screen age updates do not request new data. Exact report and processing
timestamps remain in UTC; reprocessing does not reset source age.
Visible filter chips name and individually clear persisted criteria. Sales ordering remains in the
original currencies; the Sales amount help control beside the column heading explains that scope.
Marketplace selections live in their own column menu. Administrators also filter the Company column
by company or Unassigned; member views omit that column and ignore company filters. Multiple
selections are alternatives within a column and intersect across columns, before counts and paging.

The browser loads every authorized row from `public.latest_inventory_items` using stable identity
pages, then caches the complete snapshot. SKU options come from that snapshot. Health and
recommendation options are constants checked against the preprocessing vocabulary, including a
separate unavailable option for null. No read function discovers fixed categories. Database CHECK
constraints accept exactly the same nonnull source values as preprocessing.
Revision and account checks bracket item retrieval. The initial account must match the workspace
identity before items are requested. A concurrent publication or access change rejects the partial
load and allows the automatic retry to fetch a consistent snapshot.

The frontend applies search, filters, exact decimal sales comparisons, urgency ordering, and
pagination to the complete snapshot. SQL exposes source facts without presentation ranks.
Missing values remain last in either urgency direction; exact SKU, marketplace, and capture ID
provide stable ties. The priorities below are UI choices, independent of the source contract.

| Accepted recommendation source value | Display label | UI priority |
| --- | --- | ---: |
| `GoToRestock` | Restock | 50 |
| `SendToFBA` | Send to FBA | 50 |
| `CreateShippingPlan` | Create shipping plan | 50 |
| `GoToStranded` | Resolve stranded inventory | 40 |
| `Edit listing` | Edit listing | 30 |
| `Lower price` | Lower price | 20 |
| `Advertise listing` | Advertise listing | 10 |
| `NoExcessInventory` | No excess inventory | 0 |
| `NoRestockExcessActionRequired` | No restock or excess action required | 0 |

Replenishment actions share the highest rank as an action category. Their labels do not indicate
shipment progress or equal stockout risk; recommended ship dates, stock coverage, and inbound
inventory do not affect this ordering. Their row labels use the strongest emphasis;
stranded inventory uses an amber warning, listing maintenance uses blue, and routine or no-action
labels use neutral styling. The complete health vocabulary is `Out of stock`, `Low stock`,
`Excess`, and `Healthy`, with UI priorities 40, 30, 20, and 0 respectively.

Preprocessing trims surrounding whitespace and recognizes explicit missing-value tokens such as
blank, `-`, and `N/A`. Other category values must match exactly; case and punctuation do not create
aliases. Unsupported values also fail on blank-SKU and conflicting duplicate rows before
those rows can be omitted. Original archives retain the source bytes. The frontend maps accepted
codes to explicit sentence-case labels and colors; search matches source values and display labels.

All three private tables use RLS. Members read latest items for currently owned SKUs; administrators also
see unassigned items and retained history. A caller-checked private helper exposes minimal latest
capture references/dates, including empty captures, and hides seller namespaces from members.
Manifests, raw headers, and diagnostics stay administrator-only. No application role can publish captures
or mutate inventory. Source imports require no SKU/company FK and may precede assignment.

Inventory-only discoveries do not enter financial setup validation automatically. Inventory creates
no required fee dates. Ownership edits use the existing exact-SKU terms system.

## Commands

Run from the repository root in the `A-SelBox` Anaconda environment. Shared CLI configuration uses
`services/sync/.env`; keep credentials there, not in command arguments.

```bash
conda run -n A-SelBox python -m services.sync.src.cli.download_inventory \
  --scope NA --seller-namespace seller-na --marketplace-id ATVPDKIKX0DER

conda run -n A-SelBox python -m services.sync.src.cli.preprocess_inventory \
  --acquisition-id ACQUISITION_UUID
```

Pass the successful acquisition ID from download to preprocessing. Downloading alone does not
change displayed inventory. Add `--report-id REPORT_ID` to resume an accepted report without another
`createReport`; source type/scope/status validation still applies, and its original timestamp
remains authoritative. It does not create a fresher observation.

Polling defaults to 60 attempts ten seconds apart; `--max-poll-attempts` and
`--poll-interval-seconds` configure those bounds. See `--help` and the
[sync configuration guide](../services/sync/README.md#configuration) for local endpoint options.
No recurring scheduler or deployment is installed by these commands.

## Browser updates and verification

The read-only Inventory tab uses the same lightweight revision checks as Transactions. While
visible and online it checks every 60 seconds; focus/visibility return checks when at least 30
seconds stale, and reconnection checks immediately. Unchanged `inventory` and ownership (`fees`)
tokens retain the cached complete item snapshot. Relevant changes reload the snapshot and capture
references; failed reads retry on
the next check. These checks read the small token table, not capture headers or item rows, and never
call Amazon. No manual reload or shipment controls are present.

The [unit tests](../services/sync/tests/unit/inventory/) cover acquisition, parsing, replay, and CLI
isolation. Database tests cover [publication](../services/db/supabase/tests/test_inventory_publication.py),
[concurrency](../services/db/supabase/tests/test_inventory_concurrency.py),
[access](../services/db/supabase/tests/test_inventory_access.py), and
[revision checks](../services/db/supabase/tests/test_inventory_revisions.py).

The opt-in [live verifier](../services/db/supabase/tests/verification/inventory/) exercises real SP-API data
through disposable Storage, preprocessing, DB, Auth/REST, and browser checks. Its synthetic company
assignments are isolated test fixtures. [Recorded evidence](evidence/inventory/README.md) includes
scope, limitations, and the maintained verification command.
