# Design decision evidence

These source and implementation investigations support the final
[classification](../settlement_component_categories.md),
[source-allocation](../source_allocation.md), and [workflow](../data_workflows.md) contracts. Each
record preserves its observation date, sample scope, and limits. The contracts define current
behavior; the evidence explains the decisions and helps evaluate future source changes.

Read-performance reports below are dated historical records. Their JSON timings, plans and result
hashes remain intact; superseded executable candidates have been retired. Current page/count
definitions are in the [current read modules](../../services/db/supabase/README.md#schema-modules),
and new runs use the [maintained benchmark guide](../../services/db/supabase/benchmarks/README.md).

[Current transaction queries, September 25](current_transaction_queries_2026-09-25/README.md)
records the installed implementation's final million-row REST latencies, count/index plans,
exact-result checks and obsolete-code cleanup.

| Investigation                                                                                     | Evidence retained                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Blank marketplaces, September 6](blank_marketplace_investigation_2026-09-06.md)                  | Reports API hints versus row names, balance movements, and investigative Finances matches.                                                           |
| [SKU completeness, September 7](settlement_sku_completeness_2026-09-07.md)                        | All 107 raw triples and SKU presence across NA, EU, Australia, and Singapore; [sanitized measurements](settlement_sku_completeness_2026-09-07.json). |
| [Classification audit, September 8](settlement_classification_audit_2026-09-08.md)                | Wider date and marketplace coverage, retrocharge qualifications, and [sanitized measurements](settlement_classification_audit_2026-09-08.json).      |
| [Trailing columns, September 11](settlement_trailing_columns_investigation_2026-09-11.md)         | Acquisition-time evidence for omitted optional suffix cells and limits of the parsing assumption.                                                    |
| [Data Kiosk disposal discrepancy, September 7](data_kiosk_disposal_discrepancy_2026-09-07.md)     | The accepted USD 54.48 source difference and [sanitized controls](data_kiosk_disposal_discrepancy_2026-09-07.json).                                  |
| [Company-cost country evidence, September 13](category3_country_evidence_2026-09-13.md)           | Native labels, tax and credit shapes across 15 countries; [sanitized measurements](category3_country_evidence_2026-09-13.json) and coverage limits.  |
| [EPR and adjustment coverage, September 13](data_kiosk_epr_and_adjustment_coverage_2026-09-13.md) | No explicit counterpart in the checked US/GB Economics responses; mapping remains unverified.                                                        |
| [Live read optimization, September 19](live_read_optimization_2026-09-19.md)                      | Relational reads, source-authorization and index changes, semantic checks, and bounded larger-data/concurrent-read measurements.                     |

[Bounded summary reads, September 19](bounded_summary_reads_2026-09-19/README.md) records
exact-result checks, response-size reductions, and the measured member latency tradeoff for
date-scoped summary requests.

[Workspace revision polling, September 23](workspace_revision_polling_2026-09-23.md) records
lightweight authenticated change detection, selective refresh dependencies, publication and
permission regressions, and local query-cost measurements.

[Page selection before fees, September 23](page_first_transactions_2026-09-23/README.md) records the
conditional page RPC, exact-count plan costs, permission/result equivalence, and before/after HTTP
timings on seed and million-row fixtures.

[Progressive counts, September 23](progressive_counts_2026-09-23/README.md) compares the
then-current combined RPC with deferred and parallel exact counts, including first-row latency,
total completion, and additional database work.

[Date-ordered pages, September 25](ordered_pages_2026-09-25/README.md) compares bounded source
candidates, delayed metadata joins, and targeted indexes on disposable copies with unchanged tables
and access rules. It includes exact row comparisons, ownership mutations, multi-year data, and
concurrent readers.

[Native marketplace RPC filters, September 25](native_marketplace_filters_2026-09-25.json) records
the enum-array migration's local application, unchanged valid-request results, invalid-label
rejection, and preserved function permissions and other schema definitions.

Historical FBA, Finances, and inventory comparisons corroborate specific findings; those APIs are
not inputs to the application. Raw financial documents, seller and customer identifiers,
credentials, and signed URLs are not checked in.

[Transaction fee filter, September 25](transaction_fee_filter_2026-09-25.json) records local
application of the date-only page contract and fee-applicability filter, unchanged default results,
filtered page/count equivalence, removal of the old sort signature and unchanged access rules.

[Dedicated aggregation RPCs, September 25](dedicated_aggregation_2026-09-25/README.md) records
optimized summaries/options, disabled generated REST aggregates, exact-result checks and two
million-row fixture comparisons.

[Database read refactor, September 25](database_read_refactor_2026-09-25/README.md) records the
consolidated baseline, shared read rules, unchanged tables/access contracts, fresh-install tests,
and before/after million-row measurements.

[Reported amount ordering, September 25](reported_amount_ordering_2026-09-25/README.md) records the
amount indexes and page functions for all three financial tabs, unchanged source/access semantics,
and verification against the existing views.

[Filtered transaction reads, September 25](text_search_2026-09-25/README.md) records simple
visible-field search, the 10,000-match amount-ordering limit, removal of amount indexes, and
unchanged access controls.

[Reversible date ordering, September 25](reversible_date_ordering_2026-09-25/README.md) records the
single date/ID index per source, reversed tie-breakers, forward/backward plan verification, and
pagination regression coverage.

[Balanced financial read indexes, September 25](balanced_read_indexes_2026-09-25/README.md) compares
ten candidate sets, repeated million-row reads, index footprint and insert cost, then records the
selected compact indexes and unchanged authorization/financial behavior.

[Indexes outside transaction tables, September 25](other_table_indexes_2026-09-25/README.md)
reviews every index across the other 19 application tables. It records redundant/unused-index
removals, the payout creation-order index, populated metadata/report benchmarks, and unchanged
constraints, access rules, financial behavior, and source data.

[Fee applicability by Type, September 26](fee_type_filter_2026-09-26/README.md) records use of
existing Type/date indexes, million-row page/count comparisons, exact-result checks, and the
unchanged fee-calculation and access rules.
