import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { SkuConfigurationItem } from "./api";
import { SkuFeePeriods } from "./SkuFeePeriods";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { PaginationBar } from "./PaginationBar";
import { filterFeeSkus, paginateFeeSkus } from "./fee-skus";
import type { SkuFormIssue } from "./sku-configuration-form";
import { companyLabel } from "./view-model";
import { RowsSelect } from "./RowsSelect";
import type { FeeViewState, ViewStateProps } from "./workspace-view-state";
import "./SkuConfigurationList.css";

export function SkuConfigurationList({
  items,
  companies,
  issuesBySku,
  administrator,
  isSaving,
  onEdit,
  onShowTransactions,
  viewState,
  onViewStateChange,
}: {
  items: SkuConfigurationItem[];
  companies: Map<string, string>;
  issuesBySku: Map<string, SkuFormIssue[]>;
  administrator: boolean;
  isSaving: boolean;
  onEdit: (sku: string) => void;
  onShowTransactions: (sku: string) => void;
} & ViewStateProps<FeeViewState>) {
  const { search, pageSize, expanded, drafts } = viewState;
  const draftSkus = new Set(drafts.map((draft) => draft.sku));
  const filtered = filterFeeSkus(items, search, administrator ? companies : undefined).filter(
    (item) => !viewState.onlyIncomplete || issuesBySku.has(item.sku),
  );
  const pagination = paginateFeeSkus(filtered, viewState.pageIndex, pageSize);
  function change(patch: Partial<FeeViewState>) {
    onViewStateChange((current) => ({ ...current, ...patch }));
  }
  return (
    <>
      <div className="fee-list-toolbar">
        <TextInput
          className="fee-list-search"
          label="Search SKUs"
          placeholder={administrator ? "SKU or company" : "SKU"}
          value={search}
          rightSectionPointerEvents="auto"
          rightSection={
            search ? (
              <CloseButton
                aria-label="Clear search"
                onClick={() => {
                  change({ search: "", pageIndex: 0 });
                }}
              />
            ) : null
          }
          onChange={(event) => {
            change({ search: event.currentTarget.value, pageIndex: 0 });
          }}
        />
        <RowsSelect
          className="fee-list-rows"
          value={pageSize}
          onChange={(pageSize) => {
            change({ pageSize, pageIndex: 0 });
          }}
        />
        <Checkbox
          className="fee-list-incomplete"
          label="Needs setup only"
          checked={viewState.onlyIncomplete}
          onChange={(event) => {
            change({ onlyIncomplete: event.currentTarget.checked, pageIndex: 0 });
          }}
        />
        <Button
          className="fee-list-collapse"
          variant="subtle"
          size="compact-sm"
          disabled={expanded.length === 0}
          onClick={() => {
            change({ expanded: [] });
          }}
        >
          Collapse all
        </Button>
      </div>
      <PaginationBar
        pageIndex={pagination.pageIndex}
        pageCount={pagination.pageCount}
        canPrevious={pagination.pageIndex > 0}
        canNext={pagination.pageIndex < pagination.pageCount - 1}
        summary={`${pagination.firstVisible.toLocaleString("en-US")}-${pagination.lastVisible.toLocaleString("en-US")} of ${pagination.totalCount.toLocaleString("en-US")} SKUs`}
        onPrevious={() => {
          change({ pageIndex: pagination.pageIndex - 1 });
        }}
        onNext={() => {
          change({ pageIndex: pagination.pageIndex + 1 });
        }}
        onPageChange={(pageIndex) => {
          change({ pageIndex });
        }}
      />
      {pagination.visibleSkus.length === 0 ? (
        <Paper withBorder p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed">
              {search || viewState.onlyIncomplete
                ? "No SKUs match your search."
                : administrator
                  ? "No SKUs are available yet."
                  : "No SKUs are assigned to your company."}
            </Text>
            {search || viewState.onlyIncomplete ? (
              <Button
                variant="subtle"
                onClick={() => {
                  change({ search: "", onlyIncomplete: false, pageIndex: 0 });
                }}
              >
                Clear search
              </Button>
            ) : null}
          </Stack>
        </Paper>
      ) : (
        <Accordion
          className="fee-sku-list"
          multiple
          variant="separated"
          value={expanded.map(encodeURIComponent)}
          onChange={(next) => {
            change({ expanded: next.map(decodeURIComponent) });
          }}
        >
          {pagination.visibleSkus.map((item) => (
            <Accordion.Item key={item.sku} value={encodeURIComponent(item.sku)}>
              <div className="fee-sku-header">
                <Stack gap={2} className="fee-sku-identity">
                  <Group gap="xs">
                    <SkuTransactionLink sku={item.sku} onShowTransactions={onShowTransactions} />
                    {issuesBySku.has(item.sku) ? <Badge color="orange">Needs setup</Badge> : null}
                    {draftSkus.has(item.sku) ? <Badge variant="light">Draft</Badge> : null}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {companyLabel(item.company_id, companies)}
                  </Text>
                </Stack>
                <Group gap="xs" className="fee-sku-actions">
                  {administrator ? (
                    <Button
                      variant="light"
                      aria-label={`Edit ${item.sku}`}
                      disabled={isSaving}
                      onClick={() => {
                        onEdit(item.sku);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Accordion.Control
                    aria-label={`Show marketplace fees for ${item.sku}`}
                    className="fee-sku-toggle"
                  >
                    Fee periods ({item.periods.length})
                  </Accordion.Control>
                </Group>
              </div>
              <Accordion.Panel>
                {expanded.includes(item.sku) ? (
                  <Stack gap="sm">
                    {administrator && draftSkus.has(item.sku) ? (
                      <Group justify="flex-end">
                        <Button
                          variant="subtle"
                          color="#9e1834"
                          aria-label={`Discard draft for ${item.sku}`}
                          disabled={isSaving}
                          onClick={() => {
                            change({ drafts: drafts.filter((draft) => draft.sku !== item.sku) });
                          }}
                        >
                          Discard draft
                        </Button>
                      </Group>
                    ) : null}
                    {(issuesBySku.get(item.sku) ?? []).map((issue, index) => (
                      <Text key={index} size="sm" c="orange.8">
                        {issue.message}
                      </Text>
                    ))}
                    <SkuFeePeriods item={item} />
                  </Stack>
                ) : null}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </>
  );
}
