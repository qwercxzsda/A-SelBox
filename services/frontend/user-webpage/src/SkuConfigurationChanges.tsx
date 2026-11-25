import { Stack, Table, Text } from "@mantine/core";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { feePeriodChanges, type FeePeriodChange } from "./sku-configuration-changes";
import { FeePeriodDateCells, FeePeriodDateHeaders } from "./SkuFeePeriods";
import { feeRateLabel } from "./fee-rate-summary";
import { companyLabel } from "./view-model";
import "./DetailTable.css";
import "./SkuConfigurationList.css";

const CHANGE_LABELS: Record<FeePeriodChange["kind"], { label: string; tone: StatusTone }> = {
  added: { label: "Period added", tone: "success" },
  removed: { label: "Period removed", tone: "danger" },
  rate: { label: "Rate changed", tone: "info" },
};

function PeriodChangeTable({ sku, changes }: { sku: string; changes: readonly FeePeriodChange[] }) {
  return (
    <div
      className="detail-table-scroll"
      role="region"
      aria-label={`Fee period changes for ${sku} table`}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Changes can be scrolled with the keyboard on narrow screens.
      tabIndex={0}
    >
      <Table className="detail-table fee-change-table" aria-label={`Fee period changes for ${sku}`}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Change</Table.Th>
            <Table.Th scope="col">Marketplace</Table.Th>
            <Table.Th scope="col" ta="right">
              Fee rate
            </Table.Th>
            <FeePeriodDateHeaders />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {changes.map(({ kind, period, previousRate }, index) => (
            <Table.Tr key={index}>
              <Table.Td data-column="change">
                <StatusBadge tone={CHANGE_LABELS[kind].tone}>
                  {CHANGE_LABELS[kind].label}
                </StatusBadge>
              </Table.Td>
              <Table.Td data-column="marketplace">{period.marketplace_name || "Not set"}</Table.Td>
              <Table.Td data-column="fee-rate" ta="right">
                {previousRate !== undefined ? `${feeRateLabel(previousRate)} → ` : ""}
                {feeRateLabel(period.fee_rate_percent)}
              </Table.Td>
              <FeePeriodDateCells period={period} />
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

export function SkuConfigurationChanges({
  draft,
  saved,
  companies,
}: {
  draft: SkuConfigurationChange;
  saved: SkuConfigurationItem | undefined;
  companies: Map<string, string>;
}) {
  const periods = feePeriodChanges(saved?.periods ?? [], draft.periods);
  const companyChanged = (saved?.company_id ?? null) !== draft.company_id;
  return (
    <Stack gap="xs" mt="sm" role="region" aria-label={`Changes for ${draft.sku}`}>
      {!saved ? <StatusBadge tone="info">New SKU</StatusBadge> : null}
      {companyChanged ? (
        <Text size="sm">
          Company: {companyLabel(saved?.company_id ?? null, companies)} →{" "}
          {companyLabel(draft.company_id, companies)}
        </Text>
      ) : null}
      {periods.length ? <PeriodChangeTable sku={draft.sku} changes={periods} /> : null}
      {saved && !companyChanged && periods.length === 0 ? (
        <Text size="sm" c="dimmed">
          No changes
        </Text>
      ) : null}
    </Stack>
  );
}
