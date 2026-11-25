import { Tabs } from "@mantine/core";
import { useEffect, type SetStateAction } from "react";
import type { TableDatasetKey } from "./api";
import { ErrorAlert } from "./ErrorAlert";
import { FinanceDataset } from "./FinanceDataset";
import type { Identity } from "./auth-session";
import { CurrentFees } from "./CurrentFees";
import { Inventory } from "./Inventory";
import { Assignments } from "./Assignments";
import { FinancialReview } from "./FinancialReview";
import { RawData } from "./RawData";
import { useSkuConfiguration } from "./use-sku-configuration";
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
import { Companies } from "./Companies";
import { decodeCompanyReturnTab, type CompanyReturnTab } from "./companies-view";
import { useWorkspaceNavigationFocus } from "./use-workspace-navigation-focus";
import { workspaceDocumentTitle, type WorkspaceTab } from "./workspace-tabs";
import { WorkspaceTabList } from "./WorkspaceTabList";

interface WorkspaceProps {
  identity: Identity;
  onRetry: () => Promise<void>;
  isUpdating: boolean;
  updateError: string | null;
}

export function FinanceWorkspace(props: WorkspaceProps) {
  const [dataset, setDataset] = useWorkspacePreference<WorkspaceTab>(
    "tab",
    () => "live",
    (value) => decodeWorkspaceTab(value, props.identity.account),
  );
  const activeTab = useWorkspaceNavigationFocus(dataset);
  const [companyReturnTo, setCompanyReturnTo] = useWorkspacePreference<CompanyReturnTab | null>(
    "companies:return-to",
    () => null,
    decodeCompanyReturnTab,
  );
  const [inventoryViewState, setInventoryViewState, correctInventoryViewState] =
    useWorkspacePreference("inventory", createInventoryViewState, decodeInventoryView);
  const [datasetViews, setDatasetViews, correctDatasetViews] = useWorkspacePreference<
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
  const documentTitle = workspaceDocumentTitle(dataset, props.identity);
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  function addCompany(from: CompanyReturnTab) {
    setCompanyReturnTo(from);
    setDataset("companies");
  }

  /** Updates one dataset's view through `write`: a user's change, or a correction. */
  function datasetViewWriter(write: typeof setDatasetViews) {
    return (dataset: TableDatasetKey, update: SetStateAction<DatasetViewState>) => {
      write((current) => {
        const previous = current[dataset] ?? createDatasetViewState(dataset);
        return {
          ...current,
          [dataset]: typeof update === "function" ? update(previous) : update,
        };
      });
    };
  }
  const updateDatasetView = datasetViewWriter(setDatasetViews);
  const correctDatasetView = datasetViewWriter(correctDatasetViews);

  function showCompanyMembers(companyId: string) {
    updateDatasetView("accounts", (previous) => ({
      ...previous,
      search: "",
      filters: { ...normalizeDatasetFilters(), companyIds: [companyId] },
      pagination: { ...previous.pagination, pageIndex: 0 },
      selectedRowId: null,
    }));
    setCompanyReturnTo(null);
    setDataset("accounts");
  }

  function showSkuTransactions(sku: string) {
    updateDatasetView("live", (previous) => ({
      ...previous,
      search: "",
      filters: { ...normalizeDatasetFilters(), skus: [sku] },
      pagination: { ...previous.pagination, pageIndex: 0 },
      selectedRowId: null,
    }));
    setDataset("live");
  }
  return (
    <>
      {props.updateError ? (
        dataset === "inventory" ? (
          // Inventory is a daily snapshot: its check repeats on its own, with no manual retry.
          <ErrorAlert
            title="Could not check for updates"
            detail={props.updateError}
            retriesAutomatically
          />
        ) : (
          <ErrorAlert
            title="Could not check for updates"
            detail={props.updateError}
            // A Retry during a running check is queued, never ignored, so it stays enabled.
            onRetry={() => void props.onRetry()}
          />
        )
      ) : null}
      <Tabs
        value={dataset}
        onChange={(value) => {
          const next = decodeWorkspaceTab(value, props.identity.account);
          if (next !== value) return;
          if (next === "companies") setCompanyReturnTo(null);
          setDataset(next);
        }}
        className="dataset-tabs"
      >
        <WorkspaceTabList identity={props.identity} active={dataset} activeTabRef={activeTab} />
        <Tabs.Panel value={dataset} pt="md">
          {dataset === "companies" ? (
            <Companies
              updating={props.isUpdating}
              identity={props.identity}
              returnTo={companyReturnTo}
              onReturn={() => {
                if (companyReturnTo) setDataset(companyReturnTo);
                setCompanyReturnTo(null);
              }}
              onShowMembers={showCompanyMembers}
              onShowTransactions={showSkuTransactions}
            />
          ) : dataset === "inventory" ? (
            <Inventory
              updating={props.isUpdating}
              identity={props.identity}
              viewState={inventoryViewState}
              onViewStateChange={setInventoryViewState}
              onViewStateCorrect={correctInventoryViewState}
              onShowTransactions={showSkuTransactions}
            />
          ) : dataset === "assignments" ? (
            <Assignments
              updating={props.isUpdating}
              identity={props.identity}
              onShowTransactions={showSkuTransactions}
              onAddCompany={() => {
                addCompany("assignments");
              }}
            />
          ) : dataset === "raw-data" ? (
            <RawData
              updating={props.isUpdating}
              identity={props.identity}
              onRetry={props.onRetry}
              views={datasetViews}
              onViewChange={updateDatasetView}
              onViewCorrect={correctDatasetView}
              onShowTransactions={showSkuTransactions}
            />
          ) : dataset === "financial-review" ? (
            <FinancialReview identity={props.identity} />
          ) : dataset === "fees" ? (
            <CurrentFees
              updating={props.isUpdating}
              identity={props.identity}
              controller={feeConfiguration}
              viewState={feeViewState}
              onViewStateChange={setFeeViewState}
              onShowTransactions={showSkuTransactions}
              onAddCompany={() => {
                addCompany("fees");
              }}
            />
          ) : (
            <FinanceDataset
              updating={props.isUpdating}
              key={dataset}
              dataset={dataset}
              onAddCompany={() => {
                addCompany("accounts");
              }}
              onShowTransactions={showSkuTransactions}
              identity={props.identity}
              onRetry={props.onRetry}
              viewState={datasetViews[dataset] ?? createDatasetViewState(dataset)}
              onViewStateChange={(update) => {
                updateDatasetView(dataset, update);
              }}
              onViewStateCorrect={(update) => {
                correctDatasetView(dataset, update);
              }}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
