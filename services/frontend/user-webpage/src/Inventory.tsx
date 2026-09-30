import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Group, NativeSelect, Stack, Text, TextInput, Title } from "@mantine/core";
import { ApiError, fetchInventoryPage } from "./api";
import type { InventoryViewState, ViewStateProps } from "./workspace-view-state";
import type { Identity } from "./auth-session";
import marketplaces from "./generated/marketplaces.json";
import { getErrorMessage, PAGE_SIZES } from "./view-model";
import { InventoryTable } from "./InventoryTable";
import { PaginationBar } from "./PaginationBar";
import { lastPageIndex } from "./pagination";
import "./Inventory.css";

export function Inventory({
  identity,
  viewState,
  onViewStateChange,
}: ViewStateProps<InventoryViewState> & { identity: Identity }) {
  const query = useQuery({
    queryKey: [
      "inventory",
      identity.account.user_id,
      identity.account.access_role,
      identity.account.company_id,
      viewState,
    ],
    queryFn: ({ signal }) =>
      fetchInventoryPage({ ...viewState, accessToken: identity.session.access_token, signal }),
  });
  const denied = query.error instanceof ApiError && [401, 403].includes(query.error.status ?? 0);
  const totalCount = denied ? null : (query.data?.totalCount ?? null);
  const finalPage = totalCount === null ? null : lastPageIndex(totalCount, viewState.pageSize);
  const pageCount = finalPage === null ? null : finalPage + 1;
  useEffect(() => {
    if (finalPage !== null && viewState.pageIndex > finalPage)
      onViewStateChange((current) => ({ ...current, pageIndex: finalPage }));
  }, [finalPage, viewState.pageIndex, onViewStateChange]);
  const rows = denied ? [] : (query.data?.rows ?? []);
  const changePage = (pageIndex: number) => {
    onViewStateChange((current) => ({ ...current, pageIndex }));
  };
  const changeFilters = (patch: Partial<InventoryViewState>) => {
    onViewStateChange((current) => ({ ...current, ...patch, pageIndex: 0 }));
  };
  return (
    <Stack gap="md" className="inventory-panel">
      <div>
        <Title order={3}>Inventory</Title>
        <Text c="dimmed" size="sm">
          Daily snapshots for approximate replenishment planning. Sales are historical, not a
          forecast.
        </Text>
        <Text c="dimmed" size="sm">
          A dash means unavailable; zero is a reported value. Source dates can differ from the
          capture date.
        </Text>
      </div>
      <Group align="end" className="inventory-filters">
        <TextInput
          label="Exact SKU"
          description="Matches the complete SKU, including spaces and punctuation"
          value={viewState.sku}
          onChange={(event) => {
            changeFilters({ sku: event.currentTarget.value });
          }}
        />
        <NativeSelect
          label="Inventory marketplace"
          value={viewState.marketplace}
          data={[{ value: "", label: "All marketplaces" }, ...marketplaces]}
          onChange={(event) => {
            changeFilters({ marketplace: event.currentTarget.value });
          }}
        />
        <NativeSelect
          label="Inventory rows"
          value={String(viewState.pageSize)}
          data={PAGE_SIZES.map(String)}
          onChange={(event) => {
            changeFilters({ pageSize: Number(event.currentTarget.value) });
          }}
        />
        {viewState.sku || viewState.marketplace ? (
          <Button
            variant="subtle"
            onClick={() => {
              changeFilters({ sku: "", marketplace: "" });
            }}
          >
            Clear inventory filters
          </Button>
        ) : null}
      </Group>
      {query.isError ? (
        <Alert role="alert" color="red">
          Could not load inventory. {getErrorMessage(query.error)}
          {query.data && !denied ? " Previously loaded values are shown." : ""}
          {" Updates retry automatically."}
        </Alert>
      ) : null}
      {query.isFetching ? (
        <Text role="status">{query.isPending ? "Loading inventory…" : "Updating inventory…"}</Text>
      ) : null}
      {rows.length > 0 ? <InventoryTable rows={rows} /> : null}
      {!query.isPending && !query.isError && rows.length === 0 ? (
        <Text role="status">
          {viewState.sku || viewState.marketplace
            ? "No inventory matches these filters."
            : "No inventory items are available for your account."}
        </Text>
      ) : null}
      <PaginationBar
        pageIndex={viewState.pageIndex}
        pageCount={pageCount}
        canPrevious={viewState.pageIndex > 0}
        canNext={
          pageCount === null
            ? rows.length === viewState.pageSize
            : viewState.pageIndex + 1 < pageCount
        }
        isBusy={query.isFetching}
        onPrevious={() => {
          changePage(viewState.pageIndex - 1);
        }}
        onNext={() => {
          changePage(viewState.pageIndex + 1);
        }}
        onPageChange={changePage}
        summary={
          totalCount === null
            ? `${String(rows.length)} inventory items`
            : `${String(totalCount)} inventory ${totalCount === 1 ? "item" : "items"}`
        }
      />
    </Stack>
  );
}
