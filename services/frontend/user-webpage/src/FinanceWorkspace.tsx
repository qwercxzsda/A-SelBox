import { Alert, Button, Group, Tabs } from "@mantine/core";
import { useEffect, type SetStateAction } from "react";
import { UpdateStatus } from "./UpdateStatus";
import type { TableDatasetKey } from "./api";
import { FinanceDataset } from "./FinanceDataset";
import { DATASET_PRESENTATION, companyLabel } from "./view-model";
import type { Identity } from "./auth-session";
import { CurrentFees } from "./CurrentFees";
import { Inventory } from "./Inventory";
import { FinancialReview } from "./FinancialReview";
import { useSkuConfiguration } from "./use-sku-configuration";
import { TransactionSummaries } from "./TransactionSummaries";
import type { DateRange } from "./summary-periods";
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
import { useWorkspaceNavigationFocus } from "./use-workspace-navigation-focus";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { DatasetHelp } from "./DatasetHelp";

const TAB_GROUPS = [
  ["live", "inventory", "payouts", "fees"],
  ["accounts", "companies"],
  ["finances", "data_kiosk", "financial-review"],
] as const;
type WorkspaceTab = (typeof TAB_GROUPS)[number][number];

function tabLabel(tab: WorkspaceTab) {
  if (tab === "inventory") return "Inventory";
  if (tab === "companies") return "Companies";
  if (tab === "financial-review") return "Financial review";
  return DATASET_PRESENTATION[tab].label;
}

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
  const [companyReturnTo, setCompanyReturnTo] = useWorkspacePreference<"fees" | "accounts" | null>(
    "companies:return-to",
    () => null,
    (value) => (value === "fees" || value === "accounts" ? value : null),
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
  const tabGroups =
    props.identity.account.access_role === "administrator" ? TAB_GROUPS : TAB_GROUPS.slice(0, 1);
  const transactions = datasetViews.live ?? createDatasetViewState("live");
  const workspaceTitle = tabLabel(dataset);
  const accountTitle =
    props.identity.account.access_role === "administrator"
      ? "Administrator"
      : companyLabel(
          props.identity.account.company_id,
          new Map(props.identity.companies.map(({ id, name }) => [id, name])),
        );
  useEffect(() => {
    document.title = `${workspaceTitle} · ${accountTitle} · A-SelBox`;
  }, [workspaceTitle, accountTitle]);

  function addCompany(from: "fees" | "accounts") {
    setCompanyReturnTo(from);
    setDataset("companies");
  }

  function updateDatasetView(dataset: TableDatasetKey, update: SetStateAction<DatasetViewState>) {
    setDatasetViews((current) => {
      const previous = current[dataset] ?? createDatasetViewState(dataset);
      return {
        ...current,
        [dataset]: typeof update === "function" ? update(previous) : update,
      };
    });
  }

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

  function selectPeriod(range: DateRange) {
    updateDatasetView("live", (previous) => ({
      ...previous,
      filters: { ...previous.filters, dateFrom: range.from, dateTo: range.to },
      pagination: { ...previous.pagination, pageIndex: 0 },
      selectedRowId: null,
    }));
    setDataset("live");
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
          const next = decodeWorkspaceTab(value, props.identity.account);
          if (next !== value) return;
          if (next === "companies") setCompanyReturnTo(null);
          setDataset(next);
        }}
        className="dataset-tabs"
      >
        <Tabs.List aria-label="Workspace data">
          {tabGroups.flatMap((group, groupIndex) =>
            group.map((key, index) => (
              <Tabs.Tab
                key={key}
                value={key}
                ref={dataset === key ? activeTab : undefined}
                data-group-start={groupIndex > 0 && index === 0 ? true : undefined}
              >
                {tabLabel(key)}
              </Tabs.Tab>
            )),
          )}
        </Tabs.List>
        <Tabs.Panel value={dataset} pt="md">
          {dataset === "live" ? (
            <>
              <WorkspaceHeader title="Transactions" help={<DatasetHelp dataset="live" />} />
              <TransactionSummaries
                identity={props.identity}
                onRetry={props.onRetry}
                companyIds={transactions.filters.companyIds}
                skus={transactions.filters.skus}
                marketplaces={transactions.filters.marketplaces}
                dateRange={{ from: transactions.filters.dateFrom, to: transactions.filters.dateTo }}
                onPeriodSelect={selectPeriod}
              />
            </>
          ) : null}
          {dataset === "companies" ? (
            <Companies
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
              onAddCompany={() => {
                addCompany("fees");
              }}
            />
          ) : (
            <FinanceDataset
              key={dataset}
              dataset={dataset}
              onAddCompany={() => {
                addCompany("accounts");
              }}
              identity={props.identity}
              onRetry={props.onRetry}
              viewState={datasetViews[dataset] ?? createDatasetViewState(dataset)}
              onViewStateChange={(update) => {
                updateDatasetView(dataset, update);
              }}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
