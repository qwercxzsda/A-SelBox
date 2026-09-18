import {
  Accordion,
  Alert,
  Button,
  CloseButton,
  Group,
  NativeSelect,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchSkuFees, type SkuAssignment } from "./api";
import { TableCellValue } from "./Cell";
import { PaginationBar } from "./PaginationBar";
import { lastPageIndex } from "./pagination";
import type { Identity } from "./use-auth";
import {
  companyLabel,
  DATASET_PRESENTATION,
  getErrorMessage,
  PAGE_SIZES,
  TABLE_COLUMNS,
} from "./view-model";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";

const MARKETPLACE_COLUMNS = ["marketplace_name", "fee_rate_percent", "valid_period"].flatMap(
  (key) => TABLE_COLUMNS.fees.filter((column) => column.key === key),
);

function MarketplaceFees({
  identity,
  assignment,
  companies,
  onRetry,
}: {
  identity: Identity;
  assignment: SkuAssignment;
  companies: Map<string, string>;
  onRetry: () => Promise<void>;
}) {
  const { session, account } = identity;
  const query = useQuery({
    queryKey: [
      "current-fees",
      session.user.id,
      account.access_role,
      account.company_id,
      assignment.id,
      assignment.terms_version_id,
    ],
    queryFn: ({ signal }) => fetchSkuFees(session.access_token, assignment.id, signal),
  });

  if (query.isPending) {
    return (
      <Text c="dimmed" size="sm" role="status" py="md">
        Loading marketplace fees…
      </Text>
    );
  }
  if (query.isError) {
    return (
      <Alert color="red" role="alert">
        <Stack gap="sm" align="start">
          {getErrorMessage(query.error)}
          <Button
            variant="light"
            color="red"
            loading={query.isFetching}
            onClick={() => void onRetry()}
          >
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (query.data.length === 0) {
    return <Text c="dimmed">No current marketplace fee periods are available for this SKU.</Text>;
  }

  return (
    <Table
      fz="sm"
      aria-label={`Marketplace fees for ${assignment.sku}`}
      style={{ tableLayout: "fixed", width: "100%" }}
      styles={{
        th: { overflowWrap: "anywhere" },
        td: { overflowWrap: "anywhere", verticalAlign: "top" },
      }}
    >
      <colgroup>
        <col style={{ width: "40%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "42%" }} />
      </colgroup>
      <Table.Thead>
        <Table.Tr>
          {MARKETPLACE_COLUMNS.map((column) => (
            <Table.Th key={column.key} ta={column.align}>
              {column.label}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {query.data.map((row) => (
          <Table.Tr key={row.fee_period_id}>
            {MARKETPLACE_COLUMNS.map((column) => (
              <Table.Td key={column.key} ta={column.align}>
                <TableCellValue column={column} row={row} companies={companies} />
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function CurrentFees({
  identity,
  onRetry,
  viewState,
  onViewStateChange,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
} & ViewStateProps<FeeViewState>) {
  const { search, pageSize, expanded } = viewState;
  const showCompany = identity.account.access_role === "operator";
  const companies = new Map(identity.companies.map((company) => [company.id, company.name]));
  const searchTerm = search.trim().toLocaleLowerCase();
  const assignments = identity.assignments
    .filter((assignment) =>
      [
        assignment.sku,
        assignment.seller_namespace,
        ...(showCompany ? [companyLabel(assignment.company_id, companies)] : []),
      ].some((value) => value.toLocaleLowerCase().includes(searchTerm)),
    )
    .sort(
      (left, right) =>
        left.sku.localeCompare(right.sku) ||
        left.seller_namespace.localeCompare(right.seller_namespace) ||
        left.id.localeCompare(right.id),
    );
  const finalPage = lastPageIndex(assignments.length, pageSize);
  const pageIndex = Math.min(viewState.pageIndex, finalPage);
  const visibleAssignments = assignments.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const firstVisible = assignments.length === 0 ? 0 : pageIndex * pageSize + 1;
  const lastVisible = pageIndex * pageSize + visibleAssignments.length;
  function changeSearch(value: string) {
    onViewStateChange((current) => ({ ...current, search: value, pageIndex: 0 }));
  }
  function changePage(nextPage: number) {
    onViewStateChange((current) => ({ ...current, pageIndex: nextPage }));
  }

  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm" role="note">
        {DATASET_PRESENTATION.fees.description}
      </Text>
      <Group align="end">
        <TextInput
          label="Search SKUs"
          placeholder={showCompany ? "SKU, company, or seller" : "SKU or seller"}
          value={search}
          flex="1"
          miw={200}
          rightSection={
            search ? (
              <CloseButton
                aria-label="Clear search"
                size="sm"
                onClick={() => {
                  changeSearch("");
                }}
              />
            ) : null
          }
          onChange={(event) => {
            changeSearch(event.currentTarget.value);
          }}
        />
        <NativeSelect
          label="SKUs per page"
          value={pageSize}
          data={PAGE_SIZES.map(String)}
          onChange={(event) => {
            const nextPageSize = Number(event.currentTarget.value);
            onViewStateChange((current) => ({ ...current, pageSize: nextPageSize, pageIndex: 0 }));
          }}
        />
      </Group>
      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          Expand a SKU to view its marketplace fees.
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={expanded.length === 0}
          onClick={() => {
            onViewStateChange((current) => ({ ...current, expanded: [] }));
          }}
        >
          Collapse all
        </Button>
      </Group>
      <PaginationBar
        pageIndex={pageIndex}
        pageCount={finalPage + 1}
        canPrevious={pageIndex > 0}
        canNext={pageIndex < finalPage}
        summary={`${firstVisible.toLocaleString("en-US")}-${lastVisible.toLocaleString("en-US")} of ${assignments.length.toLocaleString("en-US")} SKUs`}
        onPrevious={() => {
          changePage(pageIndex - 1);
        }}
        onNext={() => {
          changePage(pageIndex + 1);
        }}
        onPageChange={changePage}
      />
      {visibleAssignments.length === 0 ? (
        <Paper withBorder p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed" ta="center">
              {searchTerm ? "No SKUs match your search." : "No SKUs are assigned to your company."}
            </Text>
            {searchTerm ? (
              <Button
                variant="subtle"
                onClick={() => {
                  changeSearch("");
                }}
              >
                Clear search
              </Button>
            ) : null}
          </Stack>
        </Paper>
      ) : (
        <Accordion
          multiple
          variant="separated"
          value={expanded}
          onChange={(nextExpanded) => {
            onViewStateChange((current) => ({ ...current, expanded: nextExpanded }));
          }}
        >
          {visibleAssignments.map((assignment) => {
            const company = companyLabel(assignment.company_id, companies);
            return (
              <Accordion.Item key={assignment.id} value={assignment.id}>
                <Accordion.Control
                  aria-label={`Show marketplace fees for ${assignment.sku}, ${showCompany ? `${company}, ` : ""}seller ${assignment.seller_namespace}`}
                >
                  <Stack gap={2}>
                    <Text fw={600} style={{ overflowWrap: "anywhere" }}>
                      {assignment.sku}
                    </Text>
                    <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      {showCompany ? `${company} · ` : ""}Seller: {assignment.seller_namespace}
                    </Text>
                  </Stack>
                </Accordion.Control>
                <Accordion.Panel>
                  {expanded.includes(assignment.id) ? (
                    <MarketplaceFees
                      identity={identity}
                      assignment={assignment}
                      companies={companies}
                      onRetry={onRetry}
                    />
                  ) : null}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
    </Stack>
  );
}
