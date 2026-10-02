import { Alert, Button, Group, Tabs } from "@mantine/core";
import { UpdateStatus } from "./UpdateStatus";
import type { DatasetKey, TableDatasetKey } from "./api";
import { FinanceDataset } from "./FinanceDataset";
import { visibleDatasets, DATASET_PRESENTATION } from "./view-model";
import type { Identity } from "./auth-session";
import { CurrentFees } from "./CurrentFees";
import { Inventory } from "./Inventory";
import { FinancialReview } from "./FinancialReview";
import { useSkuConfiguration } from "./use-sku-configuration";
import { TransactionSummaries } from "./TransactionSummaries";
import type { DateRange } from "./estimated-periods";
import {
  createDatasetViewState,
  createFeeViewState,
  createInventoryViewState,
  type DatasetViewState,
} from "./workspace-view-state";
import { useWorkspacePreference } from "./use-workspace-preference";
import {
  decodeDatasetViews,
  decodeFeeView,
  decodeInventoryView,
  decodeWorkspaceTab,
} from "./workspace-view-codec";
import { normalizeDatasetFilters } from "./dataset-filters";

interface WorkspaceProps {
  identity: Identity;
  onRetry: () => Promise<void>;
  isUpdating: boolean;
  updateError: string | null;
}

export function FinanceWorkspace(props: WorkspaceProps) {
  const [selectedSummaryCurrency, setSelectedSummaryCurrency] = useWorkspacePreference<
    string | null
  >(
    "summary-currency",
    () => null,
    (value) => (typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null),
  );
  const [dataset, setDataset] = useWorkspacePreference<
    DatasetKey | "inventory" | "financial-review"
  >(
    "tab",
    () => "live",
    (value) => decodeWorkspaceTab(value, props.identity.account),
  );
  const [inventoryViewState, setInventoryViewState] = useWorkspacePreference(
    "inventory",
    createInventoryViewState,
    decodeInventoryView,
  );
  const [datasetViews, setDatasetViews] = useWorkspacePreference<
    Partial<Record<TableDatasetKey, DatasetViewState>>
  >("datasets", () => ({}), decodeDatasetViews);
  const [feeViewState, setFeeViewState] = useWorkspacePreference(
    "fees",
    createFeeViewState,
    decodeFeeView,
  );
  const feeConfiguration = useSkuConfiguration(
    props.identity,
    props.onRetry,
    feeViewState,
    setFeeViewState,
    dataset === "fees",
  );
  const datasets = visibleDatasets(props.identity.account);
  const transactions = datasetViews.live ?? createDatasetViewState("live");

  function selectPeriod(range: DateRange) {
    setDatasetViews((current) => {
      const previous = current.live ?? createDatasetViewState("live");
      return {
        ...current,
        live: {
          ...previous,
          filters: { ...previous.filters, dateFrom: range.from, dateTo: range.to },
          pagination: { ...previous.pagination, pageIndex: 0 },
          selectedRowId: null,
        },
      };
    });
    setDataset("live");
  }
  function showSkuTransactions(sku: string) {
    setDatasetViews((current) => {
      const previous = current.live ?? createDatasetViewState("live");
      return {
        ...current,
        live: {
          ...previous,
          search: "",
          filters: { ...normalizeDatasetFilters(), skus: [sku] },
          pagination: { ...previous.pagination, pageIndex: 0 },
          selectedRowId: null,
        },
      };
    });
    setDataset("live");
  }
  return (
    <>
      {props.updateError ? (
        <Alert role="alert" color="red" mb="sm">
          <Group justify="space-between">
            <span>{props.updateError}</span>
            {dataset === "inventory" ? (
              <span>Updates retry automatically.</span>
            ) : (
              <Button variant="subtle" onClick={() => void props.onRetry()}>
                Retry update
              </Button>
            )}
          </Group>
        </Alert>
      ) : null}
      <UpdateStatus active={props.isUpdating} mb="xs">
        Updating…
      </UpdateStatus>
      <Tabs
        value={dataset}
        onChange={(value) => {
          if (
            value === "inventory" ||
            (value === "financial-review" && props.identity.account.access_role === "operator")
          ) {
            setDataset(value);
            return;
          }
          const next = datasets.find((key) => key === value);
          if (next) setDataset(next);
        }}
        className="dataset-tabs"
      >
        <Tabs.List aria-label="Workspace data">
          {datasets.map((key) => (
            <Tabs.Tab key={key} value={key}>
              {DATASET_PRESENTATION[key].label}
            </Tabs.Tab>
          ))}
          <Tabs.Tab value="inventory">Inventory</Tabs.Tab>
          {props.identity.account.access_role === "operator" ? (
            <Tabs.Tab value="financial-review">Financial review</Tabs.Tab>
          ) : null}
        </Tabs.List>
        <Tabs.Panel value={dataset} pt="md">
          {dataset === "live" ? (
            <TransactionSummaries
              identity={props.identity}
              selectedCurrency={selectedSummaryCurrency}
              onCurrencyChange={setSelectedSummaryCurrency}
              onRetry={props.onRetry}
              companyIds={transactions.filters.companyIds}
              skus={transactions.filters.skus}
              marketplaces={transactions.filters.marketplaces}
              dateRange={{ from: transactions.filters.dateFrom, to: transactions.filters.dateTo }}
              onPeriodSelect={selectPeriod}
            />
          ) : null}
          {dataset === "inventory" ? (
            <Inventory
              identity={props.identity}
              viewState={inventoryViewState}
              onViewStateChange={setInventoryViewState}
              onShowTransactions={showSkuTransactions}
            />
          ) : dataset === "financial-review" ? (
            <FinancialReview identity={props.identity} onRetry={props.onRetry} />
          ) : dataset === "fees" ? (
            <CurrentFees
              identity={props.identity}
              controller={feeConfiguration}
              viewState={feeViewState}
              onViewStateChange={setFeeViewState}
              onShowTransactions={showSkuTransactions}
            />
          ) : (
            <FinanceDataset
              key={dataset}
              dataset={dataset}
              identity={props.identity}
              onRetry={props.onRetry}
              viewState={datasetViews[dataset] ?? createDatasetViewState(dataset)}
              onViewStateChange={(update) => {
                setDatasetViews((current) => {
                  const previous = current[dataset] ?? createDatasetViewState(dataset);
                  return {
                    ...current,
                    [dataset]: typeof update === "function" ? update(previous) : update,
                  };
                });
              }}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
