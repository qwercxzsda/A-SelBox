import { useMemo } from "react";
import {
  Accordion,
  Button,
  CloseButton,
  Group,
  NativeSelect,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { PaginationBar } from "./PaginationBar";
import { SkuFees } from "./SkuFees";
import { filterFeeSkus, paginateFeeSkus } from "./fee-skus";
import type { Identity } from "./auth-session";
import { companyLabel, DATASET_PRESENTATION, PAGE_SIZES } from "./view-model";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";

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
  const companies = useMemo(
    () => new Map(identity.companies.map((company) => [company.id, company.name])),
    [identity.companies],
  );
  const searchTerm = search.trim();
  const assignments = useMemo(
    () => filterFeeSkus(identity.assignments, search, showCompany ? companies : undefined),
    [identity.assignments, search, showCompany, companies],
  );
  const { visibleSkus, pageIndex, pageCount, totalCount, firstVisible, lastVisible } =
    paginateFeeSkus(assignments, viewState.pageIndex, pageSize);
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
          placeholder={showCompany ? "SKU or company" : "SKU"}
          value={search}
          flex="1"
          miw={200}
          rightSectionPointerEvents="auto"
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
        pageCount={pageCount}
        canPrevious={pageIndex > 0}
        canNext={pageIndex < pageCount - 1}
        summary={`${firstVisible.toLocaleString("en-US")}-${lastVisible.toLocaleString("en-US")} of ${totalCount.toLocaleString("en-US")} SKUs`}
        onPrevious={() => {
          changePage(pageIndex - 1);
        }}
        onNext={() => {
          changePage(pageIndex + 1);
        }}
        onPageChange={changePage}
      />
      {visibleSkus.length === 0 ? (
        <Paper withBorder p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed" ta="center">
              {searchTerm
                ? "No SKUs match your search."
                : showCompany
                  ? "No SKUs are assigned."
                  : "No SKUs are assigned to your company."}
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
          value={expanded.map(encodeURIComponent)}
          onChange={(nextExpanded) => {
            onViewStateChange((current) => ({
              ...current,
              expanded: nextExpanded.map(decodeURIComponent),
            }));
          }}
        >
          {visibleSkus.map((assignment) => (
            <Accordion.Item key={assignment.id} value={encodeURIComponent(assignment.sku)}>
              <Accordion.Control aria-label={`Show marketplace fees for ${assignment.sku}`}>
                <Stack gap={2}>
                  <Text fw={600} style={{ overflowWrap: "anywhere" }}>
                    {assignment.sku}
                  </Text>
                  {showCompany ? (
                    <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      {companyLabel(assignment.company_id, companies)}
                    </Text>
                  ) : null}
                </Stack>
              </Accordion.Control>
              <Accordion.Panel>
                {expanded.includes(assignment.sku) ? (
                  <SkuFees
                    identity={identity}
                    assignment={assignment}
                    companies={companies}
                    onRetry={onRetry}
                  />
                ) : null}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </Stack>
  );
}
