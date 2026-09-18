import { useState } from "react";
import { Alert, Button, Group, Tabs, Text } from "@mantine/core";
import type { DatasetKey } from "./api";
import { FinanceDataset } from "./FinanceDataset";
import { visibleDatasets, DATASET_PRESENTATION } from "./view-model";
import type { Identity } from "./use-auth";
import { CurrentFees } from "./CurrentFees";
import {
  createDatasetViewState,
  createFeeViewState,
  type DatasetViewState,
} from "./workspace-view-state";

export interface WorkspaceProps {
  identity: Identity;
  onRetry: () => Promise<void>;
  isUpdating: boolean;
  updateError: string | null;
}

export function FinanceWorkspace(props: WorkspaceProps) {
  const [dataset, setDataset] = useState<DatasetKey>("live");
  const [datasetViews, setDatasetViews] = useState<Partial<Record<DatasetKey, DatasetViewState>>>(
    {},
  );
  const [feeViewState, setFeeViewState] = useState(createFeeViewState);
  const datasets = visibleDatasets(props.identity.account);
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
      {props.isUpdating ? (
        <Text role="status" size="xs" c="dimmed" mb="xs">
          Updating…
        </Text>
      ) : null}
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
          {...props}
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
