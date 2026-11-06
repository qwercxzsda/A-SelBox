# Database schema

The fresh-install migrations define **28 application tables, 261 table columns, 34 foreign keys and 23 ordinary views**. These figures and keys are generated from an isolated installation of the actual migrations, without reading existing financial data.

Finances stores stable transaction identities, immutable transaction versions and components, and the exact versions observed by each successful preprocessing batch. All Finance business validation runs in Python before publication; raw pages stay in private Storage. Data Kiosk retains complete daily versions and its separate pruning policy. Payouts pin Finance batches, Data Kiosk versions and company terms. Inventory keeps its separate one-capture-per-day model.

See [data workflows](data_workflows.md), [Finances transactions](finances_transactions.md), [source allocation](source_allocation.md), [company terms](company_fees.md), [payouts](company_payout_reports.md), and [access](access_control.md) for behavioral contracts.

## Reading the figures

Every application table column appears in its group's full figure. `NN` means NOT NULL; `NULL` means nullable. Repeated PK markers identify a composite primary key. FK markers can be members of a composite constraint; exact tuples are listed below. A reference box includes only the referenced primary key. Managed Auth/Storage internals appear only at their application boundaries. Overview arrows point from child to parent; dotted archive links are manifest references, not SQL foreign keys.

## Complete relationship map

![Complete relationship map](figures/database/01-overview.svg)

[Full SVG](figures/database/01-overview.svg) · [Mermaid source](figures/database/01-overview.mmd)

## Ownership fees and access

![Ownership fees and access](figures/database/02-ownership.svg)

[Full SVG](figures/database/02-ownership.svg) · [Mermaid source](figures/database/02-ownership.mmd)

## Finances acquisitions and successful batch membership

![Finances acquisitions and successful batch membership](figures/database/03-finances-observations.svg)

[Full SVG](figures/database/03-finances-observations.svg) · [Mermaid source](figures/database/03-finances-observations.mmd)

## Finances transaction identities versions and components

![Finances transaction identities versions and components](figures/database/03b-finances-facts.svg)

[Full SVG](figures/database/03b-finances-facts.svg) · [Mermaid source](figures/database/03b-finances-facts.mmd)

## Data Kiosk acquisitions and daily versions

![Data Kiosk acquisitions and daily versions](figures/database/04-data-kiosk-observations.svg)

[Full SVG](figures/database/04-data-kiosk-observations.svg) · [Mermaid source](figures/database/04-data-kiosk-observations.mmd)

## Data Kiosk components and retention

![Data Kiosk components and retention](figures/database/05-data-kiosk-facts.svg)

[Full SVG](figures/database/05-data-kiosk-facts.svg) · [Mermaid source](figures/database/05-data-kiosk-facts.mmd)

## Payout results reconciliation and refresh state

![Payout results reconciliation and refresh state](figures/database/06-payout-results.svg)

[Full SVG](figures/database/06-payout-results.svg) · [Mermaid source](figures/database/06-payout-results.mmd)

## Payout source batches day versions and terms manifests

![Payout source batches day versions and terms manifests](figures/database/07-payout-manifests.svg)

[Full SVG](figures/database/07-payout-manifests.svg) · [Mermaid source](figures/database/07-payout-manifests.mmd)

## Workspace revision tokens

![Workspace revision tokens](figures/database/08-revisions.svg)

[Full SVG](figures/database/08-revisions.svg) · [Mermaid source](figures/database/08-revisions.mmd)

## Daily inventory captures

![Daily inventory captures](figures/database/09-daily-inventory.svg)

[Full SVG](figures/database/09-daily-inventory.svg) · [Mermaid source](figures/database/09-daily-inventory.mmd)

## Inventory workflow

![Inventory workflow](figures/database/10-inventory-workflow.svg)

[Full SVG](figures/database/10-inventory-workflow.svg) · [Mermaid source](figures/database/10-inventory-workflow.mmd)

## Views and direct catalog dependencies

![Views and direct catalog dependencies](figures/database/11-views.svg)

[Full SVG](figures/database/11-views.svg) · [Mermaid source](figures/database/11-views.mmd)

