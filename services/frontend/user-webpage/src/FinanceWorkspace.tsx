import { useState } from "react";
import { Alert, Button, Group, Tabs } from "@mantine/core";
import { UpdateStatus } from "./UpdateStatus";
import type { DatasetKey, TableDatasetKey } from "./api";
import { FinanceDataset } from "./FinanceDataset";
import { visibleDatasets, DATASET_PRESENTATION } from "./view-model";
import type { Identity } from "./auth-session";
import { CurrentFees } from "./CurrentFees";
import { TransactionSummaries } from "./TransactionSummaries";
import type { DateRange } from "./estimated-periods";
import {
  createDatasetViewState,
  createFeeViewState,
  type DatasetViewState,
} from "./workspace-view-state";

interface WorkspaceProps {
  identity: Identity;
  onRetry: () => Promise<void>;
  isUpdating: boolean;
  updateError: string | null;
}

export function FinanceWorkspace(props: WorkspaceProps) {
  const [dataset, setDataset] = useState<DatasetKey>("live");
  const [datasetViews, setDatasetViews] = useState<
    Partial<Record<TableDatasetKey, DatasetViewState>>
  >({});
  const [feeViewState, setFeeViewState] = useState(createFeeViewState);
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
            <Button variant="subtle" onClick={() => void props.onRetry()}>
              Retry update
            </Button>
          </Group>
        </Alert>
      ) : null}
      <UpdateStatus active={props.isUpdating} mb="xs">
        Updating…
      </UpdateStatus>
      <TransactionSummaries
        identity={props.identity}
        onRetry={props.onRetry}
        companyIds={transactions.filters.companyIds}
        skus={transactions.filters.skus}
        marketplaces={transactions.filters.marketplaces}
        dateRange={{ from: transactions.filters.dateFrom, to: transactions.filters.dateTo }}
        onPeriodSelect={selectPeriod}
      />
      <Tabs
        value={dataset}
        onChange={(value) => {
          const next = datasets.find((key) => key === value);
          if (next) setDataset(next);
        }}
        className="dataset-tabs"
      >
        <Tabs.List aria-label="Financial data">
          {datasets.map((key) => (
            <Tabs.Tab key={key} value={key}>
              {DATASET_PRESENTATION[key].label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {dataset === "fees" ? (
        <CurrentFees
          identity={props.identity}
          onRetry={props.onRetry}
          viewState={feeViewState}
          onViewStateChange={setFeeViewState}
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
    </>
  );
}
