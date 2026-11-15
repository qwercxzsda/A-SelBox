import type { AppAccount, TransactionSummaryScope } from "./api/types.ts";
import type { SummaryFilter } from "./SummaryFilters";
import { companyLabel } from "./view-model.ts";
import { humanizeCode } from "./categories.ts";
import { filterOptions, transactionTypeValues } from "./filter-options.ts";
import { transactionTypeSelectionLabels } from "./transaction-type-groups.ts";

/** The overview and its drilldown describe the same transaction filter scope. */
export function transactionSummaryFilters(
  scope: TransactionSummaryScope,
  companies: Map<string, string>,
  role: AppAccount["access_role"],
): SummaryFilter[] {
  return (
    [
      { label: "Company", values: scope.companyIds.map((id) => companyLabel(id, companies)) },
      { label: "SKU", values: scope.skus },
      { label: "Marketplace", values: scope.marketplaces },
      { label: "Source", values: scope.sources.map(humanizeCode) },
      {
        label: "Type",
        values: transactionTypeSelectionLabels(
          filterOptions("component_type", transactionTypeValues("live", role), scope.types),
          scope.types,
        ),
      },
      {
        label: "Fee rate",
        values:
          scope.feeApplicability.length === 1
            ? [scope.feeApplicability[0] === "applicable" ? "Applicable" : "Not applicable"]
            : [],
      },
      { label: "Search", values: scope.search ? [scope.search] : [] },
    ] satisfies SummaryFilter[]
  ).filter((filter) => filter.values.length > 0);
}
