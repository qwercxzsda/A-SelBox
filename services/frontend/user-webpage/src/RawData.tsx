import "./RawData.css";
import { Tabs } from "@mantine/core";
import { useRef, useState, type SetStateAction } from "react";
import type { RawDatasetKey, TableDatasetKey } from "./api";
import type { Identity } from "./auth-session";
import { DatasetHelp } from "./DatasetHelp";
import { FinanceDataset } from "./FinanceDataset";
import type { LoadingState } from "./LoadingStatus";
import { RAW_DATASETS, decodeRawDataset } from "./raw-data-view";
import { useHeightHold } from "./scroll-hold";
import { useWorkspacePreference } from "./use-workspace-preference";
import { DATASET_PRESENTATION } from "./view-model";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { createDatasetViewState, type DatasetViewState } from "./workspace-view-state";

type DatasetViewUpdate = (dataset: RawDatasetKey, update: SetStateAction<DatasetViewState>) => void;

/** Amazon's own records, one sub-tab per source. Each sub-tab keeps its own list state. */
export function RawData({
  identity,
  onRetry,
  updating,
  views,
  onViewChange,
  onViewCorrect,
  onShowTransactions,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  updating: boolean;
  views: Partial<Record<TableDatasetKey, DatasetViewState>>;
  onViewChange: DatasetViewUpdate;
  /** Corrects a sub-tab's view to its loaded data, replacing the history entry. */
  onViewCorrect: DatasetViewUpdate;
  onShowTransactions: (sku: string) => void;
}) {
  const [raw, setRaw] = useWorkspacePreference<RawDatasetKey>(
    "raw-data:dataset",
    () => "finances",
    decodeRawDataset,
  );
  const [status, setStatus] = useState<LoadingState>("loading");
  const panel = useRef<HTMLDivElement>(null);
  // A newly opened source loads in a shorter panel; the page keeps its place meanwhile.
  const holdPanelHeight = useHeightHold(panel);
  return (
    <>
      <WorkspaceHeader title="Raw data" status={status} help={<DatasetHelp dataset={raw} />} />
      <Tabs
        value={raw}
        onChange={(value) => {
          const next = decodeRawDataset(value);
          if (next !== raw) holdPanelHeight();
          setRaw(next);
        }}
        className="raw-data-tabs"
      >
        <Tabs.List aria-label="Raw data sources">
          {RAW_DATASETS.map((key) => (
            <Tabs.Tab key={key} value={key}>
              {DATASET_PRESENTATION[key].label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel ref={panel} value={raw} pt="md">
          <FinanceDataset
            key={raw}
            dataset={raw}
            identity={identity}
            onRetry={onRetry}
            updating={updating}
            viewState={views[raw] ?? createDatasetViewState(raw)}
            onViewStateChange={(update) => {
              onViewChange(raw, update);
            }}
            onViewStateCorrect={(update) => {
              onViewCorrect(raw, update);
            }}
            onShowTransactions={onShowTransactions}
            onStatusChange={setStatus}
          />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