View dependencies show direct references tracked by PostgreSQL. Function nodes are boundaries; quoted SQL or procedural function bodies can read additional objects without creating a catalog dependency edge.

## Primary and unique keys

| Table | Primary key | Additional unique keys |
| --- | --- | --- |
| `private.data_kiosk_acquisitions` | `(id)` | `(seller_namespace, amazon_scope, root_query_id)` |
| `private.data_kiosk_days` | `(id)` | `(seller_namespace, marketplace_name, activity_date, dataset_key)` |
| `private.data_kiosk_preprocess_batches` | `(id)` | None |
| `private.data_kiosk_preprocess_versions` | `(id)` | `(batch_id, day_id)`; `(day_id, id)` |
| `private.data_kiosk_pruned_versions` | `(version_id)` | None |
| `private.data_kiosk_transactions` | `(id)` | `(version_id, component_key)` |
| `private.finances_acquisitions` | `(id)` | None |
| `private.finances_preprocess_batch_transactions` | `(batch_id, transaction_id)` | `(batch_id, transaction_id, version_id)` |
| `private.finances_preprocess_batches` | `(id)` | None |
| `private.finances_transaction_components` | `(id)` | `(version_id, component_number)` |
| `private.finances_transaction_versions` | `(id)` | `(transaction_id, content_sha256)`; `(transaction_id, id)` |
| `private.finances_transactions` | `(id)` | `(seller_namespace, amazon_scope, native_transaction_id)` |
| `private.inventory_acquisitions` | `(id)` | `(seller_namespace, amazon_scope, report_id)`; `(seller_namespace, marketplace_name, capture_date, id)` |
| `private.inventory_daily_captures` | `(id)` | `(seller_namespace, marketplace_name, capture_date)` |
| `private.inventory_items` | `(capture_id, sku)` | `(capture_id, source_line_number)` |
| `private.payout_report_data_kiosk_versions` | `(report_id, day_id)` | `(report_id, version_id)` |
| `private.payout_report_finances_batches` | `(report_id, batch_id)` | None |
| `private.payout_report_reconciliation` | `(report_id, row_number)` | `(report_id, seller_namespace, activity_date, marketplace_name, currency)` |
| `private.payout_report_refresh_state` | `(company_id, month)` | None |
| `private.payout_report_terms_versions` | `(report_id, sku_id)` | `(report_id, terms_version_id)` |
| `private.workspace_revision_tokens` | `(source, scope_company_id)` | None |
| `public.app_accounts` | `(user_id)` | None |
| `public.companies` | `(id)` | None |
| `public.company_payout_report_components` | `(id)` | `(report_id, source, source_row_id)`; `(report_id, row_number)` |
| `public.company_payout_reports` | `(id)` | None |
| `public.sku_fee_periods` | `(id)` | `(terms_version_id, id)` |
| `public.sku_terms_versions` | `(id)` | `(sku_id, id)`; `(sku_id, version_number)` |
| `public.skus` | `(id)` | `(sku)` |

## Foreign keys

