import { useState } from "react";
import { Tabs } from "@mantine/core";
import type { DatasetKey } from "./api";
import { FinanceDataset } from "./FinanceDataset";
import { visibleDatasets, DATASET_PRESENTATION } from "./view-model";
import type { Identity } from "./use-auth";

export interface WorkspaceProps {
  identity: Identity;
  onRefreshIdentity: () => Promise<boolean>;
}

export function FinanceWorkspace(props: WorkspaceProps) {
  const [dataset, setDataset] = useState<DatasetKey>("live");
  const datasets = visibleDatasets(props.identity.account);
  return (
    <>
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
      <FinanceDataset key={dataset} dataset={dataset} {...props} />
    </>
  );
}