| Child table | Constraint |
| --- | --- |
| `private.data_kiosk_days` | `FOREIGN KEY (id, current_version_id) REFERENCES private.data_kiosk_preprocess_versions(day_id, id)` |
| `private.data_kiosk_preprocess_batches` | `FOREIGN KEY (acquisition_id) REFERENCES private.data_kiosk_acquisitions(id)` |
| `private.data_kiosk_preprocess_versions` | `FOREIGN KEY (batch_id) REFERENCES private.data_kiosk_preprocess_batches(id)` |
| `private.data_kiosk_preprocess_versions` | `FOREIGN KEY (day_id) REFERENCES private.data_kiosk_days(id)` |
| `private.data_kiosk_pruned_versions` | `FOREIGN KEY (version_id) REFERENCES private.data_kiosk_preprocess_versions(id)` |
| `private.data_kiosk_transactions` | `FOREIGN KEY (version_id) REFERENCES private.data_kiosk_preprocess_versions(id)` |
| `private.finances_preprocess_batch_transactions` | `FOREIGN KEY (transaction_id, version_id) REFERENCES private.finances_transaction_versions(transaction_id, id)` |
| `private.finances_preprocess_batch_transactions` | `FOREIGN KEY (batch_id) REFERENCES private.finances_preprocess_batches(id)` |
| `private.finances_preprocess_batch_transactions` | `FOREIGN KEY (transaction_id) REFERENCES private.finances_transactions(id)` |
| `private.finances_preprocess_batches` | `FOREIGN KEY (acquisition_id) REFERENCES private.finances_acquisitions(id)` |
| `private.finances_transaction_components` | `FOREIGN KEY (version_id) REFERENCES private.finances_transaction_versions(id)` |
| `private.finances_transaction_versions` | `FOREIGN KEY (transaction_id) REFERENCES private.finances_transactions(id)` |
| `private.finances_transactions` | `FOREIGN KEY (current_batch_id, id, current_version_id) REFERENCES private.finances_preprocess_batch_transactions(batch_id, transaction_id, version_id) DEFERRABLE INITIALLY DEFERRED` |
| `private.inventory_daily_captures` | `FOREIGN KEY (seller_namespace, marketplace_name, capture_date, acquisition_id) REFERENCES private.inventory_acquisitions(seller_namespace, marketplace_name, capture_date, id)` |
| `private.inventory_items` | `FOREIGN KEY (capture_id) REFERENCES private.inventory_daily_captures(id) ON DELETE CASCADE` |
| `private.payout_report_data_kiosk_versions` | `FOREIGN KEY (day_id, version_id) REFERENCES private.data_kiosk_preprocess_versions(day_id, id)` |
| `private.payout_report_data_kiosk_versions` | `FOREIGN KEY (report_id) REFERENCES company_payout_reports(id)` |
| `private.payout_report_finances_batches` | `FOREIGN KEY (batch_id) REFERENCES private.finances_preprocess_batches(id)` |
| `private.payout_report_finances_batches` | `FOREIGN KEY (report_id) REFERENCES company_payout_reports(id)` |
| `private.payout_report_reconciliation` | `FOREIGN KEY (report_id) REFERENCES company_payout_reports(id)` |
| `private.payout_report_refresh_state` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE` |
| `private.payout_report_terms_versions` | `FOREIGN KEY (report_id) REFERENCES company_payout_reports(id)` |
| `private.payout_report_terms_versions` | `FOREIGN KEY (sku_id, terms_version_id) REFERENCES sku_terms_versions(sku_id, id)` |
| `public.app_accounts` | `FOREIGN KEY (company_id) REFERENCES companies(id)` |
| `public.app_accounts` | `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE` |
| `public.company_payout_report_components` | `FOREIGN KEY (terms_version_id, fee_period_id) REFERENCES sku_fee_periods(terms_version_id, id)` |
| `public.company_payout_report_components` | `FOREIGN KEY (report_id, terms_version_id) REFERENCES private.payout_report_terms_versions(report_id, terms_version_id)` |
| `public.company_payout_report_components` | `FOREIGN KEY (report_id) REFERENCES company_payout_reports(id)` |
| `public.company_payout_report_components` | `FOREIGN KEY (sku_id, terms_version_id) REFERENCES sku_terms_versions(sku_id, id)` |
| `public.company_payout_reports` | `FOREIGN KEY (company_id) REFERENCES companies(id)` |
| `public.sku_fee_periods` | `FOREIGN KEY (terms_version_id) REFERENCES sku_terms_versions(id)` |
| `public.sku_terms_versions` | `FOREIGN KEY (company_id) REFERENCES companies(id)` |
| `public.sku_terms_versions` | `FOREIGN KEY (sku_id) REFERENCES skus(id)` |
| `public.skus` | `FOREIGN KEY (id, current_terms_version_id) REFERENCES sku_terms_versions(sku_id, id)` |

## Read views

| View | Columns |
| --- | --- |
| `private.current_sku_terms` | `sku_id`, `sku`, `terms_version_id`, `company_id` |
| `private.finances_activity_components` | `id`, `version_id`, `transaction_id`, `seller_namespace`, `amazon_scope`, `native_transaction_id`, `current_batch_id`, `posted_date`, `posted_at`, `marketplace_id`, `marketplace_name`, `account_type`, `transaction_type`, `transaction_status`, `deferred_transaction_id`, `release_transaction_id`, `activity_eligible`, `currency`, `component_number`, `category`, `component_type`, `accounting_subtype`, `sku`, `amount`, `quantity`, `fee_base`, `breakdown_path`, `item_index`, `breakdown_indexes`, `created_at`, `is_current` |
| `private.finances_batch_components` | `id`, `version_id`, `transaction_id`, `seller_namespace`, `amazon_scope`, `native_transaction_id`, `current_batch_id`, `posted_date`, `posted_at`, `marketplace_id`, `marketplace_name`, `account_type`, `transaction_type`, `transaction_status`, `deferred_transaction_id`, `release_transaction_id`, `activity_eligible`, `currency`, `component_number`, `category`, `component_type`, `accounting_subtype`, `sku`, `amount`, `quantity`, `fee_base`, `breakdown_path`, `item_index`, `breakdown_indexes`, `created_at`, `is_current`, `batch_id`, `preprocess_version`, `acquisition_id`, `source_page_number`, `source_record_number` |
| `private.finances_component_details` | `id`, `version_id`, `transaction_id`, `seller_namespace`, `amazon_scope`, `native_transaction_id`, `current_batch_id`, `posted_date`, `posted_at`, `marketplace_id`, `marketplace_name`, `account_type`, `transaction_type`, `transaction_status`, `deferred_transaction_id`, `release_transaction_id`, `activity_eligible`, `currency`, `component_number`, `category`, `component_type`, `accounting_subtype`, `sku`, `amount`, `quantity`, `fee_base`, `breakdown_path`, `item_index`, `breakdown_indexes`, `created_at`, `is_current` |
| `private.live_company_component_inputs` | `source`, `source_row_id`, `source_version_id`, `preprocess_version`, `source_identity_id`, `seller_namespace`, `marketplace_name`, `activity_date`, `sku`, `component_type`, `currency`, `source_amount`, `quantity`, `fee_base`, `category`, `authoritative`, `sku_id`, `terms_version_id`, `company_id` |
| `private.live_source_reconciliation` | `seller_namespace`, `activity_date`, `marketplace_name`, `currency`, `finances_category_amount`, `selbox_category_amount`, `data_kiosk_finances_control`, `data_kiosk_category_amount`, `difference`, `finances_total`, `accounted_total` |
| `private.source_reconciliation_inputs` | `source`, `source_version_id`, `seller_namespace`, `activity_date`, `marketplace_name`, `currency`, `category`, `amount` |
| `public.company_skus` | `id`, `sku`, `company_id`, `terms_version_id` |
| `public.current_sku_fee_periods` | `sku_id`, `company_id`, `terms_version_id`, `marketplace_name`, `fee_period_id`, `valid_period`, `fee_rate_percent` |
| `public.data_kiosk_preprocess_entries` | `id`, `version_id`, `seller_namespace`, `marketplace_name`, `activity_date`, `component_key`, `sku`, `category`, `component_type`, `amount`, `currency`, `quantity`, `fee_base`, `native_dimensions`, `source_document_id`, `source_line_number`, `created_at`, `preprocess_version`, `day_id` |
| `public.data_kiosk_preprocess_results` | `id`, `day_id`, `batch_id`, `acquisition_id`, `seller_namespace`, `amazon_scope`, `marketplace_name`, `activity_date`, `dataset_key`, `preprocess_version`, `row_count`, `content_sha256`, `created_at`, `is_current`, `is_pruned` |
| `public.finances_preprocess_entries` | `id`, `version_id`, `transaction_id`, `seller_namespace`, `amazon_scope`, `native_transaction_id`, `current_batch_id`, `posted_date`, `posted_at`, `marketplace_id`, `marketplace_name`, `account_type`, `transaction_type`, `transaction_status`, `deferred_transaction_id`, `release_transaction_id`, `activity_eligible`, `currency`, `component_number`, `category`, `component_type`, `accounting_subtype`, `sku`, `amount`, `quantity`, `fee_base`, `breakdown_path`, `item_index`, `breakdown_indexes`, `created_at`, `is_current`, `batch_id`, `preprocess_version`, `source_page_number`, `source_record_number` |
| `public.finances_preprocess_results` | `id`, `acquisition_id`, `seller_namespace`, `amazon_scope`, `query_start_date`, `query_end_date`, `preprocess_version`, `transaction_count`, `component_count`, `created_at` |
| `public.financial_review_records` | `source`, `source_row_id`, `source_version_id`, `activity_date`, `seller_namespace`, `marketplace_name`, `sku`, `component_type`, `category`, `currency`, `amount` |
| `public.latest_company_payout_reports` | `id`, `company_id`, `marketplace_name`, `currency`, `start_date`, `end_date`, `dataset_key`, `report_name`, `change_reason`, `calculation_version`, `component_count`, `reconciliation_count`, `finances_batch_count`, `data_kiosk_version_count`, `terms_version_count`, `source_amount`, `fee_amount`, `company_amount`, `created_at`, `month_label` |
| `public.latest_inventory_captures` | `capture_id`, `seller_namespace`, `marketplace_name`, `capture_date`, `report_created_at`, `preprocessed_at` |
| `public.latest_inventory_items` | `capture_id`, `seller_namespace`, `capture_date`, `marketplace_name`, `sku`, `company_id`, `report_created_at`, `preprocessed_at`, `snapshot_date`, `available_quantity`, `fba_supply_quantity`, `inbound_quantity`, `inbound_working_quantity`, `inbound_shipped_quantity`, `inbound_received_quantity`, `reserved_quantity`, `reserved_transfer_quantity`, `reserved_processing_quantity`, `reserved_customer_order_quantity`, `unfulfillable_quantity`, `sales_amount_90d`, `units_shipped_90d`, `currency`, `health_status`, `minimum_inventory_units`, `days_of_supply`, `total_days_of_supply`, `recommended_ship_in_units`, `recommended_ship_in_date`, `recommended_action`, `health_status_urgency`, `recommended_action_urgency` |
| `public.live_company_components` | `source`, `source_row_id`, `source_version_id`, `preprocess_version`, `source_identity_id`, `seller_namespace`, `marketplace_name`, `activity_date`, `sku`, `component_type`, `currency`, `source_amount`, `quantity`, `fee_base`, `category`, `authoritative`, `sku_id`, `terms_version_id`, `company_id`, `fee_period_id`, `fee_rate_percent`, `resolution_status`, `fee_amount`, `company_amount` |
| `public.payout_reconciliation_totals` | `report_id`, `currency`, `finances_category_amount`, `selbox_category_amount`, `data_kiosk_finances_control`, `data_kiosk_category_amount`, `difference`, `finances_total`, `accounted_total`, `source_group_count` |
| `public.payout_report_data_kiosk_versions` | `report_id`, `day_id`, `version_id` |
| `public.payout_report_finances_batches` | `report_id`, `batch_id` |
| `public.payout_report_reconciliation` | `report_id`, `row_number`, `seller_namespace`, `activity_date`, `marketplace_name`, `currency`, `finances_category_amount`, `selbox_category_amount`, `data_kiosk_finances_control`, `data_kiosk_category_amount`, `difference`, `finances_total`, `accounted_total` |
| `public.payout_report_terms_versions` | `report_id`, `sku_id`, `terms_version_id` |

## Regenerate

From the repository root with the local test PostgreSQL server and Docker running:

```sh
conda run --no-capture-output -n A-SelBox python -m docs.generate_schema_figures --render
```

The generator installs migrations in a disposable database, derives columns/constraints/views from PostgreSQL catalogs, and removes that database. SVG rendering uses the pinned Mermaid CLI Docker image; no native Node/npm installation is required. `--check` verifies Markdown/Mermaid sources without changing files. The inventory workflow is a maintained behavioral diagram; all relational figures are generated.
